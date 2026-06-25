'use client';

// STEP 2 — "Overlay on Ground Floor" (Registration B).
// Two drawings side-by-side:
//   LEFT  — Column Layout Plan  (the named columns from Step 1)
//   RIGHT — Ground Floor Plan   (the structural floor drawing — beams, walls, gridlines)
//
// Workflow:
//   1. Pick 3 anchor columns on EITHER pane (any order — the pane you click first
//      becomes "source", the other becomes "target"). Both are detected column boxes
//      (grey/hatched fill from the same column_finder extraction).
//   2. Pick the 3 matching columns on the other pane in the same order.
//   3. Click "Apply overlay" → affine transform maps Layout columns onto Floor.
//   4. Named columns now appear on the Floor plan → beams between them are identified.
//   5. Continue → Mapper (Step 3, ETABS alignment).

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T } from '@/lib/design';
import type { Contract, GfcCol } from '@/lib/engine/types';
import {
  newView, fitCloud, zoomAt, gfcToCanvas, canvasToGfc, type View,
} from '@/lib/engine/render';
import { solveAffine } from '@/lib/engine/geometry';
import { api } from '@/lib/api';
import { usePdfBitmap, type PdfBitmap } from '@/lib/usePdfBitmap';

const CW = 760, CH = 560;

type CalibPt = { gx: number; gy: number; id: string | null };
type FloorPair = { layoutId: string; floorId: string | null; dist: number; cmark: string };

// Which pane the user is calibrating on. null = not started.
type ActivePane = 'layout' | 'floor' | null;

export default function FloorPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const router = useRouter();

  const [contract, setContract] = React.useState<Contract | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Column Layout (left pane) — columns from Step 1 with names
  const [layoutCols, setLayoutCols] = React.useState<GfcCol[]>([]);
  const [layoutAlpha, setLayoutAlpha] = React.useState(0.9);
  const [layoutScale, setLayoutScale] = React.useState(1);

  // Ground Floor Plan (right pane) — columns extracted from the floor PDF
  const [floorCols, setFloorCols] = React.useState<GfcCol[]>([]);
  const [floorAlpha, setFloorAlpha] = React.useState(0.9);
  const [floorScale, setFloorScale] = React.useState(1);

  // C-mark names from Step 1 decisions
  const [cmarks, setCmarks] = React.useState<Record<string, string>>({});

  // Calibration state
  // layoutPts: anchors clicked on the layout pane (in layout drawing-space)
  // floorPts:  anchors clicked on the floor pane   (in floor drawing-space)
  const [layoutPts, setLayoutPts] = React.useState<CalibPt[]>([]);
  const [floorPts, setFloorPts] = React.useState<CalibPt[]>([]);

  // Which pane gets the next click? We fill whichever side the user clicks first.
  // Once one side has 3 pts, clicks auto-route to the other side.
  const activePane = React.useMemo<ActivePane>(() => {
    if (layoutPts.length === 3 && floorPts.length === 3) return null;   // done
    if (layoutPts.length < 3 && floorPts.length < 3) return null;       // both open
    if (layoutPts.length < 3) return 'layout';
    return 'floor';
  }, [layoutPts.length, floorPts.length]);

  // Derived: ready to compute when both sides have 3 pts
  const calibReady = layoutPts.length === 3 && floorPts.length === 3;

  // Overlay result: affine that maps layout drawing coords → floor drawing coords
  const [affine, setAffine] = React.useState<{ a: number; b: number; c: number; d: number; e: number; f: number } | null>(null);
  // Nearest-column matching result after overlay is applied
  const [floorPairs, setFloorPairs] = React.useState<FloorPair[]>([]);

  // Selected column id (for highlighting)
  const [selectedLayout, setSelectedLayout] = React.useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = React.useState<string | null>(null);

  // Canvas refs + views
  const layoutRef = React.useRef<HTMLCanvasElement>(null);
  const floorRef = React.useRef<HTMLCanvasElement>(null);
  const layoutView = React.useRef<View>(newView());
  const floorView = React.useRef<View>(newView());
  const drag = React.useRef<{ which: 'layout' | 'floor'; x: number; y: number; moved: number } | null>(null);
  const [, redraw] = React.useReducer((n) => n + 1, 0);

  // PDF backgrounds — crisp at any zoom via PDF.js
  const layoutBitmap = usePdfBitmap(
    contract ? api.getPdfUrl(projectId, 'layout_pdf') : null,
    layoutScale,
  );
  const floorBitmap = usePdfBitmap(
    contract ? api.getPdfUrl(projectId, 'gfc_pdf') : null,
    floorScale,
  );

  // Reset the floor-fit flag whenever the project changes so we re-fit on new load
  React.useEffect(() => { floorFitted.current = false; }, [projectId]);

  // When floorBitmap first loads but floorCols is empty, fit the view to the PDF
  // page dimensions so the drawing is visible at the right scale.
  const floorFitted = React.useRef(false);
  React.useEffect(() => {
    if (!floorBitmap || floorFitted.current) return;
    if (floorCols.length) { floorFitted.current = true; return; } // column-based fit already handles this
    // Fit the PDF page into the canvas — treat corners as the "point cloud"
    const pts = [
      { x: 0, y: 0 },
      { x: floorBitmap.pageW, y: floorBitmap.pageH },
    ];
    floorView.current = fitCloud(pts, CW, CH, false);
    setFloorScale(floorView.current.scale);
    floorFitted.current = true;
    redraw();
  }, [floorBitmap, floorCols.length]);

  // Narration log
  const [log, setLog] = React.useState<string[]>(['Step 2 — Overlay the column layout on the ground floor plan.', 'Click 3 column boxes on either drawing to start.']);
  const say = (m: string) => setLog((L) => [...L, m]);

  // ---- Load contract ----
  React.useEffect(() => {
    api.getContract(projectId).then((c) => {
      setContract(c);

      // Layout columns (same source as Step 1)
      const lCols = (c.schedule?.layout_cols as GfcCol[] | undefined) ?? c.gfc_cols;
      setLayoutCols(lCols);

      // Floor columns — backend puts them in schedule.floor_cols
      const fCols = (c.schedule?.floor_cols as GfcCol[] | undefined) ?? [];
      setFloorCols(fCols);

      // C-mark names from contract
      setCmarks(c.gfc_cmark ?? {});

      if (!fCols.length) {
        say('No ground floor column boxes found. Ask the backend to extract floor_cols from the Ground Floor PDF.');
      }
    }).catch(() => setErr(`Could not load project ${projectId}.`));
  }, [projectId]);

  // ---- Fit initial views ----
  React.useEffect(() => {
    if (layoutCols.length) {
      layoutView.current = fitCloud(layoutCols.map((c) => ({ x: c.cx, y: c.cy })), CW, CH, false);
      setLayoutScale(layoutView.current.scale);
    }
  }, [layoutCols]);
  React.useEffect(() => {
    if (floorCols.length) {
      floorView.current = fitCloud(floorCols.map((c) => ({ x: c.cx, y: c.cy })), CW, CH, false);
      setFloorScale(floorView.current.scale);
    }
  }, [floorCols]);

  // ---- Draw ----
  const draw = React.useCallback(() => {
    drawPane(
      layoutRef.current, layoutView.current,
      layoutCols, layoutBitmap, layoutAlpha,
      layoutPts, selectedLayout, cmarks,
      false,
    );
    drawPane(
      floorRef.current, floorView.current,
      floorCols, floorBitmap, floorAlpha,
      floorPts, selectedFloor, {},
      true,
    );
    // Draw projected layout ghosts on floor pane after overlay
    if (affine && layoutCols.length && floorRef.current) {
      const ctx = floorRef.current.getContext('2d')!;
      const v = floorView.current;
      ctx.save();
      ctx.globalAlpha = 0.75;
      for (const c of layoutCols) {
        const [fx, fy] = applyAff(affine, c.cx, c.cy);
        const p = gfcToCanvas(v, fx, fy);
        const hw = Math.max(3, (c.rw / 2) * v.scale), hh = Math.max(3, (c.rh / 2) * v.scale);
        const name = cmarks[c.id];
        // Hatch fill for projected columns
        ctx.fillStyle = 'rgba(14,159,110,0.18)';
        ctx.strokeStyle = '#0E9F6E';
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
        ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
        // Hatch lines
        drawHatch(ctx, p.x - hw, p.y - hh, hw * 2, hh * 2, '#0E9F6E', 0.4);
        if (name && v.scale > 0.4) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#0E9F6E';
          ctx.font = `bold ${Math.max(9, v.scale * 1.4)}px monospace`;
          ctx.fillText(name, p.x + hw + 3, p.y + 4);
          ctx.globalAlpha = 0.75;
        }
      }
      ctx.restore();
    }
  }, [layoutCols, layoutBitmap, layoutAlpha, layoutPts, selectedLayout, cmarks,
      floorCols, floorBitmap, floorAlpha, floorPts, selectedFloor, affine]);
  React.useEffect(() => { draw(); });

  // ---- Apply calibration ----
  const applyCalibration = () => {
    if (!calibReady) return;
    const src = layoutPts.map((p) => ({ x: p.gx, y: p.gy }));
    const dst = floorPts.map((p) => ({ x: p.gx, y: p.gy }));
    const aff = solveAffine(src, dst);
    setAffine(aff);

    // Nearest-column matching: project each layout col → find closest floor col
    const MATCH_TOL = 60; // pts (~21 mm) — if nearest is further, mark unmatched
    const pairs: FloorPair[] = layoutCols.map((lc) => {
      const [fx, fy] = applyAff(aff, lc.cx, lc.cy);
      let best: { id: string; d: number } | null = null;
      for (const fc of floorCols) {
        const d = Math.hypot(fc.cx - fx, fc.cy - fy);
        if (!best || d < best.d) best = { id: fc.id, d };
      }
      return {
        layoutId: lc.id,
        floorId: best && best.d < MATCH_TOL ? best.id : null,
        dist: best?.d ?? Infinity,
        cmark: cmarks[lc.id] ?? lc.id,
      };
    });
    setFloorPairs(pairs);

    const matched = pairs.filter((p) => p.floorId).length;
    say(`Overlay applied — ${matched}/${pairs.length} layout columns matched to floor columns (green hatched boxes).`);
    say(`${pairs.length - matched} unmatched (either outside drawing or tolerance ${MATCH_TOL} pts). Click "Continue → ETABS mapper" when ready.`);
  };

  const resetCalib = () => {
    setLayoutPts([]); setFloorPts([]); setAffine(null); setFloorPairs([]);
    say('Calibration reset. Click 3 column boxes on either drawing to start again.');
  };

  const confirmAndContinue = async () => {
    if (affine) {
      try {
        await api.saveResults(projectId, {
          step: 'floor',
          affine_layout_to_floor: affine,
          floor_pairs: floorPairs,
        });
      } catch { /* non-fatal */ }
    }
    router.push(`/project/${projectId}`);
  };

  // ---- Wheel zoom ----
  React.useEffect(() => {
    const bind = (
      cv: HTMLCanvasElement | null,
      v: React.MutableRefObject<View>,
      onScale: (s: number) => void,
    ) => {
      if (!cv) return () => {};
      const h = (ev: WheelEvent) => {
        ev.preventDefault();
        const r = cv.getBoundingClientRect();
        const cx = ((ev.clientX - r.left) / r.width) * CW;
        const cy = ((ev.clientY - r.top) / r.height) * CH;
        zoomAt(v.current, cx, cy, ev.deltaY);
        onScale(v.current.scale);
        redraw();
      };
      cv.addEventListener('wheel', h, { passive: false });
      return () => cv.removeEventListener('wheel', h);
    };
    const ul = bind(layoutRef.current, layoutView, setLayoutScale);
    const uf = bind(floorRef.current, floorView, setFloorScale);
    return () => { ul(); uf(); };
  }, [layoutCols, floorCols]);

  // ---- Pointer handlers ----
  const toCanvas = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return { cx: ((ev.clientX - r.left) / r.width) * CW, cy: ((ev.clientY - r.top) / r.height) * CH };
  };

  const onDown = (which: 'layout' | 'floor') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = toCanvas(ev);
    drag.current = { which, x: cx, y: cy, moved: 0 };
  };
  const onMove = (which: 'layout' | 'floor') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag.current || drag.current.which !== which) return;
    const { cx, cy } = toCanvas(ev);
    const v = which === 'layout' ? layoutView.current : floorView.current;
    v.ox += cx - drag.current.x; v.oy += cy - drag.current.y;
    drag.current.moved += Math.abs(cx - drag.current.x) + Math.abs(cy - drag.current.y);
    drag.current.x = cx; drag.current.y = cy; redraw();
  };
  const onUp = (which: 'layout' | 'floor') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved > 4) return;
    const { cx, cy } = toCanvas(ev);
    const v = which === 'layout' ? layoutView.current : floorView.current;
    const cols = which === 'layout' ? layoutCols : floorCols;
    const pts = which === 'layout' ? layoutPts : floorPts;
    const setPts = which === 'layout' ? setLayoutPts : setFloorPts;
    const otherPts = which === 'layout' ? floorPts : layoutPts;
    const setSelected = which === 'layout' ? setSelectedLayout : setSelectedFloor;

    const w = canvasToGfc(v, cx, cy);
    const near = nearestCol(cols, w);

    // If overlay is done, just select
    if (affine) {
      setSelected(near?.id ?? null);
      return;
    }

    // Determine if this pane should accept a calibration click:
    // - If both panes are under 3 pts, any click is accepted
    // - If this pane already has 3 pts, ignore (route to the other side)
    if (pts.length >= 3) {
      say(`Already have 3 points on ${which}. Click the ${which === 'layout' ? 'floor' : 'layout'} drawing.`);
      return;
    }
    // If the OTHER pane also has 3 pts already, this shouldn't happen but guard
    if (otherPts.length === 3 && pts.length === 3) return;

    // Snap to nearest column box if within tolerance
    const snap: CalibPt = near && dist2d(near, w) < 40 / v.scale
      ? { gx: near.x, gy: near.y, id: near.id }
      : { gx: w.x, gy: w.y, id: null };

    const next = [...pts, snap];
    setPts(next);

    const paneLabel = which === 'layout' ? 'Column Layout' : 'Ground Floor';
    const name = snap.id ? ` (${cmarks[snap.id] ?? snap.id})` : '';
    say(`${paneLabel} anchor ${next.length}/3 placed${name}.`);

    if (next.length === 3 && otherPts.length === 3) {
      say('3 pairs ready — click "Apply overlay".');
    } else if (next.length === 3) {
      const other = which === 'layout' ? 'Ground Floor' : 'Column Layout';
      say(`Now click 3 matching columns on the ${other} in the same order.`);
    }
  };

  if (err) return <Shell><Banner text={err} /><Link href="/projects" style={lnk}>← projects</Link></Shell>;
  if (!contract) return <Shell><span style={{ fontFamily: T.serif, fontSize: 18 }}>Loading floor plan…</span></Shell>;

  const calibStage: 'picking' | 'ready' | 'done' =
    affine ? 'done' : calibReady ? 'ready' : 'picking';

  // Hint text for each pane
  const layoutHint = affine ? undefined
    : layoutPts.length < 3
      ? activePane === 'floor'
        ? undefined
        : `Click anchor ${layoutPts.length + 1} of 3 on the column layout`
      : undefined;

  const floorHint = affine ? undefined
    : floorPts.length < 3
      ? activePane === 'layout'
        ? undefined
        : `Click anchor ${floorPts.length + 1} of 3 on the ground floor`
      : undefined;

  return (
    <div style={{ minHeight: '100vh', background: T.paper, color: T.ink, fontFamily: T.sans }}>
      <Header />
      <div style={{ maxWidth: 1680, margin: '0 auto', padding: '18px 24px 60px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: T.serif, fontSize: 22 }}>Step 2 — Overlay column layout on ground floor</div>
            <div style={{ color: T.muted, fontSize: 13.5, marginTop: 4, maxWidth: 800 }}>
              Pick <b>3 matching column boxes</b> on each drawing (either side first, same order).
              We compute the transform and project named columns onto the floor plan — so beam labels can be resolved.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={resetCalib} disabled={calibStage === 'picking' && layoutPts.length === 0 && floorPts.length === 0}
              style={{ ...ghostBtn, opacity: (calibStage === 'picking' && layoutPts.length === 0 && floorPts.length === 0) ? 0.4 : 1 }}>
              Reset
            </button>
            <button onClick={applyCalibration} disabled={calibStage !== 'ready'}
              style={{ ...primaryBtn, opacity: calibStage === 'ready' ? 1 : 0.45 }}>
              Apply overlay
            </button>
            <button onClick={confirmAndContinue}
              style={{ ...primaryBtn, background: affine ? T.ink : T.muted, cursor: 'pointer' }}>
              Continue → ETABS mapper
            </button>
          </div>
        </div>

        <CalibStatus layoutPts={layoutPts} floorPts={floorPts} stage={calibStage} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
          {/* LEFT — Column Layout Plan */}
          <Pane
            title="Column Layout Plan"
            subtitle={`${layoutCols.length} columns · ${layoutPts.length}/3 anchors`}
            hint={layoutHint}
            alpha={layoutAlpha} onAlpha={setLayoutAlpha}
          >
            <canvas ref={layoutRef} width={CW} height={CH} style={canvasStyle}
              onMouseDown={onDown('layout')} onMouseMove={onMove('layout')}
              onMouseUp={onUp('layout')} onMouseLeave={() => { drag.current = null; }} />
          </Pane>

          {/* RIGHT — Ground Floor Plan */}
          <Pane
            title="Ground Floor Plan"
            subtitle={floorCols.length ? `${floorCols.length} columns · ${floorPts.length}/3 anchors` : 'floor PDF loaded'}
            hint={floorHint}
            alpha={floorAlpha} onAlpha={setFloorAlpha}
            showAlpha
          >
            <canvas ref={floorRef} width={CW} height={CH} style={canvasStyle}
              onMouseDown={onDown('floor')} onMouseMove={onMove('floor')}
              onMouseUp={onUp('floor')} onMouseLeave={() => { drag.current = null; }} />
          </Pane>
        </div>

        <PaneLegend hasOverlay={!!affine} />
        {floorPairs.length > 0 && <MatchTable pairs={floorPairs} />}
        <DevLog log={log} />
      </div>
    </div>
  );
}

// ---- Canvas drawing ----

function drawPane(
  cv: HTMLCanvasElement | null,
  v: View,
  cols: GfcCol[],
  pdf: PdfBitmap | null,
  alpha: number,
  calibPts: CalibPt[],
  selected: string | null,
  cmarks: Record<string, string>,
  isFloor: boolean,
) {
  if (!cv) return;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH);

  // 1. PDF background — bitmap rendered by PDF.js, always crisp at current zoom
  if (pdf && alpha > 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(pdf.bitmap, 0, 0, pdf.bitmap.width, pdf.bitmap.height,
      v.ox, v.oy, pdf.pageW * v.scale, pdf.pageH * v.scale);
    ctx.restore();
  }

  // 2. Detected column boxes — grey hatch fill, same detection as naming page
  for (const c of cols) {
    const p = gfcToCanvas(v, c.cx, c.cy);
    const hw = Math.max(3, (c.rw / 2) * v.scale);
    const hh = Math.max(3, (c.rh / 2) * v.scale);
    const isSel = c.id === selected;
    const isCalib = calibPts.some((cp) => cp.id === c.id);

    const baseColor = isFloor ? '#64748B' : '#1E3A5F';
    const fillAlpha = isSel ? 0.45 : isCalib ? 0.35 : 0.18;
    const strokeColor = isSel ? '#0A1628' : isCalib ? CALIB_COLORS[calibPts.findIndex((cp) => cp.id === c.id)] ?? baseColor : baseColor;

    ctx.fillStyle = hexToRgba(baseColor, fillAlpha);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isSel ? 2.5 : isCalib ? 2 : 1.2;
    ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
    ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);

    // Hatch fill — diagonal lines at 45° inside the box
    drawHatch(ctx, p.x - hw, p.y - hh, hw * 2, hh * 2, baseColor, fillAlpha * 0.9);

    // C-mark label (layout side only)
    const nm = cmarks[c.id];
    if (nm && v.scale > 0.5) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = baseColor;
      ctx.font = `${Math.max(9, v.scale * 1.5)}px monospace`;
      ctx.fillText(nm, p.x + hw + 3, p.y + 4);
    }
    ctx.globalAlpha = 1;
  }

  // 3. Calibration anchor markers (numbered rings)
  calibPts.forEach((pt, i) => {
    const p = gfcToCanvas(v, pt.gx, pt.gy);
    drawAnchorMarker(ctx, p.x, p.y, i + 1, CALIB_COLORS[i] || '#fff');
  });
}

// Diagonal 45° hatch inside a rectangle
function drawHatch(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  color: string, alpha: number,
) {
  if (w < 2 || h < 2) return;
  const spacing = Math.max(3, Math.min(8, (w + h) / 6));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const ext = w + h;
  for (let d = -ext; d <= ext; d += spacing) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
  }
  ctx.stroke();
  ctx.restore();
}

function drawAnchorMarker(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, color: string) {
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = color + '33'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y);
  ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16);
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 11px monospace';
  ctx.fillText(String(n), x + 13, y - 9);
}

function hexToRgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function applyAff(aff: { a: number; b: number; c: number; d: number; e: number; f: number }, x: number, y: number): [number, number] {
  return [aff.a * x + aff.b * y + aff.c, aff.d * x + aff.e * y + aff.f];
}

function nearestCol(cols: GfcCol[], w: { x: number; y: number }): { id: string; x: number; y: number } | null {
  let best: { id: string; x: number; y: number } | null = null, bd = Infinity;
  for (const c of cols) {
    const d = Math.hypot(c.cx - w.x, c.cy - w.y);
    if (d < bd) { bd = d; best = { id: c.id, x: c.cx, y: c.cy }; }
  }
  return best;
}
function dist2d(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }

const CALIB_COLORS = ['#ff6b35', '#ff9f1c', '#ffcb47'];

// ---- Sub-components ----

function CalibStatus({ layoutPts, floorPts, stage }: { layoutPts: CalibPt[]; floorPts: CalibPt[]; stage: string }) {
  const dot = (filled: boolean, color: string) => (
    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: filled ? color : 'transparent', border: `2px solid ${color}`, marginRight: 3 }} />
  );
  return (
    <div style={{ display: 'flex', gap: 24, padding: '10px 16px', background: T.panel,
      border: `1px solid ${T.border}`, borderRadius: 12, fontFamily: T.mono, fontSize: 12.5,
      alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: T.muted }}>Column Layout anchors:</span>
      {[0, 1, 2].map((i) => (
        <span key={i}>{dot(i < layoutPts.length, CALIB_COLORS[i])}<span style={{ color: T.ink }}>{i + 1}</span></span>
      ))}
      <span style={{ color: T.border, margin: '0 4px' }}>·</span>
      <span style={{ color: T.muted }}>Ground Floor anchors:</span>
      {[0, 1, 2].map((i) => (
        <span key={i}>{dot(i < floorPts.length, CALIB_COLORS[i])}<span style={{ color: T.ink }}>{i + 1}</span></span>
      ))}
      {stage === 'done' && (
        <span style={{ marginLeft: 'auto', color: '#0E9F6E', fontWeight: 600 }}>Overlay applied</span>
      )}
      {stage === 'ready' && (
        <span style={{ marginLeft: 'auto', color: T.cyanDeep, fontWeight: 600 }}>Ready — click "Apply overlay"</span>
      )}
    </div>
  );
}

function Pane({ title, subtitle, hint, alpha, onAlpha, showAlpha = true, children }: {
  title: string; subtitle: string; hint?: string;
  alpha: number; onAlpha: (v: number) => void;
  showAlpha?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontFamily: T.serif, fontSize: 16 }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {showAlpha && (
            <label style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle, display: 'flex', alignItems: 'center', gap: 6 }}>
              drawing
              <input type="range" min={0} max={1} step={0.05} value={alpha}
                onChange={(e) => onAlpha(+e.target.value)}
                style={{ width: 80, accentColor: T.cyanDeep }} />
              <span style={{ width: 28, textAlign: 'right' }}>{Math.round(alpha * 100)}%</span>
            </label>
          )}
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle }}>{subtitle}</span>
        </div>
      </div>
      {hint && (
        <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8,
          background: `${T.cyan}1a`, border: `1px solid ${T.cyan}55`,
          fontFamily: T.mono, fontSize: 11.5, color: T.cyanDeep }}>{hint}</div>
      )}
      {children}
    </div>
  );
}

function PaneLegend({ hasOverlay }: { hasOverlay: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 20, marginTop: 12, fontFamily: T.mono, fontSize: 11.5, color: T.muted, flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 14, background: 'rgba(30,58,95,0.18)', border: '1.5px solid #1E3A5F', borderRadius: 2 }} />
        Layout columns
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 14, height: 14, background: 'rgba(100,116,139,0.18)', border: '1.5px solid #64748B', borderRadius: 2 }} />
        Floor columns (detected)
      </span>
      {hasOverlay && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, background: 'rgba(14,159,110,0.18)', border: '1.5px solid #0E9F6E', borderRadius: 2 }} />
          Named columns projected
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #ff6b35', marginRight: 2 }} />
        Anchor 1
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #ff9f1c', marginRight: 2 }} />
        Anchor 2
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #ffcb47', marginRight: 2 }} />
        Anchor 3
      </span>
    </div>
  );
}

function DevLog({ log }: { log: string[] }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, width: open ? 360 : 'auto', maxHeight: '55vh',
      background: T.navy, color: T.textD, borderRadius: 12, boxShadow: '0 18px 50px -20px rgba(0,0,0,0.5)', zIndex: 50 }}>
      <div onClick={() => setOpen((o) => !o)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex',
        justifyContent: 'space-between', fontFamily: T.mono, fontSize: 11.5, letterSpacing: '0.08em',
        borderBottom: open ? `1px solid ${T.borderD}` : 'none' }}>
        <span>WHAT&apos;S HAPPENING</span><span>{open ? '▾' : '▴'}</span>
      </div>
      {open && (
        <div style={{ padding: '10px 14px', overflowY: 'auto', maxHeight: 'calc(55vh - 44px)',
          display: 'flex', flexDirection: 'column', gap: 7 }}>
          {log.map((m, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.5, color: T.textD }}>
              <span style={{ fontFamily: T.mono, color: T.cyan }}>{String(i + 1).padStart(2, '0')}</span> {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchTable({ pairs }: { pairs: FloorPair[] }) {
  const [open, setOpen] = React.useState(false);
  const matched = pairs.filter((p) => p.floorId).length;
  const pct = Math.round((matched / pairs.length) * 100);
  const quality = pct >= 95 ? '#0E9F6E' : pct >= 80 ? '#E08A00' : '#E11D48';
  return (
    <div style={{ marginTop: 14, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontFamily: T.serif, fontSize: 15 }}>Column match quality</span>
        <span style={{ fontFamily: T.mono, fontSize: 12.5, color: quality, fontWeight: 700 }}>
          {matched}/{pairs.length} matched ({pct}%)
        </span>
        {pairs.length - matched > 0 && (
          <span style={{ fontFamily: T.mono, fontSize: 12, color: '#E11D48' }}>
            {pairs.length - matched} unmatched
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: T.muted, fontSize: 12 }}>{open ? '▾ hide' : '▴ show'}</span>
      </div>
      {open && (
        <div style={{ overflowX: 'auto', borderTop: `1px solid ${T.border}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.mono, fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.sand }}>
                {['C-mark', 'Layout ID', 'Floor ID', 'Dist (pt)', ''].map((h) => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: T.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.border}`, background: i % 2 ? T.paper : 'transparent' }}>
                  <td style={{ padding: '5px 12px', fontWeight: 600, color: T.ink }}>{p.cmark}</td>
                  <td style={{ padding: '5px 12px', color: T.subtle }}>{p.layoutId}</td>
                  <td style={{ padding: '5px 12px', color: p.floorId ? T.ink : '#E11D48' }}>{p.floorId ?? '—'}</td>
                  <td style={{ padding: '5px 12px', color: T.muted }}>{p.dist === Infinity ? '—' : p.dist.toFixed(1)}</td>
                  <td style={{ padding: '5px 12px' }}>
                    <span style={{ color: p.floorId ? '#0E9F6E' : '#E11D48', fontWeight: 700 }}>
                      {p.floorId ? '✓' : '✗'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <header style={{ borderBottom: `1px solid ${T.border}`, background: T.panel, display: 'flex',
      alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
      <Link href="/projects" style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, textDecoration: 'none' }}>
        Column Rosetta Mapper
      </Link>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: T.mono, fontSize: 12 }}>
        {(['1 · Name', '2 · Floor', '3 · Map', '4 · Rosetta'] as const).map((l, i) => (
          <React.Fragment key={l}>
            <span style={{ padding: '5px 12px', borderRadius: 999,
              background: i === 1 ? T.cyan : T.sand, color: i === 1 ? T.navy : T.muted, fontWeight: 600 }}>{l}</span>
            {i < 3 && <span style={{ color: T.subtle }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: T.paper, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexDirection: 'column', gap: 12 }}>{children}</div>;
}
function Banner({ text }: { text: string }) {
  return <div style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.3)',
    color: '#BE123C', borderRadius: 10, padding: '12px 16px', fontSize: 13.5, maxWidth: 560 }}>{text}</div>;
}

const canvasStyle: React.CSSProperties = {
  width: '100%', height: 'auto', aspectRatio: `${CW} / ${CH}`,
  background: '#fff', borderRadius: 10, border: `1px solid ${T.border}`,
  cursor: 'crosshair', touchAction: 'none',
};
const primaryBtn: React.CSSProperties = {
  padding: '11px 20px', borderRadius: 10, border: 'none', background: T.ink,
  color: T.textD, fontWeight: 600, fontSize: 14, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '11px 16px', borderRadius: 10, border: `1px solid ${T.border}`,
  background: T.panel, color: T.ink, fontWeight: 600, fontSize: 14, cursor: 'pointer',
};
const lnk: React.CSSProperties = { fontFamily: T.mono, fontSize: 13, color: T.cyanDeep };
