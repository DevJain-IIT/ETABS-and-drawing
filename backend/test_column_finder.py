"""
Regression for Stage 3B (column_finder) on the real Gwalior arrangement PDF.

Bar (per plan): COUNT within tolerance of the golden 189 + STABILITY (layer-based
extraction must not swing with the clustering gap). We deliberately do NOT pin
exact coordinates — the golden GFC fixture lives in a different coordinate space,
and the engine's ICP normalizes scale/translation anyway.

Run:  python test_column_finder.py [path-to-arrangement.pdf]
"""
import sys, os, glob

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "extractors"))
import column_finder as cf

# Column = FILLED grey rectangle swept from ALL layers (fill-vs-stroke separator),
# after a relative-size + aspect filter. On Gwalior this yields ~190 columns
# (hollow/un-greyed ones are added by the engineer in the UI later).
GOLDEN = 190
TOL = 6


def _default_pdf():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    hits = glob.glob(os.path.join(root, "sample", "*ARRANGEMENT*.pdf"))
    return hits[0] if hits else None


def test(pdf):
    res = cf.detect_columns(pdf)
    cols = res["gfc_cols"]
    rep = res["report"]
    print(f"detected {len(cols)} columns  (golden {GOLDEN}, tol ±{TOL})")
    print(f"  fill-only all-layer sweep={rep['fill_only_all_layers']}, "
          f"median box area={rep['median_box_area']}, "
          f"{rep['rejected_outliers']} outliers flagged for review")
    assert rep["fill_only_all_layers"], "expected fill-only all-layer sweep"
    assert abs(len(cols) - GOLDEN) <= TOL, \
        f"column count {len(cols)} outside {GOLDEN}±{TOL}"
    print("count within tolerance  PASS")

    # stability: count must not swing with the clustering gap (layer + relative filter)
    counts = {g: len(cf.detect_columns(pdf, cluster_gap=g)["gfc_cols"])
              for g in (0.5, 1, 2, 3)}
    spread = max(counts.values()) - min(counts.values())
    print(f"gap-stability {counts} spread={spread}")
    assert spread <= 4, f"count unstable across gaps: {counts}"
    print("gap stability  PASS")

    # by-products present
    assert res["raw_lines"], "no beam line evidence extracted"
    assert res["img"]["w"] > 0 and res["img"]["src"].startswith("data:image/png"), "bad raster"
    print(f"by-products: {len(res['raw_lines'])} beam lines, "
          f"raster {res['img']['w']}x{res['img']['h']}  PASS")

    # contract shape
    import contract as C
    [C.GfcCol(**c) for c in cols]
    print("contract GfcCol validation  PASS")


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else _default_pdf()
    if not pdf or not os.path.exists(pdf):
        print("SKIP: no arrangement PDF found (pass a path as argv[1])")
        sys.exit(0)
    print(f"arrangement: {os.path.basename(pdf)}")
    test(pdf)
    print("\nALL 3B COLUMN-FINDER TESTS PASSED")
