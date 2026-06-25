// Calibration math — faithful TS port of engine_core.js (verbatim from
// rosetta_mapper_v10.html). Reflection-aware similarity + ICP. Behavior must be
// IDENTICAL to the oracle (parity gate). Do not "improve" the math.

import type { Affine, EtabsCol, GfcCol } from './types';

export function solveAffine(
  src: { x: number; y: number }[],
  dst: { x: number; y: number }[],
): Affine {
  const p0 = src[0], p1 = src[1], p2 = src[2];
  const q0 = dst[0], q1 = dst[1], q2 = dst[2];
  const M = [
    [p0.x, p0.y, 1, 0, 0, 0], [0, 0, 0, p0.x, p0.y, 1],
    [p1.x, p1.y, 1, 0, 0, 0], [0, 0, 0, p1.x, p1.y, 1],
    [p2.x, p2.y, 1, 0, 0, 0], [0, 0, 0, p2.x, p2.y, 1],
  ];
  const b = [q0.x, q0.y, q1.x, q1.y, q2.x, q2.y];
  const n = 6;
  for (let i = 0; i < n; i++) {
    let mr = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[mr][i])) mr = k;
    const tM = M[i]; M[i] = M[mr]; M[mr] = tM;
    const tb = b[i]; b[i] = b[mr]; b[mr] = tb;
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = b[i];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return { a: x[0], b: x[1], c: x[2], d: x[3], e: x[4], f: x[5] };
}

export function applyAffine(aff: Affine, px: number, py: number): [number, number] {
  return [aff.a * px + aff.b * py + aff.c, aff.d * px + aff.e * py + aff.f];
}

function genericSolve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r) => r.slice()), x = b.slice();
  for (let i = 0; i < n; i++) {
    let mr = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[mr][i])) mr = k;
    [M[i], M[mr]] = [M[mr], M[i]]; [x[i], x[mr]] = [x[mr], x[i]];
    for (let k = i + 1; k < n; k++) {
      const fct = M[k][i] / M[i][i];
      for (let jj = i; jj < n; jj++) M[k][jj] -= fct * M[i][jj];
      x[k] -= fct * x[i];
    }
  }
  const r = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    r[i] = x[i];
    for (let jj = i + 1; jj < n; jj++) r[i] -= M[i][jj] * r[jj];
    r[i] /= M[i][i];
  }
  return r;
}

// Reflection-aware least-squares similarity fit. Tries the proper rotation
// [[a,-b],[b,a]] and the improper (reflected) [[a,b],[b,-a]]; keeps lower SSE.
export function fitSimilarity(src: number[][], dst: number[][]): Affine {
  function solveForm(sign: number): { M: Affine; sse: number } {
    const N = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const rhs = [0, 0, 0, 0];
    function acc(row: number[], val: number) {
      for (let i = 0; i < 4; i++) {
        rhs[i] += row[i] * val;
        for (let j = 0; j < 4; j++) N[i][j] += row[i] * row[j];
      }
    }
    for (let k = 0; k < src.length; k++) {
      const x = src[k][0], y = src[k][1], X = dst[k][0], Y = dst[k][1];
      if (sign > 0) { acc([x, -y, 1, 0], X); acc([y, x, 0, 1], Y); }
      else { acc([x, y, 1, 0], X); acc([-y, x, 0, 1], Y); }
    }
    const u = genericSolve(N, rhs);
    let sse = 0;
    for (let k = 0; k < src.length; k++) {
      const x = src[k][0], y = src[k][1];
      const X = sign > 0 ? u[0] * x - u[1] * y + u[2] : u[0] * x + u[1] * y + u[2];
      const Y = sign > 0 ? u[1] * x + u[0] * y + u[3] : u[1] * x - u[0] * y + u[3];
      sse += (X - dst[k][0]) ** 2 + (Y - dst[k][1]) ** 2;
    }
    const M: Affine = sign > 0
      ? { a: u[0], b: -u[1], c: u[2], d: u[1], e: u[0], f: u[3] }
      : { a: u[0], b: u[1], c: u[2], d: u[1], e: -u[0], f: u[3] };
    return { M, sse };
  }
  const P = solveForm(1), Q = solveForm(-1);
  return P.sse <= Q.sse ? P.M : Q.M;
}

export function linAnisotropy(M: Affine): number {
  const a = M.a, b = M.b, c = M.d, d = M.e;
  const A = a * a + b * b, B = c * c + d * d, Cc = a * c + b * d;
  const t = (A + B) / 2, r = Math.sqrt(Math.max(0, ((A - B) / 2) ** 2 + Cc * Cc));
  const s1 = Math.sqrt(Math.max(0, t + r)), s2 = Math.sqrt(Math.max(0, t - r));
  return s2 > 1e-9 ? s1 / s2 : 999;
}

export function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1, vy = y2 - y1, L = vx * vx + vy * vy;
  if (L === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * vx + (py - y1) * vy) / L;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

// ICP gate schedule is verbatim from v10 (3000 → 400mm, ten passes).
export function icpRefine(seed: Affine, GFC_COLS: GfcCol[], ETABS_COLS: EtabsCol[]): Affine {
  let M: Affine = { ...seed };
  for (const gate of [3000, 2000, 1200, 800, 600, 500, 450, 400, 400, 400]) {
    const src: number[][] = [], dst: number[][] = [];
    for (const col of GFC_COLS) {
      const t = applyAffine(M, col.cx, col.cy);
      let bj = -1, bd = gate;
      for (let j = 0; j < ETABS_COLS.length; j++) {
        const e = ETABS_COLS[j];
        const dd = Math.hypot(t[0] - e.x, t[1] - e.y);
        if (dd < bd) { bd = dd; bj = j; }
      }
      if (bj >= 0) { src.push([col.cx, col.cy]); dst.push([ETABS_COLS[bj].x, ETABS_COLS[bj].y]); }
    }
    if (src.length < 6) break;
    M = fitSimilarity(src, dst);
  }
  return M;
}

// Deterministic reflection-aware seed (no human click): brute-force
// {refl ±1} × {0/90/180/270°} bbox-centroid+width similarity, ICP-refine each,
// keep lowest mean residual. Same routine as the oracle's deriveSeed.
export function deriveSeed(GFC_COLS: GfcCol[], ETABS_COLS: EtabsCol[]): { seed: Affine; residual: number; desc: string } {
  const gxs = GFC_COLS.map((c) => c.cx), gys = GFC_COLS.map((c) => c.cy);
  const exs = ETABS_COLS.map((c) => c.x), eys = ETABS_COLS.map((c) => c.y);
  const gb = [Math.min(...gxs), Math.max(...gxs), Math.min(...gys), Math.max(...gys)];
  const eb = [Math.min(...exs), Math.max(...exs), Math.min(...eys), Math.max(...eys)];
  const gcx = (gb[0] + gb[1]) / 2, gcy = (gb[2] + gb[3]) / 2;
  const ecx = (eb[0] + eb[1]) / 2, ecy = (eb[2] + eb[3]) / 2;
  const gw = gb[1] - gb[0], scale = (eb[1] - eb[0]) / gw;
  const meanResidual = (M: Affine) => {
    let s = 0;
    for (const c of GFC_COLS) {
      const t = applyAffine(M, c.cx, c.cy);
      let bd = Infinity;
      for (const e of ETABS_COLS) { const d = Math.hypot(t[0] - e.x, t[1] - e.y); if (d < bd) bd = d; }
      s += bd;
    }
    return s / GFC_COLS.length;
  };
  let best: Affine | null = null, bestR = Infinity, desc = '';
  for (const refl of [1, -1]) {
    for (const deg of [0, 90, 180, 270]) {
      const r = (deg * Math.PI) / 180, ca = Math.cos(r), sa = Math.sin(r);
      const src = [{ x: gcx, y: gcy }, { x: gcx + gw, y: gcy }, { x: gcx, y: gcy + gw }];
      const dst = src.map((p) => {
        const dx = (p.x - gcx) * scale, dy = (p.y - gcy) * scale * refl;
        return { x: ecx + dx * ca - dy * sa, y: ecy + dx * sa + dy * ca };
      });
      const seed = solveAffine(src, dst);
      const refined = icpRefine(seed, GFC_COLS, ETABS_COLS);
      const rr = meanResidual(refined);
      if (rr < bestR) { bestR = rr; best = seed; desc = `refl=${refl} deg=${deg}`; }
    }
  }
  return { seed: best!, residual: bestR, desc };
}
