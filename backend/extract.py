"""
CivilSpace — v11 extraction pipeline (the "new backend work", BUILD_SPEC Stage 0)
=================================================================================
What is REAL here (implemented + unit-tested in test_extract.py):
  - collapse_double_lines()  §0c  : merge the two drawn face-lines into one centerline
  - corridor_evidence()      §3b  : coverage + CONTINUITY + ANGLE gate (kills phantom diagonals)
  - build_drawing_beams()    §3a+3b: column-pair candidates -> corridor-validated beams
  - normalize_piers()        §0d  : pier-segment passthrough / wall-rect -> centerline
  - aspect_classify()        §0a  : column / ambiguous / wall by aspect ratio
  - local_spacing helpers    Rule 1: everything stays relative

What is a PLUG-IN SEAM (lives on Vaibhav's machine, import here):
  - parse_etabs()   -> wraps parse_et.py        (ETABS_COLS, ETABS_BEAMS, raw piers)
  - detect_columns()-> wraps column_finder.py   (GFC_COLS)
  - attach_cmarks() -> wraps the cmark attach    (GFC_CMARK, flagged)
Each seam has a docstring stating EXACTLY what to return (the contract types).

Determinism (Rule 2): pure geometry, no LLM, no network, order-independent.
"""
from __future__ import annotations
import math
from typing import Optional


# --------------------------------------------------------------------------- #
#  Small geometry primitives
# --------------------------------------------------------------------------- #
def _hypot(ax, ay, bx, by): return math.hypot(ax - bx, ay - by)

def _angle_deg(x1, y1, x2, y2):
    """Undirected line angle in [0,180)."""
    a = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 180.0
    return a

def _angle_diff(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)

def _point_seg_dist(px, py, x1, y1, x2, y2):
    vx, vy = x2 - x1, y2 - y1
    L = vx * vx + vy * vy
    if L == 0: return _hypot(px, py, x1, y1)
    t = ((px - x1) * vx + (py - y1) * vy) / L
    t = max(0.0, min(1.0, t))
    return _hypot(px, py, x1 + t * vx, y1 + t * vy)

def _proj_t(px, py, x1, y1, x2, y2):
    """Parametric projection of (px,py) onto the infinite line through seg, in [.,.] not clamped."""
    vx, vy = x2 - x1, y2 - y1
    L = vx * vx + vy * vy
    if L == 0: return 0.0
    return ((px - x1) * vx + (py - y1) * vy) / L


def estimate_member_width(gfc_cols: list[dict]) -> Optional[float]:
    """Drawing-scale proxy: median drawn column thickness (min of rw,rh) in the
    PDF's own units. Beam face-gaps and widths scale with this, so deriving from
    it generalizes across differently-scaled drawings instead of a fixed point
    value tuned to one sheet. Returns None if no column dims available."""
    dims = sorted(min(g["rw"], g["rh"]) for g in gfc_cols
                  if g.get("rw") and g.get("rh"))
    return dims[len(dims) // 2] if dims else None


# --------------------------------------------------------------------------- #
#  §0a  aspect-ratio classification (column / ambiguous / wall)
# --------------------------------------------------------------------------- #
def aspect_classify(rw: float, rh: float) -> str:
    """BUILD_SPEC §0a / locked aspect policy. Never hard-cut at 2.5; the
    ambiguous band is arbitrated later by the engine's pier cross-check."""
    a = max(rw, rh) / max(min(rw, rh), 1e-9)
    if a <= 2.0:  return "column"
    if a <= 4.0:  return "ambiguous"
    return "wall"


# --------------------------------------------------------------------------- #
#  Rule 1  local spacing (the relative yardstick)
# --------------------------------------------------------------------------- #
def local_spacing(cols: list[dict], i: int) -> float:
    """Nearest-neighbour distance to column i — the local yardstick all gates use."""
    ci = cols[i]
    best = math.inf
    for j, cj in enumerate(cols):
        if j == i: continue
        d = _hypot(ci["x"], ci["y"], cj["x"], cj["y"])
        if d < best: best = d
    return best if math.isfinite(best) else 0.0


# --------------------------------------------------------------------------- #
#  §0c  collapse double face-lines -> one centerline edge
# --------------------------------------------------------------------------- #
def _auto_width_band(segments, ang, angle_tol_deg, overlap_min):
    """Estimate the beam face-gap band FROM THE LINES (unit-agnostic), so beam
    extraction scales to any drawing instead of a tuned point value. Collects
    perpendicular gaps of near-parallel overlapping pairs; the real face-gaps
    form the dominant low cluster. Returns (width_min, width_max) or None.
    NOTE: heuristic — validate against a real line extractor + PDF."""
    gaps = []
    n = len(segments)
    for i in range(n):
        si = segments[i]; Li = _hypot(si["x1"], si["y1"], si["x2"], si["y2"])
        if Li <= 0: continue
        for j in range(i + 1, n):
            if _angle_diff(ang[i], ang[j]) > angle_tol_deg: continue
            sj = segments[j]
            mjx, mjy = (sj["x1"] + sj["x2"]) / 2, (sj["y1"] + sj["y2"]) / 2
            gap = _point_seg_dist(mjx, mjy, si["x1"], si["y1"], si["x2"], si["y2"])
            if gap <= 1e-6: continue
            if _axial_overlap(si, sj) / Li < overlap_min: continue
            gaps.append(gap)
    if not gaps: return None
    gaps.sort()
    med = gaps[len(gaps) // 2]                       # robust central gap
    return (0.4 * med, 2.5 * med)


def collapse_double_lines(segments: list[dict],
                          width_min: float = None, width_max: float = None,
                          angle_tol_deg: float = 1.0,
                          overlap_min: float = 0.5) -> list[dict]:
    """
    BUILD_SPEC §0c. Beams are drawn as TWO parallel face-lines. Collapse each
    parallel, beam-width-apart, overlapping pair into one centerline edge.

    segments: [{'x1','y1','x2','y2'}, ...] raw vector lines (arrangement sheet)
    width_min/width_max: expected perpendicular gap between the two faces. If left
      None, the band is AUTO-DETECTED from the line distribution (generalizes
      across drawing scales). Pass explicit values only to override.
    returns centerlines: [{'x1','y1','x2','y2','width','faces'}]
    Deterministic: pairs evaluated in sorted order; each segment used once.
    """
    n = len(segments)
    ang = [_angle_deg(s["x1"], s["y1"], s["x2"], s["y2"]) for s in segments]
    if width_min is None or width_max is None:
        band = _auto_width_band(segments, ang, angle_tol_deg, overlap_min)
        if band is None:
            return [{"x1": s["x1"], "y1": s["y1"], "x2": s["x2"], "y2": s["y2"],
                     "width": 0.0, "faces": 1} for s in segments]
        width_min, width_max = band
    used = [False] * n
    out = []
    order = sorted(range(n), key=lambda k: (segments[k]["x1"], segments[k]["y1"]))
    for ii in range(len(order)):
        i = order[ii]
        if used[i]: continue
        si = segments[i]
        best_j, best_gap = -1, math.inf
        for jj in range(ii + 1, len(order)):
            j = order[jj]
            if used[j]: continue
            if _angle_diff(ang[i], ang[j]) > angle_tol_deg: continue
            # perpendicular gap: distance from j's midpoint to i's infinite line
            mjx, mjy = (segments[j]["x1"] + segments[j]["x2"]) / 2, (segments[j]["y1"] + segments[j]["y2"]) / 2
            gap = _point_seg_dist(mjx, mjy, si["x1"], si["y1"], si["x2"], si["y2"])
            if not (width_min <= gap <= width_max): continue
            # require axial overlap so we don't pair two unrelated collinear-offset lines
            ov = _axial_overlap(si, segments[j])
            Li = _hypot(si["x1"], si["y1"], si["x2"], si["y2"])
            if Li <= 0 or ov / Li < overlap_min: continue
            if gap < best_gap:
                best_gap, best_j = gap, j
        if best_j >= 0:
            sj = segments[best_j]
            used[i] = used[best_j] = True
            cx1, cy1 = (si["x1"] + sj["x1"]) / 2, (si["y1"] + sj["y1"]) / 2
            cx2, cy2 = (si["x2"] + sj["x2"]) / 2, (si["y2"] + sj["y2"]) / 2
            out.append({"x1": cx1, "y1": cy1, "x2": cx2, "y2": cy2,
                        "width": best_gap, "faces": 2})
    # leftover singles are kept as faces=1 (could be a single-face beam or a stray line)
    for k in range(n):
        if not used[k]:
            s = segments[k]
            out.append({"x1": s["x1"], "y1": s["y1"], "x2": s["x2"], "y2": s["y2"],
                        "width": 0.0, "faces": 1})
    return out


def _axial_overlap(a: dict, b: dict) -> float:
    """Length of overlap of b projected onto a's axis (in a's units)."""
    ta1 = 0.0
    ta2 = _hypot(a["x1"], a["y1"], a["x2"], a["y2"])
    if ta2 == 0: return 0.0
    tb1 = _proj_t(b["x1"], b["y1"], a["x1"], a["y1"], a["x2"], a["y2"]) * ta2
    tb2 = _proj_t(b["x2"], b["y2"], a["x1"], a["y1"], a["x2"], a["y2"]) * ta2
    lo, hi = sorted((tb1, tb2))
    return max(0.0, min(hi, ta2) - max(lo, 0.0))


# --------------------------------------------------------------------------- #
#  §3b  corridor + continuity + angle gate
# --------------------------------------------------------------------------- #
def corridor_evidence(p1: tuple, p2: tuple, centerlines: list[dict],
                      beam_width: float, local_sp: float,
                      lf_min: float = 0.8, gap_max_frac: float = 0.1,
                      angle_tol_deg: float = 5.0) -> dict:
    """
    BUILD_SPEC §3b. For a candidate beam between column centres p1->p2, gather
    line evidence inside a NARROW corridor and apply three gates so coverage
    alone (which is gameable) cannot fake a phantom diagonal:
      1. coverage Lf  (fraction of span covered by aligned evidence)
      2. CONTINUITY   (one contiguous run; internal gaps < gap_max_frac * span)
      3. ANGLE        (evidence roughly parallel to the p1->p2 axis)
    Returns {'Lf','contiguous','aligned','pass'} — all RELATIVE to local spacing.
    """
    x1, y1 = p1; x2, y2 = p2
    span = _hypot(x1, y1, x2, y2)
    if span <= 0:
        return {"Lf": 0.0, "contiguous": False, "aligned": False, "pass": False}
    half_corridor = beam_width / 2.0 + 0.1 * local_sp     # width + relative tol (Rule 1)
    axis_ang = _angle_deg(x1, y1, x2, y2)
    intervals = []
    aligned_any = False
    for c in centerlines:
        # angle gate
        ca = _angle_deg(c["x1"], c["y1"], c["x2"], c["y2"])
        if _angle_diff(ca, axis_ang) > angle_tol_deg:
            continue
        # corridor gate: both endpoints within the corridor band of the axis
        d1 = _point_seg_dist(c["x1"], c["y1"], x1, y1, x2, y2)
        d2 = _point_seg_dist(c["x2"], c["y2"], x1, y1, x2, y2)
        if d1 > half_corridor or d2 > half_corridor:
            continue
        aligned_any = True
        t1 = _proj_t(c["x1"], c["y1"], x1, y1, x2, y2)
        t2 = _proj_t(c["x2"], c["y2"], x1, y1, x2, y2)
        lo, hi = sorted((t1, t2))
        lo = max(0.0, lo); hi = min(1.0, hi)
        if hi > lo:
            intervals.append((lo, hi))
    if not intervals:
        return {"Lf": 0.0, "contiguous": False, "aligned": aligned_any, "pass": False}
    # union of intervals along the axis (parametric 0..1)
    intervals.sort()
    merged = [list(intervals[0])]
    biggest_gap = 0.0
    for lo, hi in intervals[1:]:
        if lo <= merged[-1][1] + 1e-9:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            biggest_gap = max(biggest_gap, lo - merged[-1][1])
            merged.append([lo, hi])
    covered = sum(hi - lo for lo, hi in merged)
    Lf = covered  # already fraction of span (parametric)
    contiguous = (len(merged) == 1) or (biggest_gap <= gap_max_frac)
    aligned = aligned_any
    passed = (Lf >= lf_min) and contiguous and aligned
    return {"Lf": round(Lf, 3), "contiguous": contiguous, "aligned": aligned, "pass": passed,
            "biggest_gap": round(biggest_gap, 3)}


# --------------------------------------------------------------------------- #
#  §3a+3b  build the corridor-validated DRAWING_BEAMS
# --------------------------------------------------------------------------- #
def build_drawing_beams(gfc_cols: list[dict], centerlines: list[dict],
                        beam_width: float,
                        pair_max_spacing_frac: float = 1.6) -> list[dict]:
    """
    Candidate beam = a column pair close enough to be a single bay apart, that
    passes the corridor gate. Identity stays by position (Rule 4); 'mark'/'size'
    ride along only if a labelled centerline supports the run.

    gfc_cols: [{'id','x','y'}]  (x,y in drawing pts; cx/cy mapped by caller)
    returns DrawingBeam-shaped dicts.
    """
    beams = []
    n = len(gfc_cols)
    # precompute local spacing per column
    sp = [local_spacing(gfc_cols, i) for i in range(n)]
    bid = 0
    for i in range(n):
        for j in range(i + 1, n):
            a, b = gfc_cols[i], gfc_cols[j]
            d = _hypot(a["x"], a["y"], b["x"], b["y"])
            local_sp = min(sp[i], sp[j]) or d
            # only test pairs within ~one bay (else every far pair is a candidate => O(n^2) noise)
            if local_sp > 0 and d > pair_max_spacing_frac * local_sp:
                continue
            ev = corridor_evidence((a["x"], a["y"]), (b["x"], b["y"]),
                                   centerlines, beam_width, local_sp)
            if ev["pass"]:
                bid += 1
                beams.append({"id": f"DB_{bid}", "a": a["id"], "b": b["id"],
                              "mark": None, "size": None, "faces": 2,
                              "Lf": ev["Lf"], "contiguous": ev["contiguous"],
                              "aligned": ev["aligned"]})
    return beams


# --------------------------------------------------------------------------- #
#  §0d  pier normalization (wall-rect -> centerline, segment passthrough)
# --------------------------------------------------------------------------- #
def normalize_piers(raw_piers: list[dict]) -> list[dict]:
    """
    Accepts either already-segmented piers ({sw,pier,x1,y1,x2,y2,thk}) or
    wall rectangles ({sw,pier,corners:[(x,y)*4],thk}) and emits centerline
    segments. ETABS meshes one wall into SW2a/b/c — DO NOT merge here.
    """
    out = []
    for p in raw_piers:
        if all(k in p for k in ("x1", "y1", "x2", "y2")):
            out.append({"sw": p.get("sw"), "pier": p.get("pier"),
                        "x1": p["x1"], "y1": p["y1"], "x2": p["x2"], "y2": p["y2"],
                        "thk": p.get("thk", 0.0)})
        elif "corners" in p and len(p["corners"]) == 4:
            (a, b, c, d) = p["corners"]
            # long-axis centerline = midpoints of the two short sides
            e1 = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            e2 = ((c[0] + d[0]) / 2, (c[1] + d[1]) / 2)
            len1 = _hypot(*e1, *e2)
            f1 = ((a[0] + d[0]) / 2, (a[1] + d[1]) / 2)
            f2 = ((b[0] + c[0]) / 2, (b[1] + c[1]) / 2)
            len2 = _hypot(*f1, *f2)
            (s, t) = (e1, e2) if len1 >= len2 else (f1, f2)
            out.append({"sw": p.get("sw"), "pier": p.get("pier"),
                        "x1": s[0], "y1": s[1], "x2": t[0], "y2": t[1],
                        "thk": p.get("thk", 0.0)})
    return out


# =========================================================================== #
#  PLUG-IN SEAMS — wired to the CivilSpace extractors in extractors/.
#  parse_etabs  -> extractors.parse_et + extractors.etabs_adapter   (Stage 3A)
#  detect_columns -> extractors.column_finder                        (Stage 3B)
#  extract_cmark_layer -> extractors.cmark                           (Stage 3D)
# =========================================================================== #
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "extractors"))


def parse_etabs(et_path: str) -> dict:
    """
    Stage 3A. parse_et.py canonical JSON -> contract ETABS arrays via the adapter.
    Returns {etabs_cols, etabs_beams, raw_piers} in ETABS model mm, y-UP (no flip).
    """
    import parse_et, etabs_adapter
    model = parse_et.parse(et_path)
    return etabs_adapter.adapt(model)


def detect_columns(pdf_path: str, sheet: int = 0) -> dict:
    """
    Stage 3B. Grey/hatched box detection on column layers + relative-geometry
    filter. Returns the FULL column_finder result:
      {gfc_cols, raw_lines, img, report}
    gfc_cols: [{id,cx,cy,rw,rh}] PDF pts y-DOWN. raw_lines feed Stage 3C. The
    `report.rejected_boxes` are surfaced to the engineer for add/delete review.
    """
    import column_finder
    return column_finder.detect_columns(pdf_path, sheet=sheet)


def extract_vector_layer(pdf_path: str, sheet: int = 0) -> dict:
    """
    Extract all vector paths + text from a PDF page as compact JSON.
    The browser renders these natively on a canvas — crisp at any zoom.
    Returns {page_w, page_h, paths:[{fill,stroke,width,items}], texts:[{x,y,s,t,c}]}.
    """
    import vector_layer
    return vector_layer.extract_vectors(pdf_path, sheet=sheet)


def extract_cmark_layer(pdf_path: str, sheet: int = 0) -> dict:
    """
    Stage 3D. Raw C-mark NAME layer from the column-layout PDF. Does NOT attach
    names to columns — attachment is the browser 'Name the columns' step
    (Registration A: user 3-point seed -> translation/resize -> Hungarian).
    Returns {marks:[{mark,x,y}], counts, labels_found, schedule_total, reconciled}.
    Labels are DISPLAY/VERIFY only; they never drive matching (Rule 4).
    """
    import cmark
    return cmark.extract_cmark_layer(pdf_path, sheet=sheet)


# =========================================================================== #
#  Stage 0 ORCHESTRATOR — assemble the full data Contract from raw uploads.
#  Build order (user-directed): 3A ETABS -> 3B columns -> 3D names -> 3C beams.
#  3C (drawing beams) plugs in later; until then drawing_beams is honestly empty.
# =========================================================================== #
def build_contract(project_name: str, et_path: str, arrangement_pdf: str,
                   layout_pdf: Optional[str] = None,
                   floor_pdf: Optional[str] = None) -> dict:
    """Run the extraction pipeline and return a Contract-shaped dict (validate it
    against contract.Contract before storing). Pure function of the input files;
    deterministic. drawing_beams stays empty until Stage 3C is wired.

    The raw C-mark NAME layer rides in `schedule['cmark_layer']` (the contract's
    free-form display/verify slot) — gfc_cmark starts EMPTY because names are
    attached in the browser 'Name the columns' step, not here. The 3B-rejected
    boxes ride in `schedule['column_review']` so the engineer can add/delete.
    """
    # 3A — ETABS side
    et = parse_etabs(et_path)
    walls = normalize_piers(et["raw_piers"])

    # 3B — GFC columns (grey/hatched boxes on column layers) + by-products
    det = detect_columns(arrangement_pdf)
    gfc_cols = det["gfc_cols"]
    img = det.get("img") or {"w": 0, "h": 0, "src": ""}
    review = det.get("report", {})

    # 3D — STEP 1 "Name the columns" (Registration A), all on the ONE Column
    # Layout Plan sheet: it carries BOTH the column boxes AND the C-mark names in
    # the same coordinate frame. So we detect the layout-sheet boxes (classified
    # column vs shear-wall by aspect) and the name marks from the SAME pdf — the
    # browser then Hungarian-matches names to columns directly (no calibration,
    # one frame) and the engineer flags/confirms. Names are NOT attached here.
    if layout_pdf:
        import cmark as _cmark
        layout_det = detect_columns(layout_pdf)
        layout_cols = layout_det["gfc_cols"]          # {id,cx,cy,rw,rh,kind,aspect}
        layout_review = layout_det.get("report", {})
        cmark_layer = _cmark.reconcile(
            extract_cmark_layer(layout_pdf),
            sum(1 for c in layout_cols if c.get("kind") == "column"))
        # Vector layer: extract PDF paths + text as JSON so the browser can render
        # the drawing natively (crisp at any zoom, unlike a raster PNG).
        layout_vectors = extract_vector_layer(layout_pdf)
    else:
        layout_cols, layout_review = [], {}
        layout_vectors = {"page_w": 0, "page_h": 0, "paths": [], "texts": []}
        cmark_layer = {"marks": [], "counts": {}, "labels_found": 0,
                       "schedule_total": 0, "reconciled": None}

    # FLOOR PLAN — Step 2 "Overlay on ground floor".
    # The arrangement PDF (gfc_pdf) IS the ground floor plan in most projects.
    # If a separate floor_pdf is uploaded, use that; otherwise reuse the arrangement.
    _floor_src = floor_pdf or arrangement_pdf
    if _floor_src == arrangement_pdf:
        # Reuse already-computed detection — no extra work needed.
        floor_cols = det["gfc_cols"]
        floor_vectors = extract_vector_layer(arrangement_pdf)
    else:
        _floor_det = detect_columns(_floor_src)
        floor_cols = _floor_det["gfc_cols"]
        floor_vectors = extract_vector_layer(_floor_src)

    # 3C — drawing beams: collapse the real beam face-lines into centerlines
    # (auto beam-width band), then corridor-validate column-pair candidates. The
    # corridor gate (coverage + continuity + angle) rejects phantom diagonals, so
    # only real beams survive. pair_max_spacing_frac=2.5 is a reasonable net; the
    # exact threshold awaits the BUILD_SPEC §9 corpus sweep.
    raw_lines = det.get("raw_lines", [])
    centerlines = collapse_double_lines(raw_lines)
    widths = [c["width"] for c in centerlines if c.get("faces") == 2 and c.get("width")]
    beam_w = (sorted(widths)[len(widths) // 2] if widths else 15.0)
    cols_xy = [{"id": g["id"], "x": g["cx"], "y": g["cy"]} for g in gfc_cols]
    drawing_beams = build_drawing_beams(cols_xy, centerlines, beam_width=beam_w,
                                        pair_max_spacing_frac=2.5)

    schedule = {
        # display/verify extras the engine/UI read but the schema keeps opaque:
        "cmark_layer": cmark_layer,             # {marks:[{mark,x,y}], counts, ...}
        # STEP 1 naming runs on the Column Layout sheet: its boxes (classified
        # column/wall) + vector drawing live here, in the SAME frame as cmark_layer.marks.
        "layout_cols": layout_cols,             # [{id,cx,cy,rw,rh,kind,aspect}]
        "layout_vectors": layout_vectors,       # {page_w,page_h,paths,texts} — rendered natively on canvas
        # STEP 2 floor overlay: columns + vector layer from the ground floor / arrangement PDF.
        # The browser uses these to render clickable grey/hatched column boxes on the floor plan.
        "floor_cols": floor_cols,               # [{id,cx,cy,rw,rh,kind,aspect}]
        "floor_vectors": floor_vectors,         # {page_w,page_h,paths,texts}
        "layout_review": {                      # size-outliers for HITL add/delete
            "rejected_boxes": layout_review.get("rejected_boxes", []),
            "kept_columns": layout_review.get("kept_columns", 0),
            "kept_walls": layout_review.get("kept_walls", 0),
            "median_box_area": layout_review.get("median_box_area"),
        },
        "column_review": {                      # 3B arrangement outliers (Step 2/ETABS)
            "rejected_boxes": review.get("rejected_boxes", []),
            "kept_columns": review.get("kept_columns", len(gfc_cols)),
            "median_box_area": review.get("median_box_area"),
        },
        "raw_line_count": len(det.get("raw_lines", [])),
    }

    return {
        "project_name": project_name,
        "img": img,
        "etabs_cols": et["etabs_cols"],
        "etabs_beams": et["etabs_beams"],
        "etabs_walls": walls,
        "gfc_cols": gfc_cols,
        "gfc_cmark": {},                        # attached in the browser, not here
        "gfc_cmark_flagged": [],
        "drawing_beams": drawing_beams,         # Stage 3C (pending)
        "secondary_draw": [],
        "schedule": schedule,
    }
