# CivilSpace Rosetta — Architecture & Engineering Reference

## Product overview

Four-step workflow to cross-verify structural drawings against ETABS models:

| Step | Route | Purpose |
|------|-------|---------|
| 1 · Name | `/project/[id]/name` | Match C-mark labels → column boxes on the Column Layout Plan |
| 2 · Floor | `/project/[id]/floor` | Overlay Column Layout onto Ground Floor Plan (affine calibration) |
| 3 · Map | `/project/[id]` | Align GFC drawing to ETABS model (affine + ICP); match columns |
| 4 · Rosetta | `/project/[id]/rosetta` | (upcoming) Cross-verify beam schedules, rebar, stirrups |

---

## PDF rendering — generalised pattern

**Rule: every drawing canvas uses `usePdfBitmap`, never VecLayer for display.**

### Why

The backend extracts a `VecLayer` (compact JSON of paths + text spans) for geometry processing (column detection, beam extraction). That data is NOT used for display — it's a lossy approximation that blurs at zoom and misses fine detail.

For display, the raw PDF bytes are served by the backend and rendered via PDF.js into an `OffscreenCanvas` at the exact current zoom scale × device pixel ratio. This gives pixel-perfect text and lines at any zoom level.

### Hook: `lib/usePdfBitmap.ts`

```ts
usePdfBitmap(url: string | null, viewScale: number): PdfBitmap | null
```

- `url` — from `api.getPdfUrl(projectId, kind)` where `kind` is `'gfc_pdf' | 'layout_pdf' | 'floor_pdf' | 'schedule_pdf'`
- `viewScale` — current `View.scale` from the canvas view ref (canvas px per PDF pt)
- Returns `{ bitmap: ImageBitmap, pageW: number, pageH: number }` or `null` while loading
- Re-renders after 300 ms debounce when `viewScale` changes (zoom-triggered re-render)
- Cancels in-flight renders via `AbortController` when url or scale changes

### How to stamp the bitmap onto a canvas

```ts
if (pdf && alpha > 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(pdf.bitmap, 0, 0, pdf.bitmap.width, pdf.bitmap.height,
    v.ox, v.oy, pdf.pageW * v.scale, pdf.pageH * v.scale);
  ctx.restore();
}
```

The bitmap covers the full PDF page in PDF pts. `v` is the current `View` (ox/oy = pan offset, scale = zoom). `drawImage` maps the full bitmap onto the canvas at exactly the right position and size — no intermediate scaling artefacts.

### Per-page tracking pattern

Each canvas pane needs its own `viewScale` state so the PDF re-renders when THAT pane's zoom changes:

```ts
const [viewScale, setViewScale] = React.useState(1);
// On initial fit:
view.current = fitCloud(...);
setViewScale(view.current.scale);
// In wheel handler:
zoomAt(view.current, cx, cy, ev.deltaY);
setViewScale(view.current.scale);
```

### Backend endpoint

`GET /projects/{pid}/files/{kind}` — added to `backend/app.py`. Returns raw PDF bytes with `Cache-Control: private, max-age=86400`. No auth beyond project membership (all local for now).

### Applying to a new step/pane

1. Add `const [viewScale, setViewScale] = React.useState(1)` to component state
2. Call `setViewScale(view.current.scale)` on initial fit and on every wheel event
3. Call `usePdfBitmap(url, viewScale)` with the right `kind`
4. Replace any `drawVecLayer(...)` call with the `ctx.drawImage(...)` stamp pattern above

---

## View / coordinate system

```ts
interface View { ox: number; oy: number; scale: number; }
// canvas px = PDF pt * scale + offset
// gfcToCanvas(v, x, y) => { x: x*v.scale + v.ox, y: y*v.scale + v.oy }
// canvasToGfc(v, cx, cy) => { x: (cx - v.ox)/v.scale, y: (cy - v.oy)/v.scale }
```

GFC/layout drawings: Y-down (PDF space, no flip).  
ETABS model: Y-up (flipped in `etabsToCanvas`).

---

## Inspector panel (Step 3)

- Fixed right panel, `top: HEADER_H` (54 px), always visible regardless of selection
- Top section: scrollable column/wall detail
- Bottom section: ACTIVITY log — auto-scrolls to latest entry, max-height 180 px
- No close button; panel is permanent for the life of the page

---

## Step 4 — Beam topology verification (`/project/[id]/rosetta`)

**Algorithm (already in `lib/engine/beams.ts`, no changes needed):**

`runBeamMatch(contract, match)` — topological only, no positional threshold:
1. Snap ETABS beam endpoints → nearest ETABS column (60mm) → build `eEdges` map of column-pair → beam
2. For each drawing beam (GFC column pair a→b), look up their matched ETABS IDs (ea, eb) from Step 3
3. If ea↔eb edge exists → `matched` ✓ (remove from eEdges)
4. If edge missing → `drawing_only` ❌ FLAW (drawn, not modeled)
5. Leftover eEdges whose both ends are matched → `etabsOnlyEdges` ⚠ REVIEW (modeled, not drawn)

**Page:** Pure read-only text/card display — no canvas. Loads contract, runs `deriveSeed` → `runColumnMatch` → `runBeamMatch` entirely in the browser.

**Three display sections:**
- Summary count cards (matched / drawn-not-modeled / modeled-not-drawn / nocol)
- RED FLAW list: `drawing_only` beams with C-mark column labels from `contract.gfc_cmark`
- AMBER REVIEW list: `etabsOnlyEdges` with ETABS column ID + section string

**Not yet wired:**
- Beam `mark` / `size` extraction from PDF — backend extractor not written; fields always `null` for now
- Rebar / stirrup cross-check — future step

## Future: Step 5 rebar cross-verification

After beams are topology-matched, the next step will be:
1. Extract beam labels (mark, size) from framing layout PDF text layer
2. Pull ETABS beam section (size, material) + drawing schedule (stirrup spacing, rebar counts e.g. 2T12 / 3T16)
3. Cross-verify: is the drawing rebar consistent with what ETABS designed?

The `VecLayer` / `usePdfBitmap` split is critical here: geometry (beam line detection) uses VecLayer paths from the backend; visual display uses the PDF bitmap. Do not conflate the two.

---

## Key files

| File | Role |
|------|------|
| `lib/usePdfBitmap.ts` | PDF.js render hook — use this for all drawing display |
| `lib/engine/render.ts` | `drawVecLayer` (geometry overlay only), `renderGFC`, `renderETABS`, `View` transforms |
| `lib/api.ts` | `api.getPdfUrl(pid, kind)` — constructs the PDF serving URL |
| `backend/app.py` | `GET /projects/{pid}/files/{kind}` — raw PDF serving endpoint |
| `backend/extractors/vector_layer.py` | VecLayer extraction (for geometry, not display) |
| `backend/extractors/column_finder.py` | Column box detection from PDF |
