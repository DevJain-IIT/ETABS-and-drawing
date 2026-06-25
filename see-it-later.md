# See It Later — Deferred / Review Again Items

Items that are known issues or improvements, parked for a future session.

---

## Column dimensions from PDF are wrong
**File:** `backend/extractors/column_finder.py`

`rw` and `rh` on each `GfcCol` are the bounding box of the hatch cluster, not the actual column outline dimensions. The hatch ticks are ~7×8 PDF pts; the real column rectangle is drawn as a stroke outline which the finder currently ignores (fill-only sweep). Fix: also parse stroke rectangles from `AS-COLS-PATT` or the column outline layer to get true B×D dimensions.
