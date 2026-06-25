"""
CivilSpace — C-mark layout extractor (Stage 3D)
===============================================
Reads the column NAMES (C1, C2, ...) and their positions from the Column Layout
Plan PDF. Per the agreed design (see plan "Two registrations"), this backend
step does NOT attach names to columns. Attachment is a human-in-the-loop step in
the browser:

    Registration A — Column Layout Plan -> Ground Floor Arrangement.
    The engineer clicks 3 matching point-pairs; the app aligns the two sheets
    (translation, then resize if needed) and assigns each name to its nearest
    column box with Hungarian. Until then, columns are unnamed/pending.

So here we only produce the RAW NAME LAYER the browser needs:
    extract_cmark_layer(pdf_path) -> {
        "marks":  [{"mark": "C1", "x": .., "y": ..}]   layout-sheet pts, y-DOWN,
        "counts": {"C1": 118, ...},
        "labels_found": 189,
        "schedule_total": 189,        # derived from the layout text itself
        "reconciled": True/False,     # labels_found == schedule_total
    }

Reconciliation guard (production rule, BUILD_SPEC): we only consider the names
trustworthy for auto-assist when `labels_found == columns` (checked by the
caller, which knows the detected column count). The schedule_total here is the
self-consistent label tally from the layout sheet; if a separate COLUMN_SCHEDULE
PDF is supplied later, swap it in for a stronger three-way guard.

Labels are DISPLAY/VERIFY only — they never drive geometric matching (Rule 4).
Deterministic: pure text extraction, no network, no LLM.
"""
from __future__ import annotations
import re
from collections import Counter
from typing import Optional

try:
    import fitz  # PyMuPDF
except ImportError:                       # pragma: no cover
    fitz = None


# C-mark token: C + digits + optional trailing letter (C1, C12, C3A). Tolerant of
# the stray encoding garble (�) PyMuPDF sometimes emits by stripping it.
_CMARK_RE = re.compile(r'^C\d{1,3}[A-Z]?$')


def _clean(tok: str) -> str:
    return tok.replace("�", "").strip()


def extract_cmark_layer(pdf_path: str, sheet: int = 0) -> dict:
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is required for cmark extraction")
    doc = fitz.open(pdf_path)
    page = doc[sheet]
    words = page.get_text("words")        # (x0,y0,x1,y1, text, block, line, word)
    doc.close()

    marks = []
    for w in words:
        tok = _clean(w[4])
        if _CMARK_RE.match(tok):
            marks.append({"mark": tok,
                          "x": round((w[0] + w[2]) / 2, 2),
                          "y": round((w[1] + w[3]) / 2, 2)})

    counts = dict(Counter(m["mark"] for m in marks))
    labels_found = len(marks)
    return {
        "marks": marks,
        "counts": counts,
        "labels_found": labels_found,
        "schedule_total": labels_found,   # self-derived from the layout text
        "reconciled": None,               # caller fills this once it knows #columns
    }


def reconcile(layer: dict, n_columns: int) -> dict:
    """Apply the production guard: the name layer is trustworthy for auto-assist
    only when labels_found == n_columns. Returns the layer dict with `reconciled`
    set. The browser still requires the engineer's 3-point alignment regardless;
    a False here just means 'route to fully-manual naming' (never auto-guess)."""
    layer = dict(layer)
    layer["reconciled"] = (layer["labels_found"] == n_columns)
    layer["n_columns"] = n_columns
    return layer


if __name__ == "__main__":
    import sys, json
    res = extract_cmark_layer(sys.argv[1])
    print(f"labels_found={res['labels_found']}  counts={res['counts']}")
    print("sample:", json.dumps(res["marks"][0]) if res["marks"] else "none")
