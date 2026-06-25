// Step 1 — "Name the columns" (Registration A), all on the ONE Column Layout
// sheet. The sheet carries BOTH the column boxes AND the C-mark names (C1, C2…)
// in the SAME coordinate frame, so there is NO calibration: we Hungarian-match
// each name to its nearest column box directly. Shear walls (kind "wall") are
// tagged "SW" by geometry and never receive a C-mark. The engineer then
// flags/confirms/corrects; nothing is fabricated (an unnamed column stays blank).
//
// Labels are display/verify only — they never drive geometric matching (Rule 4).

import type { GfcCol, CMarkLayer } from './types';
import { hungarian } from './match';

export interface NamedCol {
  id: string;                       // GFC_n (layout-sheet id)
  cx: number; cy: number; rw: number; rh: number;
  kind: 'column' | 'wall';
  aspect?: number;                  // box aspect ratio (for SW display)
  name: string | null;              // C-mark for columns, "SW" for walls, null if unnamed
  dist: number | null;              // name→box distance (pts) — confidence proxy
  flagged: boolean;                 // large residual OR unnamed column OR name collision
  reason?: string;                  // why flagged (for the review card)
}

// An un-greyed column: a name mark whose nearest detected box is too far (beyond
// the orphan band) — i.e. a real column the grey-fill detector missed. We do NOT
// fabricate a box; we SUGGEST adding one at the name's position for the engineer
// to confirm (the name is the evidence). This is the "ADD a missed column" HITL
// path, name-driven.
export interface OrphanName {
  mark: string; x: number; y: number;   // name + its position (suggested box center)
  nearestDist: number;                  // distance to the nearest grey box (pt)
}

export interface NamingResult {
  cols: NamedCol[];
  orphanNames: OrphanName[];        // named columns with no detected grey box (suggest ADD)
  columns: number;                  // count of kind==column (grey-detected)
  walls: number;                    // count of kind==wall (SW)
  named: number;                    // columns that received a C-mark
  unnamed: number;                  // grey columns with no name
  flagged: number;                  // entries in the review queue (incl. orphans + SW)
  medianDist: number;               // median name→box distance (sets the orphan/flag band)
}

const isCol = (c: GfcCol) => (c.kind ?? 'column') === 'column';

// Auto-name: Hungarian assign name-marks to COLUMN boxes only (same frame, so the
// cost is raw distance). Walls are tagged "SW". flagFactor·median sets the
// "this name landed too far from any box — review it" band (relative, scale-free).
export function autoName(
  layoutCols: GfcCol[], layer: CMarkLayer, flagFactor = 2.2,
): NamingResult {
  const cols = layoutCols.filter(isCol);
  const walls = layoutCols.filter((c) => !isCol(c));
  const marks = layer?.marks ?? [];

  // cost[col][mark] = distance (same frame, no transform)
  const cost: number[][] = cols.map((c) => marks.map((m) => Math.hypot(c.cx - m.x, c.cy - m.y)));
  const asg = cols.length && marks.length ? hungarian(cost) : [];

  // 1st pass: collect the assigned name→box distances to set the relative band.
  const asgMark: (number | null)[] = cols.map((_, i) => {
    const j = asg[i];
    return (j != null && j >= 0 && j < marks.length) ? j : null;
  });
  const dists: number[] = [];
  for (let i = 0; i < cols.length; i++) {
    const j = asgMark[i];
    if (j != null) dists.push(cost[i][j]);
  }
  const sorted = [...dists].sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const band = flagFactor * med;   // beyond this, the name doesn't belong to that box

  // 2nd pass: a name assigned beyond the band is NOT this box's name — it is an
  // un-greyed column's label (orphan). The box reverts to unnamed; the orphan is
  // suggested as an ADD at the name's position.
  const orphanIdx = new Set<number>();   // mark indices that are orphans
  const colName: (string | null)[] = cols.map(() => null);
  const colDist: (number | null)[] = cols.map(() => null);
  for (let i = 0; i < cols.length; i++) {
    const j = asgMark[i];
    if (j == null) continue;
    if (med > 0 && cost[i][j] > band) { orphanIdx.add(j); }   // un-greyed column
    else { colName[i] = marks[j].mark; colDist[i] = cost[i][j]; }
  }

  const out: NamedCol[] = [];
  // columns (with names + flags)
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const name = colName[i];
    const dist = colDist[i];
    let flagged = false, reason: string | undefined;
    if (name == null) { flagged = true; reason = 'no name label found near this column'; }
    out.push({ id: c.id, cx: c.cx, cy: c.cy, rw: c.rw, rh: c.rh, kind: 'column', aspect: c.aspect, name, dist, flagged, reason });
  }
  // orphan names → un-greyed columns (suggest ADD). Also catch any mark never
  // assigned at all (when #names > #boxes).
  const assignedMarks = new Set(asgMark.filter((j): j is number => j != null && !orphanIdx.has(j)));
  const orphanNames: OrphanName[] = [];
  marks.forEach((m, j) => {
    if (orphanIdx.has(j) || !assignedMarks.has(j)) {
      // distance to nearest box (for the review card)
      let nd = Infinity;
      for (const c of cols) { const d = Math.hypot(c.cx - m.x, c.cy - m.y); if (d < nd) nd = d; }
      orphanNames.push({ mark: m.mark, x: m.x, y: m.y, nearestDist: +nd.toFixed(1) });
    }
  });
  // shear walls (SW by geometry — surfaced for confirmation, not auto-trusted)
  for (const w of walls) {
    out.push({ id: w.id, cx: w.cx, cy: w.cy, rw: w.rw, rh: w.rh, kind: 'wall', aspect: w.aspect,
      name: 'SW', dist: null, flagged: true, reason: `aspect ${(w.aspect ?? 0).toFixed(1)} > 4 → classified shear wall (SW) — confirm` });
  }

  const named = out.filter((c) => c.kind === 'column' && c.name != null).length;
  return {
    cols: out,
    orphanNames,
    columns: cols.length,
    walls: walls.length,
    named,
    unnamed: cols.length - named,
    flagged: out.filter((c) => c.flagged).length + orphanNames.length,
    medianDist: +med.toFixed(1),
  };
}
