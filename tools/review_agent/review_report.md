# Functional Review — http://localhost:3456

🟡 **All 34 checks passed — 2 warning(s) to look at**

_Flow tested: landing → upload → extract → **Step 1 naming** → **Step 2 mapper** · 2026-06-22 10:42_

## ⚠ Worth a look

- [Step 1 · Name the columns] scroll-zoom redraws the canvas
- [Step 1 · Name the columns] clicking a box selects it (selected card appears)

## All checks

### Landing (/)

- ✓ page loads
- ✓ hero copy present
- ✓ “Upload your building” CTA
- · screenshot (review_1_landing.png)

### Upload (/upload)

- ✓ page loads
- ✓ ETABS model slot present
- ✓ arrangement slot present
- ✓ layout slot present
- ✓ 3 file inputs present
- ✓ submit disabled before files
- · screenshot (review_2_upload_empty.png)

### Upload → extract

- ✓ attach 3 real files
- ✓ submit enabled after files
- · screenshot (filled) (review_3_upload_filled.png)
- ✓ upload + extract → STEP 1 naming opens — http://localhost:3456/project/dc8976e64b71/name

### Step 1 · Name the columns

- ✓ naming page renders
- ✓ single layout canvas present
- ✓ shows named/total columns
- ✓ shear-wall (SW) count shown
- ✓ un-greyed (add?) count shown
- ✓ auto-naming attached names — 189/190 named
- ✓ most columns named (>80%) — 189/190
- · screenshot (auto-named) (review_4_naming_auto.png)
- ⚠ scroll-zoom redraws the canvas
- · screenshot (zoomed) (review_5_naming_zoom.png)
- ✓ drag-pan works (no crash)
- ⚠ clicking a box selects it (selected card appears)
- ✓ review side panel present
- · un-greyed add buttons (none on this sheet (names tight to boxes))
- · screenshot (review) (review_6_naming_review.png)
- ✓ “Confirm & continue” button present
- ✓ continue → mapper (Step 2) opens — http://localhost:3456/project/dc8976e64b71

### Step 2 · Mapper (GFC ↔ ETABS)

- ✓ dual canvas present — 2 canvas
- ✓ calibration prompt shown
- ✓ “Apply alignment” control present
- ✓ dev “what’s happening” panel present
- · screenshot (mapper loaded) (review_7_mapper_loaded.png)
- ✓ 3 GFC + 3 ETABS control points placed (no crash)
- ✓ “Apply alignment” runs
- ✓ “Refine & match” runs the engine — expected high/walls stats
- ✓ match redraws the ETABS canvas
- ✓ review queue populated
- · screenshot (matched) (review_8_mapper_matched.png)

### Projects (/projects)

- ✓ page loads
- · screenshot (review_9_projects.png)

### Console

- ✓ no JavaScript errors

---
Step screenshots: `tools/probe/review_*.png` (numbered in flow order).
Re-run: `node review.js [url] [--no-upload]`.
