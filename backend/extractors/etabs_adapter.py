"""
CivilSpace — ETABS adapter (Stage 3A)
=====================================
Maps the canonical model JSON produced by `parse_et.py` (schema v0.2.1, SI mm,
y-UP) onto the three ETABS-side arrays the v11 data contract requires:

    etabs_cols   [EtabsCol : id, x, y, B, D, ang, sec]
    etabs_beams  [EtabsBeam: id, x1, y1, x2, y2]
    raw_piers    [pier/wall dicts for extract.normalize_piers()]

Rules honored (see contract.py + PROMPT_claude_code):
  - Coordinates pass through in ETABS model mm, y-UP. We DO NOT flip — the engine
    handles the GFC↔ETABS reflection itself.
  - Deterministic, no network, no LLM. Pure data reshaping.
  - Never fabricate: a model with no walls yields an empty raw_piers list (e.g.
    the PUNET sample has walls_panels == []), not invented geometry.
  - B/D come from the column's frame section; if a section can't be resolved we
    fall back to parsing the dimensions out of the section NAME ("C 450X600" ->
    450x600). Generic — no per-project constants.

Section orientation note: parse_et records B = width_t2_mm (local-2 / breadth)
and D = depth_t3_mm (local-3 / depth). The contract's EtabsCol uses the same
convention (B breadth, D depth, ang local-axis angle). `sec` is free-text and is
never trusted for orientation (the engine uses B/D/ang).
"""
from __future__ import annotations
import re
from typing import Optional


# --------------------------------------------------------------------------- #
#  section dimension resolution
# --------------------------------------------------------------------------- #
# Matches a "<num> X <num>" dimension pair anywhere in a section name, tolerant
# of spacing and lower/upper-case x:  "C 450X600 M30..", "450 x 600", "B230X400".
_DIM_RE = re.compile(r'(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)')


def _dims_from_name(name: str) -> Optional[tuple[float, float]]:
    """Parse a (w, d) dimension pair out of a section name. Returns None if the
    name carries no recognizable WxD pattern."""
    if not name:
        return None
    m = _DIM_RE.search(name)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


def _resolve_section(sec_name: Optional[str],
                     frame_sections: dict[str, dict]) -> tuple[Optional[float], Optional[float]]:
    """Resolve (B, D) for a section name. Prefer the parsed frame-section's
    width_t2_mm / depth_t3_mm; fall back to dimensions parsed from the name.
    Returns (None, None) when nothing is available (honest absence)."""
    if sec_name and sec_name in frame_sections:
        fs = frame_sections[sec_name]
        b, d = fs.get("width_t2_mm"), fs.get("depth_t3_mm")
        if b is not None and d is not None:
            return float(b), float(d)
        # frame section exists but lacks dims — try its name before giving up
        nd = _dims_from_name(sec_name)
        if nd:
            return nd
        return (float(b) if b is not None else None,
                float(d) if d is not None else None)
    nd = _dims_from_name(sec_name or "")
    if nd:
        return nd
    return None, None


def _primary_section(sections: list[str]) -> Optional[str]:
    """A member may carry several section assignments across stories; the ground
    column's plan dimension is what the mapper compares, so take the first
    deterministically-sorted entry (parse_et already de-dups + sorts)."""
    return sections[0] if sections else None


# --------------------------------------------------------------------------- #
#  main adapter
# --------------------------------------------------------------------------- #
def adapt(model: dict) -> dict:
    """canonical parse_et model -> {etabs_cols, etabs_beams, raw_piers}.

    Pure function of `model`; order-independent and deterministic.
    """
    points: dict[str, dict] = model.get("points", {})
    frame_sections = {s["name"]: s for s in model.get("frame_sections", [])}
    members = model.get("members", {})

    etabs_cols = _build_cols(members.get("columns", []), points, frame_sections)
    etabs_beams = _build_beams(members.get("beams", []), points)
    raw_piers = _build_piers(members.get("walls_panels", []), points)

    return {"etabs_cols": etabs_cols, "etabs_beams": etabs_beams,
            "raw_piers": raw_piers}


def _build_cols(columns: list[dict], points: dict,
                frame_sections: dict) -> list[dict]:
    out = []
    for c in columns:
        xy = c.get("plan_xy_mm")
        if not xy:
            # fall back to the column's i-point if plan_xy wasn't computed
            p = points.get(c.get("pt_i"))
            if not p:
                continue                      # no position -> cannot place; skip honestly
            xy = [p["x_mm"], p["y_mm"]]
        sec = _primary_section(c.get("sections", []))
        B, D = _resolve_section(sec, frame_sections)
        ang = c.get("angle_deg", 0.0)
        if isinstance(ang, list):             # parse_et emits a list when ambiguous
            ang = ang[0] if ang else 0.0
        out.append({
            "id": c["id"],
            "x": float(xy[0]), "y": float(xy[1]),
            "B": float(B) if B is not None else 0.0,
            "D": float(D) if D is not None else 0.0,
            "ang": float(ang or 0.0),
            "sec": sec or "",
        })
    return out


def _build_beams(beams: list[dict], points: dict) -> list[dict]:
    out = []
    for b in beams:
        pi, pj = points.get(b.get("pt_i")), points.get(b.get("pt_j"))
        if not pi or not pj:
            continue                          # endpoints unknown -> cannot place; skip
        out.append({
            "id": b["id"],
            "x1": float(pi["x_mm"]), "y1": float(pi["y_mm"]),
            "x2": float(pj["x_mm"]), "y2": float(pj["y_mm"]),
        })
    return out


def _build_piers(walls_panels: list[dict], points: dict) -> list[dict]:
    """Emit raw pier SEGMENT dicts for extract.normalize_piers().

    ETABS shear-wall piers come through parse_et as thin wall panels whose 4
    vertices are really TWO distinct points repeated (e.g. ['129','131','131',
    '129'] = A,B,B,A). So a pier is a line segment A->B, not an area quad. We
    emit it directly as {sw, pier, x1,y1,x2,y2, thk}; normalize_piers passes
    segments through unchanged.

    Keep EVERY segment — ETABS meshes one physical wall into SW2a/SW2b/SW2c and
    the engine does collinear-overlap matching, so DO NOT pre-merge. The `sw`
    group is the pier label with its trailing segment letter stripped
    (SW2a -> SW2). Empty list when the model has no walls (correct, not a
    failure)."""
    out = []
    for w in walls_panels:
        verts = w.get("vertices", [])
        # distinct points in first-seen order (the two wall endpoints)
        distinct = []
        for v in verts:
            p = points.get(v)
            if not p:
                continue
            xy = (p["x_mm"], p["y_mm"])
            if xy not in distinct:
                distinct.append(xy)
        if len(distinct) < 2:
            continue                          # degenerate panel -> cannot place
        a, b = distinct[0], distinct[1]       # longest pier wall is the A->B chord
        pier = w.get("pier_label") or w.get("id")
        out.append({"sw": _sw_group(pier), "pier": pier,
                    "x1": a[0], "y1": a[1], "x2": b[0], "y2": b[1],
                    "thk": _panel_thickness(w)})
    return out


def _sw_group(pier: Optional[str]) -> Optional[str]:
    """Pier label -> wall group: strip a trailing segment suffix (SW2a -> SW2).
    Leaves labels without a suffix unchanged (SW10 -> SW10)."""
    if not pier:
        return pier
    return re.sub(r'(?<=\d)[a-z]+$', '', pier)


# thickness lives in the wall's shell-section name, e.g. "SW 250 M35" -> 250.
_THK_RE = re.compile(r'(\d+(?:\.\d+)?)')


def _panel_thickness(w: dict) -> float:
    thk = w.get("thk_mm") or w.get("thickness_mm")
    if isinstance(thk, list):
        thk = thk[0] if thk else None
    if thk:
        return float(thk)
    # fall back to the section name ("SW 250 M35")
    for sec in w.get("sections", []) or []:
        m = _THK_RE.search(sec)
        if m:
            return float(m.group(1))
    return 0.0
