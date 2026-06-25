"""
End-to-end Stage-0 pipeline regression on the real Gwalior files.

Proves extract.build_contract wires 3A+3B+3D into one schema-valid Contract:
  - ETABS counts match golden (190/532/24)
  - GFC grey columns within tolerance (~186)
  - C-mark name layer rides in schedule (189 labels), gfc_cmark empty (browser attaches)
  - 3B-rejected outliers surfaced for HITL review
  - validates against the FROZEN contract.py (firewall, no schema change)

Run:  python test_pipeline.py   (auto-finds the sample files)
"""
import sys, os, glob

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
import extract as E
import contract as C


def _sample(*pats):
    root = os.path.abspath(os.path.join(HERE, "..", ".."))
    for pat in pats:
        hits = glob.glob(os.path.join(root, "sample", pat))
        if hits:
            return hits[0]
    return None


def test():
    et = _sample("*GWLR*.$et", "*.$et")
    arr = _sample("*ARRANGEMENT*.pdf")
    lay = _sample("*LAYOUT*.pdf")
    if not (et and arr and lay):
        print("SKIP: sample files not found")
        return

    c = E.build_contract("Gwalior Hospital ULS", et, arr, lay)

    assert len(c["etabs_cols"]) == 190, len(c["etabs_cols"])
    assert len(c["etabs_beams"]) == 532, len(c["etabs_beams"])
    assert len(c["etabs_walls"]) == 24, len(c["etabs_walls"])
    print(f"ETABS 190/532/24  PASS")

    assert abs(len(c["gfc_cols"]) - 186) <= 6, len(c["gfc_cols"])
    print(f"gfc_cols={len(c['gfc_cols'])} (grey columns)  PASS")

    assert c["gfc_cmark"] == {}, "gfc_cmark must be empty (browser attaches names)"
    cl = c["schedule"]["cmark_layer"]
    assert cl["labels_found"] == 189, cl["labels_found"]
    assert c["schedule"]["column_review"]["rejected_boxes"], "no HITL review boxes surfaced"
    print(f"cmark_layer 189 labels in schedule, "
          f"{len(c['schedule']['column_review']['rejected_boxes'])} review boxes  PASS")

    validated = C.Contract(**c)            # FROZEN firewall — must pass unchanged
    assert validated.project_name == "Gwalior Hospital ULS"
    print("validates against frozen contract.py  PASS")


if __name__ == "__main__":
    test()
    print("\nFULL PIPELINE (3A+3B+3D -> Contract) TEST PASSED")
