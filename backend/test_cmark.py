"""
Regression for Stage 3D (cmark) on the real Gwalior Column Layout Plan PDF.

Bar: the C-mark LABEL COUNT and TYPE TALLY must match the golden fixture
(gfc_cmark_corrected.json) exactly — the layout text is authoritative and the
handoff documents C1:118 C2:40 C3:25 C4:4 C5:1 C6:1 = 189.

Run:  python test_cmark.py [path-to-layout.pdf]
"""
import sys, os, glob, json
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "extractors"))
import cmark

HERE = os.path.dirname(__file__)
GOLDEN_TOTAL = 189
GOLDEN_COUNTS = {"C1": 118, "C2": 40, "C3": 25, "C4": 4, "C5": 1, "C6": 1}


def _default_pdf():
    root = os.path.abspath(os.path.join(HERE, "..", ".."))
    hits = glob.glob(os.path.join(root, "sample", "*LAYOUT*.pdf"))
    return hits[0] if hits else None


def test(pdf):
    layer = cmark.extract_cmark_layer(pdf)
    print(f"labels_found={layer['labels_found']}  counts={layer['counts']}")

    assert layer["labels_found"] == GOLDEN_TOTAL, \
        f"labels {layer['labels_found']} != {GOLDEN_TOTAL}"
    assert layer["counts"] == GOLDEN_COUNTS, \
        f"type counts {layer['counts']} != {GOLDEN_COUNTS}"
    print("label count + type tally match golden  PASS")

    # cross-check against the golden cmark fixture's value distribution
    gold = json.load(open(os.path.join(HERE, "fixtures", "gfc_cmark_corrected.json")))
    gold_counts = dict(Counter(gold["cmark"].values()))
    assert gold_counts == layer["counts"], f"vs fixture: {gold_counts} != {layer['counts']}"
    print("matches gfc_cmark_corrected.json distribution  PASS")

    # every mark has a position; reconcile guard behaves
    assert all("x" in m and "y" in m for m in layer["marks"]), "marks missing positions"
    rec = cmark.reconcile(layer, n_columns=GOLDEN_TOTAL)
    assert rec["reconciled"] is True, "reconcile should pass when columns == labels"
    rec2 = cmark.reconcile(layer, n_columns=GOLDEN_TOTAL + 3)
    assert rec2["reconciled"] is False, "reconcile should fail when counts differ"
    print("positions present + reconcile guard correct  PASS")


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else _default_pdf()
    if not pdf or not os.path.exists(pdf):
        print("SKIP: no layout PDF found (pass a path as argv[1])")
        sys.exit(0)
    print(f"layout plan: {os.path.basename(pdf)}")
    test(pdf)
    print("\nALL 3D CMARK TESTS PASSED")
