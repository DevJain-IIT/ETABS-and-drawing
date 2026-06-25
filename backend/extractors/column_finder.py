"""
CivilSpace — GFC column finder (Stage 3B)
=========================================
Definition of a column (chosen for cross-architect generality): a COLUMN is a
FILLED grey/hatched rectangle of column-ish size. The clean separator — verified
against a real PDF — is FILL vs STROKE: column bodies are FILLED grey; structural
grid lines, beams, wall-hatching, and section details are STROKE-only grey. So we
sweep EVERY layer and keep only paths that carry a grey FILL; the stroke-only
noise (grid/beams/hatch) drops out automatically with NO layer-name dependency
and NO need to special-case any "ceiling"/grid layer.

Pipeline (deterministic, no LLM, no network):
  1. sweep ALL layers; keep every path with a grey FILL (grey = R≈G≈B in a mid
     band). Stroke-only grey (grid/beam/hatch lines) is ignored.
  2. CLUSTER adjacent fill fragments into one box per symbol (union-find + gap).
  3. RELATIVE-GEOMETRY filter (Rule 1 — scales to any drawing): keep grey boxes
     whose footprint is within ~0.25x..6x the sheet's MEDIAN box area (drops lift
     cores / title blocks / legends — too big — without any fixed mm constant),
     then CLASSIFY each kept box by aspect ratio (§0a structural rule):
        aspect <= 4  -> kind "column"  (eligible for a C-mark name C1, C2…)
        aspect >  4  -> kind "wall"    (a SHEAR WALL — named "SW", never C-mark)
     A shear wall is a real structural element, NOT noise: we classify it, we do
     not discard it (a QA tool must surface every member it finds).
  4. emit GfcCol {id, cx, cy, rw, rh, kind, aspect} (PDF pts, y-DOWN) + a report.

(History: an earlier version scoped to COL-named layers because a grey sweep that
included STROKES glued grid-line dash slivers into phantom boxes. Switching to
FILLED-only removes that artifact and the layer-name dependency entirely.)

Human-in-the-loop (by design): the extractor errs toward the consistent grey
set. In the browser the engineer can DELETE a wrongly-included box (a hatched
wall/lift that slipped through) or ADD one we missed (e.g. a hollow/un-greyed
column). Hollow-column auto-recovery is a later refinement pass.

Also returns beam-line evidence (beam layer when present, else non-column
straight segments) for Stage 3C, and a page raster for the canvas.
"""
from __future__ import annotations
import base64
import re
import statistics
from collections import defaultdict, Counter
from typing import Optional

try:
    import fitz  # PyMuPDF
except ImportError:                       # pragma: no cover
    fitz = None


# grey / hatch detection
GREY_LO, GREY_HI, GREY_CHROMA = 0.35, 0.97, 0.08
CLUSTER_GAP = 2.0
MIN_SIDE = 3.0                            # below this is clustering noise / hatch tick

# relative-geometry column gate (all RELATIVE to the sheet median -> scale-free)
AREA_LO_FRAC = 0.25                       # a column is >= 0.25x the median box area
AREA_HI_FRAC = 3.0                        # and <= 3x it (bigger -> lift/large block)
SW_ASPECT = 4.0                           # aspect > this -> shear wall (kind "wall") [§0a]

COLUMN_LAYER_PATTERN = re.compile(r"COL", re.I)   # matches AS-COLS, COL. HATCH, S COL. OVER…
BEAM_LAYER_PATTERNS = [r"\bS[\s_-]*BEAM\b", r"rcc\s*beam", r"\bBEAM\b"]
EXCLUDE_FROM_BEAM = [r"GRID", r"DIM", r"TEXT", r"COL", r"TITLE", r"LEGEND", r"SYMB"]
MIN_BEAM_LINE = 20.0                      # pts; drop zero-length / sub-pixel fragments
RASTER_DPI = 110


def _is_grey(c) -> bool:
    if not c:
        return False
    r, g, b = c
    return abs(r - g) < GREY_CHROMA and abs(g - b) < GREY_CHROMA and GREY_LO < r < GREY_HI


def _frag(dr) -> Optional[tuple]:
    r = dr["rect"]
    if r.width <= 0 and r.height <= 0:
        return None
    return (r.x0, r.y0, r.x1, r.y1)


def _wh(b):  return b[2] - b[0], b[3] - b[1]
def _area(b): w, h = _wh(b); return w * h
def _aspect(b): w, h = _wh(b); return max(w, h) / max(min(w, h), 1e-9)


# --------------------------------------------------------------------------- #
#  fragment clustering (union-find + spatial bucketing -> ~O(n))
# --------------------------------------------------------------------------- #
def _cluster(frags: list[tuple], gap: float) -> list[tuple]:
    n = len(frags)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = 50.0
    buckets: dict[tuple, list[int]] = defaultdict(list)
    for i, fr in enumerate(frags):
        buckets[(int((fr[0] + fr[2]) / 2 // cell),
                 int((fr[1] + fr[3]) / 2 // cell))].append(i)
    for i, fr in enumerate(frags):
        cx = int((fr[0] + fr[2]) / 2 // cell)
        cy = int((fr[1] + fr[3]) / 2 // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in buckets.get((cx + dx, cy + dy), ()):
                    if j > i and not (frags[j][0] > fr[2] + gap or frags[j][2] < fr[0] - gap
                                      or frags[j][1] > fr[3] + gap or frags[j][3] < fr[1] - gap):
                        parent[find(i)] = find(j)

    groups: dict[int, list[tuple]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(frags[i])
    return [(min(x[0] for x in c), min(x[1] for x in c),
             max(x[2] for x in c), max(x[3] for x in c)) for c in groups.values()]


# --------------------------------------------------------------------------- #
#  main entry
# --------------------------------------------------------------------------- #
def detect_columns(pdf_path: str, sheet: int = 0,
                   cluster_gap: float = CLUSTER_GAP) -> dict:
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is required for column_finder")
    doc = fitz.open(pdf_path)
    page = doc[sheet]
    draws = page.get_drawings()

    by_layer: dict[str, list] = defaultdict(list)
    for dr in draws:
        by_layer[dr.get("layer") or ""].append(dr)

    # 1) sweep ALL layers; keep only paths with a grey FILL. Stroke-only grey
    #    (structural grid lines, beams, wall-hatch, section detail) is ignored —
    #    that is the clean fill-vs-stroke separator, so no layer-name scoping and
    #    no special-casing any grid/ceiling layer is needed.
    grey_frags, frag_layer = [], []
    for ly, drs in by_layer.items():
        for dr in drs:
            if _is_grey(dr.get("fill")):
                f = _frag(dr)
                if f:
                    grey_frags.append(f)
                    frag_layer.append(ly)

    # 2) cluster into boxes
    boxes = _cluster(grey_frags, cluster_gap)
    boxes = [b for b in boxes if _wh(b)[0] >= MIN_SIDE and _wh(b)[1] >= MIN_SIDE]

    # 3) relative-geometry gate (Rule 1): SIZE decides keep/reject (compact vs the
    #    sheet median — drops lift cores / title blocks / legends). ASPECT then
    #    only CLASSIFIES the kept boxes: <=4 column, >4 shear wall. A shear wall is
    #    a real member, so it is kept and tagged kind "wall" — never discarded.
    if boxes:
        med_area = statistics.median([_area(b) for b in boxes])
    else:
        med_area = 0.0
    kept, rejected = [], []
    for b in boxes:
        if med_area > 0 and AREA_LO_FRAC * med_area <= _area(b) <= AREA_HI_FRAC * med_area:
            kept.append(b)
        else:
            rejected.append(b)   # size outlier -> HITL add/delete list, not a member

    gfc_cols = []
    for i, b in enumerate(sorted(kept, key=lambda b: (b[1], b[0])), 1):
        ar = _aspect(b)
        kind = "wall" if ar > SW_ASPECT else "column"
        gfc_cols.append({"id": f"GFC_{i}", "cx": round((b[0] + b[2]) / 2, 2),
                         "cy": round((b[1] + b[3]) / 2, 2),
                         "rw": round(_wh(b)[0], 2), "rh": round(_wh(b)[1], 2),
                         "kind": kind, "aspect": round(ar, 2)})

    # report: which layers contributed grey fragments
    layer_contrib = Counter(frag_layer)

    raw_lines = _beam_lines(by_layer, [ly for ly in by_layer if ly])
    img = _raster(page)
    doc.close()
    return {
        "gfc_cols": gfc_cols,
        "raw_lines": raw_lines,
        "img": img,
        "report": {
            "fill_only_all_layers": True,
            "grey_fragments": len(grey_frags),
            "clustered_boxes": len(boxes),
            "kept_columns": sum(1 for g in gfc_cols if g["kind"] == "column"),
            "kept_walls": sum(1 for g in gfc_cols if g["kind"] == "wall"),
            "kept_total": len(gfc_cols),
            "rejected_outliers": len(rejected),
            "median_box_area": round(med_area, 1),
            "fragment_layers": dict(layer_contrib),
            "rejected_boxes": [{"cx": round((b[0] + b[2]) / 2, 1),
                                "cy": round((b[1] + b[3]) / 2, 1),
                                "rw": round(_wh(b)[0], 1), "rh": round(_wh(b)[1], 1),
                                "area": round(_area(b), 0), "aspect": round(_aspect(b), 1)}
                               for b in sorted(rejected, key=lambda b: -_area(b))],
        },
    }


def _beam_lines(by_layer: dict, layers: list[str]) -> list[dict]:
    # Prefer beam layers by name (S-BEAM, "primary"/primery o.b, rcc beam). The
    # raw vector stream has many zero-length fragments, so keep only real
    # segments (length >= MIN_BEAM_LINE pts). Fall back to non-noise layers if no
    # beam layer exists (flat export).
    beam_pat = re.compile(r"beam|primery|primary[\s_-]*o", re.I)
    src = [ly for ly in layers if beam_pat.search(ly)]
    if not src:
        excl = re.compile("|".join(EXCLUDE_FROM_BEAM), re.I)
        src = [ly for ly in layers if not excl.search(ly)]
    lines = []
    for ly in src:
        for dr in by_layer[ly]:
            for it in dr.get("items", []):
                if it[0] == "l":
                    x1, y1, x2, y2 = it[1].x, it[1].y, it[2].x, it[2].y
                    if (x1 - x2) ** 2 + (y1 - y2) ** 2 >= MIN_BEAM_LINE ** 2:
                        lines.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2})
    return lines


def _raster(page, dpi: int = RASTER_DPI) -> dict:
    pix = page.get_pixmap(dpi=dpi)
    b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
    return {"w": pix.width, "h": pix.height, "src": f"data:image/png;base64,{b64}"}


if __name__ == "__main__":
    import sys, json
    res = detect_columns(sys.argv[1])
    r = res["report"]
    print(f"kept_columns={r['kept_columns']}  kept_walls(SW)={r['kept_walls']}  "
          f"(from {r['grey_fragments']} grey frags -> {r['clustered_boxes']} boxes, "
          f"{r['rejected_outliers']} size-rejected)")
    print(f"median box area={r['median_box_area']}  fragment layers={r['fragment_layers']}")
    print("rejected outliers (architect can keep these by 'add' if real):")
    for rb in r["rejected_boxes"][:10]:
        print(f"   at ({rb['cx']},{rb['cy']}) {rb['rw']}x{rb['rh']} area={rb['area']} aspect={rb['aspect']}")
    print(f"raw_lines={len(res['raw_lines'])}  img={res['img']['w']}x{res['img']['h']}")
