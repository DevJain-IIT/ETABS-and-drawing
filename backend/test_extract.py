"""Run: python3 test_extract.py  — proves the new backend geometry is correct."""
import extract as E


def approx(a, b, t=1e-6): return abs(a - b) <= t


def test_collapse_double_lines():
    # Two parallel face-lines 12 pts apart, both spanning x=0..100 at y=0 and y=12
    segs = [
        {"x1": 0, "y1": 0, "x2": 100, "y2": 0},
        {"x1": 0, "y1": 12, "x2": 100, "y2": 12},
        # an unrelated crossing line (perpendicular) — must NOT pair
        {"x1": 50, "y1": -40, "x2": 50, "y2": 40},
    ]
    out = E.collapse_double_lines(segs, width_min=8, width_max=16)
    centers = [o for o in out if o["faces"] == 2]
    assert len(centers) == 1, f"expected 1 collapsed beam, got {len(centers)}"
    c = centers[0]
    assert approx(c["y1"], 6) and approx(c["y2"], 6), "centerline should sit at y=6"
    print("collapse_double_lines: PASS (1 centerline at y=6, crossing line not paired)")


def test_corridor_real_beam():
    # column pair along x-axis, span 5000mm; a real continuous beam line in the corridor
    p1, p2 = (0, 0), (5000, 0)
    centerlines = [{"x1": 50, "y1": 5, "x2": 4950, "y2": -5}]
    ev = E.corridor_evidence(p1, p2, centerlines, beam_width=230, local_sp=5000)
    assert ev["pass"] and ev["aligned"] and ev["contiguous"], ev
    print(f"corridor real beam: PASS (Lf={ev['Lf']}, contiguous, aligned)")


def test_corridor_phantom_diagonal():
    # THE loophole test: a diagonal corridor that only clips scattered fragments
    # of unrelated near-perpendicular beams must FAIL (coverage alone would lie).
    p1, p2 = (0, 0), (5000, 5000)
    centerlines = [
        {"x1": 1000, "y1": 980, "x2": 1100, "y2": 1300},   # crossing fragment (wrong angle)
        {"x1": 3000, "y1": 2980, "x2": 3100, "y2": 3300},  # another crossing fragment
    ]
    ev = E.corridor_evidence(p1, p2, centerlines, beam_width=230, local_sp=5000)
    assert not ev["pass"], f"phantom diagonal must be rejected, got {ev}"
    print(f"corridor phantom diagonal: PASS (rejected — angle/continuity gate held)")


def test_corridor_gappy_fails_continuity():
    # aligned evidence but two short pieces with a big gap -> coverage low AND non-contiguous
    p1, p2 = (0, 0), (5000, 0)
    centerlines = [
        {"x1": 0, "y1": 0, "x2": 800, "y2": 0},
        {"x1": 4200, "y1": 0, "x2": 5000, "y2": 0},
    ]
    ev = E.corridor_evidence(p1, p2, centerlines, beam_width=230, local_sp=5000)
    assert not ev["pass"], f"gappy evidence must fail, got {ev}"
    print(f"corridor gappy: PASS (rejected — Lf={ev['Lf']}, contiguous={ev['contiguous']})")


def test_build_beams():
    cols = [{"id": "A", "x": 0, "y": 0}, {"id": "B", "x": 5000, "y": 0},
            {"id": "C", "x": 0, "y": 5000}]
    centerlines = [{"x1": 50, "y1": 0, "x2": 4950, "y2": 0}]   # only A-B has a drawn line
    beams = E.build_drawing_beams(cols, centerlines, beam_width=230)
    pairs = {tuple(sorted((b["a"], b["b"]))) for b in beams}
    assert ("A", "B") in pairs and ("A", "C") not in pairs, pairs
    print(f"build_drawing_beams: PASS (A-B found, A-C correctly absent)")


def test_aspect():
    assert E.aspect_classify(400, 650) == "column"
    assert E.aspect_classify(250, 800) == "ambiguous"
    assert E.aspect_classify(250, 2000) == "wall"
    print("aspect_classify: PASS (400x650 col / 250x800 ambiguous / 250x2000 wall)")


def test_piers():
    raw = [{"sw": "SW2", "pier": "SW2a", "x1": 0, "y1": 0, "x2": 0, "y2": 3000, "thk": 250},
           {"sw": "SW3", "pier": "SW3a", "corners": [(0, 0), (200, 0), (200, 4000), (0, 4000)], "thk": 200}]
    out = E.normalize_piers(raw)
    assert len(out) == 2
    seg = out[1]
    assert approx(seg["x1"], 100) and approx(seg["x2"], 100), seg  # centerline of the rect
    print("normalize_piers: PASS (segment passthrough + rect->centerline)")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nALL EXTRACTION TESTS PASSED")
