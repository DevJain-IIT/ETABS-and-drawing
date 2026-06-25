// Registration A — attach column NAMES (C1, C2…) to column BOXES.
// The layout-plan name marks and the arrangement-plan columns sit in different
// frames (the handoff: a near-pure TRANSLATION; a free similarity fit diverges).
// Per the agreed design: the engineer clicks 3 matching point-pairs (column box
// ↔ name mark); we solve a constrained transform (translation, then optional
// uniform scale) and Hungarian-assign each name to its nearest column.
//
// Until the engineer does this, columns stay UNNAMED (never auto-guess). Labels
// are display/verify only — they never drive the geometric matching (Rule 4).

import type { GfcCol } from './types';
import { hungarian } from './match';

export interface CMark { mark: string; x: number; y: number; }
export interface PointPair { col: { cx: number; cy: number }; mark: { x: number; y: number }; }

// Solve a translation+uniform-scale transform from >=2 point pairs (least
// squares). Mark space -> column space. Reflection is not expected here (both
// are PDF sheets, same handedness), so we keep it scale+translate only — that is
// the constrained fit the handoff requires (free similarity diverged).
export interface SimpleXf { s: number; tx: number; ty: number; }

export function solveTranslationScale(pairs: PointPair[]): SimpleXf {
  // minimise sum |s*mark + t - col|^2 over s, tx, ty
  const n = pairs.length;
  let sx = 0, sy = 0, cx = 0, cy = 0;
  for (const p of pairs) { sx += p.mark.x; sy += p.mark.y; cx += p.col.cx; cy += p.col.cy; }
  const mmx = sx / n, mmy = sy / n, mcx = cx / n, mcy = cy / n;
  let num = 0, den = 0;
  for (const p of pairs) {
    const dmx = p.mark.x - mmx, dmy = p.mark.y - mmy;
    const dcx = p.col.cx - mcx, dcy = p.col.cy - mcy;
    num += dmx * dcx + dmy * dcy;
    den += dmx * dmx + dmy * dmy;
  }
  const s = den > 1e-9 ? num / den : 1;
  return { s, tx: mcx - s * mmx, ty: mcy - s * mmy };
}

export function applyXf(xf: SimpleXf, x: number, y: number): [number, number] {
  return [xf.s * x + xf.tx, xf.s * y + xf.ty];
}

export interface NameResult {
  gfc_cmark: Record<string, string>;       // gfc_id -> C-type
  flagged: string[];                        // columns assigned but with large residual
  residual: number;                         // mean assignment distance (column-space pts)
}

// Assign names to columns via Hungarian on the transformed-mark ↔ column cost.
export function attachNames(
  cols: GfcCol[], marks: CMark[], xf: SimpleXf, flagFactor = 2.5,
): NameResult {
  const tm = marks.map((m) => { const [x, y] = applyXf(xf, m.x, m.y); return { mark: m.mark, x, y }; });
  const nC = cols.length, nM = tm.length;
  // cost[col][mark] = distance
  const cost: number[][] = cols.map((c) => tm.map((m) => Math.hypot(c.cx - m.x, c.cy - m.y)));
  const asg = hungarian(cost);              // col index -> mark index
  const gfc_cmark: Record<string, string> = {};
  const dists: number[] = [];
  for (let i = 0; i < nC; i++) {
    const j = asg[i];
    if (j != null && j < nM) {
      gfc_cmark[cols[i].id] = tm[j].mark;
      dists.push(cost[i][j]);
    }
  }
  const med = dists.length ? [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)] : 0;
  const flagged: string[] = [];
  for (let i = 0; i < nC; i++) {
    const j = asg[i];
    if (j != null && j < nM && cost[i][j] > flagFactor * med) flagged.push(cols[i].id);
  }
  const residual = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : 0;
  return { gfc_cmark, flagged, residual: +residual.toFixed(1) };
}
