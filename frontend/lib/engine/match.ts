// Column matching — faithful TS port of runHungarian (engine_core.runColumnMatch).
// Hungarian assignment + relative confidence tiers + pier cross-check (wall
// arbitration) + mutual-nearest recovery. Behavior must equal the oracle.

import type { Affine, Confidence, EtabsCol, GfcCol, EtabsWall, MatchOutput, MatchRow } from './types';
import { applyAffine, distSeg, icpRefine, linAnisotropy } from './geometry';

// v10 absolute pier tolerance (mm). The handoff flags this for the corpus sweep;
// v11 will make it relative (0.35·local-spacing). Kept absolute here for parity.
export const PIER_TOL = 250;

export function hungarian(costMatrix: number[][]): (number)[] {
  const n = costMatrix.length, m = costMatrix[0].length, INF = 1e18, sz = Math.max(n, m);
  const C: number[][] = [];
  for (let i = 0; i < sz; i++) {
    const row: number[] = [];
    for (let j = 0; j < sz; j++) row.push(i < n && j < m ? costMatrix[i][j] : INF * 0.1);
    C.push(row);
  }
  const u = new Array(sz + 1).fill(0), v = new Array(sz + 1).fill(0);
  const p = new Array(sz + 1).fill(0), way = new Array(sz + 1).fill(0);
  for (let i = 1; i <= sz; i++) {
    p[0] = i;
    let j0 = 0;
    const minVal = new Array(sz + 1).fill(INF), used = new Array(sz + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]; let delta = INF, j1 = -1;
      for (let j = 1; j <= sz; j++) {
        if (!used[j]) {
          const cur = C[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minVal[j]) { minVal[j] = cur; way[j] = j0; }
          if (minVal[j] < delta) { delta = minVal[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= sz; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minVal[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n);
  for (let j = 1; j <= sz; j++) if (p[j] && p[j] <= n) res[p[j] - 1] = j - 1;
  return res;
}

export interface MatchCtx { GFC_COLS: GfcCol[]; ETABS_COLS: EtabsCol[]; ETABS_WALLS: EtabsWall[]; }

// seedTransform is the 3-point affine seed; the engine ICP-refines it. If
// `prealigned` is given (the calibration step already ran ICP), it is used
// as-is — this keeps parity with the oracle which always refines its seed, while
// letting the live UI reuse the transform the engineer already aligned.
export function runColumnMatch(seedTransform: Affine, ctx: MatchCtx, maxCap = 1e9, prealigned?: Affine | null): MatchOutput {
  const { GFC_COLS, ETABS_COLS, ETABS_WALLS } = ctx;
  const refined = prealigned ?? icpRefine(seedTransform, GFC_COLS, ETABS_COLS);
  const gfcT = GFC_COLS.map((col) => {
    const t = applyAffine(refined, col.cx, col.cy);
    return { id: col.id, tx: t[0], ty: t[1], rw: col.rw, rh: col.rh };
  });
  const nG = gfcT.length, nE = ETABS_COLS.length;
  const D: number[][] = [];
  for (let i = 0; i < nG; i++) {
    const row = new Array(nE), g = gfcT[i];
    for (let j = 0; j < nE; j++) { const e = ETABS_COLS[j]; row[j] = Math.hypot(g.tx - e.x, g.ty - e.y); }
    D.push(row);
  }
  const nn2 = new Array(nG);
  for (let i = 0; i < nG; i++) {
    let m1 = Infinity, m2 = Infinity;
    for (let j = 0; j < nE; j++) { const d = D[i][j]; if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) m2 = d; }
    nn2[i] = m2;
  }
  const nnE = new Array(nE).fill(Infinity);
  for (let j = 0; j < nE; j++) {
    for (let k = 0; k < nE; k++) {
      if (k === j) continue;
      const d = Math.hypot(ETABS_COLS[j].x - ETABS_COLS[k].x, ETABS_COLS[j].y - ETABS_COLS[k].y);
      if (d < nnE[j]) nnE[j] = d;
    }
  }
  const cost = D.map((row) => row.map((d) => Math.min(d, 1e8)));
  const asg = hungarian(cost);
  let matchResult: MatchRow[] = [];
  const usedSet = new Set<number>();
  for (let i = 0; i < nG; i++) {
    const j = asg[i], g = gfcT[i], e = (j != null && j < nE) ? ETABS_COLS[j] : null;
    let conf: Confidence = 'LOW';
    if (e) {
      const d = D[i][j], ratio = d / Math.max(nn2[i], 1e-9), sp = nnE[j];
      if (d < 0.18 * sp && ratio < 0.5 && d < maxCap) conf = 'HIGH';
      else if (d < 0.45 * sp && ratio < 0.75 && d < maxCap) conf = 'MED';
    }
    const accepted = !!e && conf !== 'LOW';
    if (accepted) usedSet.add(j);
    const dd = e ? D[i][j] : Infinity;
    matchResult.push({
      gfc_id: g.id, etabs_id: accepted ? e!.id : null,
      gfc_tx: Math.round(g.tx), gfc_ty: Math.round(g.ty),
      etabs_x: accepted ? e!.x : null, etabs_y: accepted ? e!.y : null,
      dist: e ? Math.round(dd) : null, matched: accepted, confidence: conf,
      ratio: e ? +(dd / Math.max(nn2[i], 1e-9)).toFixed(2) : null,
    });
  }
  for (let j = 0; j < nE; j++) {
    if (!usedSet.has(j)) {
      const e = ETABS_COLS[j];
      matchResult.push({
        gfc_id: null, etabs_id: e.id, gfc_tx: null, gfc_ty: null,
        etabs_x: e.x, etabs_y: e.y, dist: null, matched: false,
        confidence: 'UNMATCHED_ETABS', ratio: null,
      });
    }
  }
  // pier cross-check (wall arbitrator)
  matchResult.forEach((m) => {
    if (m.gfc_id && m.confidence === 'LOW') {
      const g = GFC_COLS.find((c) => c.id === m.gfc_id)!;
      const t = applyAffine(refined, g.cx, g.cy);
      let best = 1e9, bp: string | null = null;
      for (const w of ETABS_WALLS) { const d = distSeg(t[0], t[1], w.x1, w.y1, w.x2, w.y2); if (d < best) { best = d; bp = w.sw; } }
      if (best < PIER_TOL) { m.confidence = 'WALL'; m.pier = bp; m.wall_dist = Math.round(best); m.matched = false; }
    }
  });
  // mutual-nearest recovery
  const _ei: Record<string, number> = {};
  ETABS_COLS.forEach((c, j) => { _ei[c.id] = j; });
  matchResult.filter((m) => m.confidence === 'UNMATCHED_ETABS').forEach((me) => {
    const ej = _ei[me.etabs_id!];
    let gi = -1, gd = Infinity;
    for (let i = 0; i < gfcT.length; i++) { if (D[i][ej] < gd) { gd = D[i][ej]; gi = i; } }
    if (gi < 0) return;
    let eb = -1, bd = Infinity;
    for (let j = 0; j < ETABS_COLS.length; j++) { if (D[gi][j] < bd) { bd = D[gi][j]; eb = j; } }
    if (eb !== ej) return;
    const gentry = matchResult.find((m) => m.gfc_id === gfcT[gi].id);
    if (!gentry || gentry.confidence !== 'LOW') return;
    if (gd > 0.6 * nnE[ej]) return;
    const e = ETABS_COLS[ej];
    gentry.etabs_id = e.id; gentry.matched = true; gentry.confidence = 'MED'; gentry.mutual = true;
    gentry.dist = Math.round(gd); gentry.posdev = gd > 0.4 * nnE[ej]; gentry.ratio = null;
    (me as MatchRow & { _rm?: boolean })._rm = true;
  });
  matchResult = matchResult.filter((m) => !(m as MatchRow & { _rm?: boolean })._rm);

  const tally = (c: Confidence) => matchResult.filter((m) => m.confidence === c).length;
  return {
    refined,
    anisotropy: +linAnisotropy(refined).toFixed(4),
    counts: { HIGH: tally('HIGH'), MED: tally('MED'), LOW: tally('LOW'), WALL: tally('WALL'), UNMATCHED_ETABS: tally('UNMATCHED_ETABS') },
    matchResult,
  };
}
