// Canvas rendering for the dual-pane mapper — faithful to v11's view model.
// Each pane has its own persistent View { ox, oy, scale } that the user can
// zoom (scroll) and pan (drag). Coordinate transforms are explicit so a click
// maps back to drawing/model space at any zoom (needed for 3-point calibration).
//
// Confidence tiers use a CYAN ramp (HIGH/MED/LOW); walls purple; modeled-not-
// drawn amber. Calibration control points are drawn as numbered ring markers.

import type { Affine, Contract, MatchOutput, GfcCol, EtabsCol } from './types';
import type { BeamMatchOutput } from './beams';
import { applyAffine } from './geometry';

const BEAM = { matched: '#0E9F6E', pos_match: '#06B6D4', drawing_only: '#E11D48', nocol: 'rgba(100,116,139,0.4)' };
const TIER = {
  HIGH: '#22D3EE', MED: '#0E7490', LOW: '#94A3B8',
  WALL: '#A855F7', UNMATCHED_ETABS: '#E08A00', UNMATCHED_GFC: '#E11D48',
};
const CALIB_COLORS = ['#ff6b35', '#ff9f1c', '#ffcb47'];

export interface View { ox: number; oy: number; scale: number; }
export const newView = (): View => ({ ox: 0, oy: 0, scale: 1 });

// GFC pane: y-DOWN (screen and drawing agree). ETABS pane: model y-UP -> flip.
export function gfcToCanvas(v: View, x: number, y: number) { return { x: x * v.scale + v.ox, y: y * v.scale + v.oy }; }
export function canvasToGfc(v: View, cx: number, cy: number) { return { x: (cx - v.ox) / v.scale, y: (cy - v.oy) / v.scale }; }
export function etabsToCanvas(v: View, x: number, y: number) { return { x: x * v.scale + v.ox, y: -y * v.scale + v.oy }; }
export function canvasToEtabs(v: View, cx: number, cy: number) { return { x: (cx - v.ox) / v.scale, y: -((cy - v.oy) / v.scale) }; }

// Fit a point cloud into the canvas (initial view). For ETABS pass flipY=true.
export function fitCloud(pts: { x: number; y: number }[], w: number, h: number, flipY: boolean, pad = 36): View {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const scale = Math.min((w - 2 * pad) / Math.max(maxx - minx, 1e-6), (h - 2 * pad) / Math.max(maxy - miny, 1e-6));
  if (!flipY) return { scale, ox: pad - minx * scale, oy: pad - miny * scale };
  // y-up: place so maxy maps near top
  return { scale, ox: pad - minx * scale, oy: pad + maxy * scale };
}

// Zoom toward a cursor point (scroll). Mutates and returns the view.
export function zoomAt(v: View, cx: number, cy: number, deltaY: number): View {
  const f = deltaY < 0 ? 1.15 : 0.87;
  const ns = Math.max(0.02, Math.min(v.scale * f, v.scale * f * 2000)); // generous range
  v.ox = cx - (cx - v.ox) * (ns / v.scale);
  v.oy = cy - (cy - v.oy) * (ns / v.scale);
  v.scale = ns;
  return v;
}

function marker(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, color: string) {
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color + '33'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14);
  ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 11px monospace'; ctx.fillText(String(n), x + 12, y - 8);
}

// ---- GFC drawing pane ----
export function renderGFC(
  ctx: CanvasRenderingContext2D, v: View, contract: Contract, match: MatchOutput | null,
  w: number, h: number, opts: {
    selected?: string | null; beamMatch?: BeamMatchOutput | null;
    calibPts?: { px: number; py: number }[]; cmarks?: Record<string, string>;
    skipClear?: boolean; skipColumns?: boolean;
  } = {},
) {
  if (!opts.skipClear) ctx.clearRect(0, 0, w, h);
  const cols = contract.gfc_cols;
  if (!cols.length) return;
  const colById = new Map(cols.map((c) => [c.id, c]));

  if (opts.beamMatch) {
    ctx.lineWidth = Math.max(1, v.scale * 0.6);
    for (const b of opts.beamMatch.beams) {
      const a = colById.get(b.a), c = colById.get(b.b);
      if (!a || !c) continue;
      ctx.strokeStyle = (BEAM as Record<string, string>)[b.status] || BEAM.nocol;
      const pa = gfcToCanvas(v, a.cx, a.cy), pc = gfcToCanvas(v, c.cx, c.cy);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pc.x, pc.y); ctx.stroke();
    }
  }
  const colorOf = (id: string) => {
    if (!match) return '#64748B';
    const m = match.matchResult.find((r) => r.gfc_id === id);
    return m ? ((TIER as Record<string, string>)[m.confidence] || TIER.UNMATCHED_GFC) : '#64748B';
  };
  if (!opts.skipColumns) {
    const s = Math.max(4, v.scale * 6);   // marker scales with zoom
    for (const c of cols) {
      const p = gfcToCanvas(v, c.cx, c.cy);
      ctx.fillStyle = colorOf(c.id);
      ctx.globalAlpha = c.id === opts.selected ? 1 : 0.9;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      if (c.id === opts.selected) {
        ctx.globalAlpha = 1; ctx.strokeStyle = '#0A1628'; ctx.lineWidth = 2;
        ctx.strokeRect(p.x - s / 2 - 3, p.y - s / 2 - 3, s + 6, s + 6);
      }
      const nm = opts.cmarks?.[c.id];
      if (nm && v.scale > 3) {
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(10,22,40,0.8)';
        ctx.font = `${Math.max(8, v.scale * 1.4)}px monospace`; ctx.fillText(nm, p.x + s, p.y - 2);
      }
    }
    ctx.globalAlpha = 1;
  }
  // calibration control points
  (opts.calibPts || []).forEach((pt, i) => {
    const p = gfcToCanvas(v, pt.px, pt.py); marker(ctx, p.x, p.y, i + 1, CALIB_COLORS[i] || '#fff');
  });
}

// ---- ETABS model pane ----
export function renderETABS(
  ctx: CanvasRenderingContext2D, v: View, contract: Contract, match: MatchOutput | null,
  w: number, h: number, opts: {
    selected?: string | null; beamMatch?: BeamMatchOutput | null; affine?: Affine | null;
    calibPts?: { px: number; py: number }[]; ghosts?: GfcCol[];
  } = {},
) {
  ctx.clearRect(0, 0, w, h);
  const ec = contract.etabs_cols;
  if (!ec.length) return;
  const ecById = new Map(ec.map((c) => [c.id, c]));

  // beams (faint)
  ctx.strokeStyle = 'rgba(100,116,139,0.32)'; ctx.lineWidth = Math.max(0.5, v.scale * 0.004);
  for (const b of contract.etabs_beams) {
    const a = etabsToCanvas(v, b.x1, b.y1), c = etabsToCanvas(v, b.x2, b.y2);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }
  // walls (purple)
  ctx.strokeStyle = TIER.WALL; ctx.lineWidth = Math.max(2, v.scale * 0.02);
  for (const wseg of contract.etabs_walls) {
    const a = etabsToCanvas(v, wseg.x1, wseg.y1), c = etabsToCanvas(v, wseg.x2, wseg.y2);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }
  // matched beams green + modeled-not-drawn amber
  if (opts.beamMatch) {
    ctx.lineWidth = Math.max(1, v.scale * 0.01); ctx.strokeStyle = BEAM.matched;
    for (const b of opts.beamMatch.beams) {
      if (b.status !== 'matched' || !b.ea || !b.eb) continue;
      const a = ecById.get(b.ea), c = ecById.get(b.eb); if (!a || !c) continue;
      const pa = etabsToCanvas(v, a.x, a.y), pc = etabsToCanvas(v, c.x, c.y);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pc.x, pc.y); ctx.stroke();
    }
    ctx.strokeStyle = TIER.UNMATCHED_ETABS; ctx.lineWidth = Math.max(1.5, v.scale * 0.014);
    for (const e of opts.beamMatch.etabsOnlyEdges) {
      const a = ecById.get(e.a), c = ecById.get(e.b); if (!a || !c) continue;
      const pa = etabsToCanvas(v, a.x, a.y), pc = etabsToCanvas(v, c.x, c.y);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pc.x, pc.y); ctx.stroke();
    }
  }
  // model columns (oriented rectangles), colored by match outcome
  const matched = new Set<string>(), unmatched = new Set<string>();
  if (match) for (const m of match.matchResult) {
    if (m.matched && m.etabs_id) matched.add(m.etabs_id);
    if (m.confidence === 'UNMATCHED_ETABS' && m.etabs_id) unmatched.add(m.etabs_id);
  }
  for (const c of ec) {
    const p = etabsToCanvas(v, c.x, c.y);
    const hw = Math.max(2, (c.B / 2) * v.scale), hd = Math.max(2, (c.D / 2) * v.scale);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((-c.ang * Math.PI) / 180);
    ctx.fillStyle = unmatched.has(c.id) ? TIER.UNMATCHED_ETABS : matched.has(c.id) ? '#0E9F6E' : '#64748B';
    ctx.globalAlpha = c.id === opts.selected ? 1 : 0.85;
    ctx.fillRect(-hw, -hd, hw * 2, hd * 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // GFC ghosts projected via the affine (during/after calibration) — blue dots
  if (opts.affine && opts.ghosts) {
    ctx.fillStyle = 'rgba(59,130,246,0.5)';
    for (const g of opts.ghosts) {
      const [tx, ty] = applyAffine(opts.affine, g.cx, g.cy);
      const p = etabsToCanvas(v, tx, ty);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, v.scale * 2), 0, Math.PI * 2); ctx.fill();
    }
  }
  // calibration control points
  (opts.calibPts || []).forEach((pt, i) => {
    const p = etabsToCanvas(v, pt.px, pt.py); marker(ctx, p.x, p.y, i + 1, CALIB_COLORS[i] || '#fff');
  });
}

export const TIER_COLORS = TIER;

// ---- Shared vector-PDF layer renderer ----
// Used by both the floor overlay page and the mapper page background.
export type VecPath = { items: VecItem[]; fill: string | null; stroke: string | null; width: number };
export type VecItem = [string, ...number[]];
export type VecText = { t: string; x: number; y: number; s: number; c: string };
export type VecLayer = { page_w: number; page_h: number; paths: VecPath[]; texts: VecText[] };

export function drawVecLayer(
  ctx: CanvasRenderingContext2D,
  v: View,
  vl: VecLayer,
  alpha: number,
  canvasW: number,
  canvasH: number,
  // Optional clip rectangle in PDF space (pts). Use to exclude schedule/table areas
  // that live outside the structural drawing zone. When omitted, defaults to full page.
  clipPdf?: { x0: number; y0: number; x1: number; y1: number },
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Clip 1 — canvas screen bounds. Any PDF content that maps outside the visible
  // canvas area (y > canvasH etc.) is discarded, mirroring a PDF viewer viewport.
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.clip();
  ctx.transform(v.scale, 0, 0, v.scale, v.ox, v.oy);
  // Clip 2 — PDF-space bounding box. Applied after the transform so the rect is
  // expressed in PDF pts. Cuts off schedules / title blocks that live below/beside
  // the structural drawing area even when they map into the visible canvas range.
  if (clipPdf) {
    ctx.beginPath();
    ctx.rect(clipPdf.x0, clipPdf.y0, clipPdf.x1 - clipPdf.x0, clipPdf.y1 - clipPdf.y0);
    ctx.clip();
  }
  for (const path of vl.paths) {
    if (!path.items.length) continue;
    ctx.beginPath();
    let started = false;
    for (const it of path.items) {
      if (it[0] === 'l') {
        if (!started) { ctx.moveTo(it[1] as number, it[2] as number); started = true; }
        ctx.lineTo(it[3] as number, it[4] as number);
      } else if (it[0] === 'r') {
        ctx.rect(it[1] as number, it[2] as number, (it[3] as number) - (it[1] as number), (it[4] as number) - (it[2] as number));
        started = true;
      } else if (it[0] === 'c') {
        if (!started) { ctx.moveTo(it[1] as number, it[2] as number); started = true; }
        ctx.bezierCurveTo(it[3] as number, it[4] as number, it[5] as number, it[6] as number, it[7] as number, it[8] as number);
      }
    }
    if (path.fill) { ctx.fillStyle = path.fill; ctx.fill(); }
    if (path.stroke && path.width > 0) {
      ctx.strokeStyle = path.stroke;
      // lineWidth is in PDF-space coords; keep it at least 0.3/scale so it stays ≥0.3px on screen
      ctx.lineWidth = Math.max(0.3 / v.scale, path.width);
      ctx.stroke();
    }
  }
  // Texts: font size is in PDF pts (same space as the transform), but we clamp to a
  // minimum of 7 screen-pixels so text stays readable at any zoom level.
  for (const t of vl.texts) {
    const screenPx = Math.max(7, t.s * v.scale);   // desired screen size
    const pdfPts = screenPx / v.scale;              // back to PDF space (transform undoes scale)
    ctx.font = `${pdfPts}px Arial, sans-serif`;
    ctx.fillStyle = t.c || '#000';
    ctx.fillText(t.t, t.x, t.y);
  }
  ctx.restore();
}
