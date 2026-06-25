"""
Golden regression for Stage 3A (etabs_adapter) on the real Gwalior ETABS model.

Bar (per plan): element COUNTS + key SPOT assertions must match the handoff
fixtures; small per-coordinate deltas are acceptable elsewhere. Piers are checked
endpoint-exact against etabs_piers.json since that fixture is authoritative.

Run:  python test_etabs_adapter.py  [path-to-.et]
Defaults to the sample Gwalior model if no path is given.
"""
import sys, os, json, glob

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "extractors"))
import parse_et, etabs_adapter
import extract as E

HERE = os.path.dirname(__file__)
FIX = os.path.join(HERE, "fixtures")


def _default_et():
    # the Gwalior model lives in the repo's sample/ folder (two levels up)
    root = os.path.abspath(os.path.join(HERE, "..", ".."))
    hits = glob.glob(os.path.join(root, "sample", "*GWLR*.$et")) + \
           glob.glob(os.path.join(root, "sample", "*.$et"))
    return hits[0] if hits else None


def _pier_key(d):
    pts = tuple(sorted([(round(d["x1"]), round(d["y1"])),
                        (round(d["x2"]), round(d["y2"]))]))
    return (d["pier"], pts)


def test_gwalior(et_path):
    model = parse_et.parse(et_path)
    out = etabs_adapter.adapt(model)

    # ---- counts (handoff golden) ----
    assert len(out["etabs_cols"]) == 190, f"etabs_cols {len(out['etabs_cols'])} != 190"
    assert len(out["etabs_beams"]) == 532, f"etabs_beams {len(out['etabs_beams'])} != 532"
    assert len(out["etabs_walls" if False else "raw_piers"]) == 24, "raw_piers != 24"
    print(f"counts: cols={len(out['etabs_cols'])} beams={len(out['etabs_beams'])} "
          f"piers={len(out['raw_piers'])}  PASS")

    # ---- every column has resolved B/D and validates ----
    import contract as C
    bad = [c["id"] for c in out["etabs_cols"] if c["B"] == 0 or c["D"] == 0]
    assert not bad, f"columns with unresolved B/D: {bad[:5]}"
    [C.EtabsCol(**c) for c in out["etabs_cols"]]
    [C.EtabsBeam(**b) for b in out["etabs_beams"]]
    print("contract validation + B/D resolution  PASS")

    # ---- piers endpoint-exact vs golden fixture ----
    gold = json.load(open(os.path.join(FIX, "etabs_piers.json")))
    gold_k = {_pier_key(g) for g in gold}
    mine_k = {_pier_key(p) for p in out["raw_piers"]}
    assert mine_k == gold_k, (f"pier mismatch: missing {len(gold_k - mine_k)}, "
                              f"extra {len(mine_k - gold_k)}")
    print(f"piers endpoint-exact vs golden: {len(mine_k)}/{len(gold_k)}  PASS")

    # ---- normalize_piers round-trips them ----
    walls = E.normalize_piers(out["raw_piers"])
    assert len(walls) == 24, f"normalized walls {len(walls)} != 24"
    sw_groups = sorted({p["sw"] for p in out["raw_piers"]})
    assert len(sw_groups) == 11, f"sw groups {sw_groups}"
    print(f"normalize_piers -> {len(walls)} walls, {len(sw_groups)} SW groups  PASS")


if __name__ == "__main__":
    et = sys.argv[1] if len(sys.argv) > 1 else _default_et()
    if not et or not os.path.exists(et):
        print("SKIP: no Gwalior .et found (pass a path as argv[1])")
        sys.exit(0)
    print(f"Gwalior model: {os.path.basename(et)}")
    test_gwalior(et)
    print("\nALL 3A ADAPTER TESTS PASSED")
