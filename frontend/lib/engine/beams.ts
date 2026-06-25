// Engine Step 7 — beam matching.
//
// Pass 1 (topological): a drawing beam (GFC column pair a→b) is matched to an
// ETABS beam when both column endpoints map to the same ETABS column pair.
// This is exact — no geometry tolerance for the beam itself.
//
// Pass 2 (positional fallback): for drawing beams that failed Pass 1 because one
// or both column endpoints are LOW/UNMATCHED, transform the GFC beam midpoint into
// ETABS space (using the refined affine) and check if it falls inside the
// perpendicular corridor of any unmatched ETABS beam:
//   • perpendicular distance to beam centreline ≤ PERP_TOL (250 mm)
//   • projection along beam axis falls within the beam span (with ±AXIAL_TOL slop)
// The closest corridor match wins.
//
// Status values:
//   matched          → topological match (Pass 1)
//   pos_match        → positional corridor match (Pass 2)
//   drawing_only     → drawn but no ETABS beam found by either pass
//   nocol            → both column endpoints unmatched AND no positional match
//
// etabs_only: ETABS edges whose both column ends matched but no drawing beam was found.

import type { Affine, Contract, DrawingBeam, EtabsBeam, EtabsCol, MatchOutput } from './types';
import { applyAffine } from './geometry';

export type BeamStatus = 'matched' | 'pos_match' | 'drawing_only' | 'nocol';

export interface BeamRow extends DrawingBeam {
  ea: string | null;
  eb: string | null;
  status: BeamStatus;
  etabs_edge: [string, string] | null;
}

export interface BeamMatchOutput {
  beams: BeamRow[];
  etabsOnlyEdges: { a: string; b: string }[];   // modeled, not drawn
  counts: { matched: number; pos_match: number; drawing_only: number; etabs_only: number; nocol: number };
}

const PERP_TOL = 250;   // mm — max perpendicular distance to ETABS beam line
const AXIAL_TOL = 500;  // mm — slop allowed beyond beam endpoint along axis

// Build the set of ETABS column-to-column edges (one per beam, deduped, sorted).
// Endpoints are snapped to the nearest ETABS column within 60mm (v10 constant).
function buildEtabsEdges(
  beams: EtabsBeam[],
  cols: EtabsCol[],
): Map<string, { a: string; b: string; x1: number; y1: number; x2: number; y2: number }> {
  const nE = (x: number, y: number): string | null => {
    let bi: string | null = null, bd = 60;
    for (const c of cols) { const d = Math.hypot(x - c.x, y - c.y); if (d < bd) { bd = d; bi = c.id; } }
    return bi;
  };
  const edges = new Map<string, { a: string; b: string; x1: number; y1: number; x2: number; y2: number }>();
  for (const b of beams) {
    const a = nE(b.x1, b.y1), c = nE(b.x2, b.y2);
    if (a && c && a !== c) {
      const s = [a, c].sort();
      const k = s.join('|');
      if (!edges.has(k)) edges.set(k, { a: s[0], b: s[1], x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
    }
  }
  return edges;
}

// Signed perpendicular distance from point P to the infinite line through A→B,
// and the scalar projection t ∈ [0,1] of P onto segment AB.
function segmentProximity(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { perp: number; t: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { perp: Math.hypot(px - ax, py - ay), t: 0 };
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { perp: Math.hypot(px - cx, py - cy), t };
}

// Check whether a GFC beam midpoint (in ETABS space) falls within the corridor of
// an ETABS beam. Returns the perpendicular distance if it matches, else Infinity.
function corridorDist(
  gfcMidX: number, gfcMidY: number,
  eb: { x1: number; y1: number; x2: number; y2: number },
): number {
  const len = Math.hypot(eb.x2 - eb.x1, eb.y2 - eb.y1);
  if (len < 1) return Infinity;
  const { perp, t } = segmentProximity(gfcMidX, gfcMidY, eb.x1, eb.y1, eb.x2, eb.y2);
  const axialSlop = AXIAL_TOL / len;
  if (perp <= PERP_TOL && t >= -axialSlop && t <= 1 + axialSlop) return perp;
  return Infinity;
}

export function runBeamMatch(contract: Contract, match: MatchOutput, affine?: Affine | null): BeamMatchOutput {
  const eEdges = buildEtabsEdges(contract.etabs_beams, contract.etabs_cols);
  const g2e: Record<string, string> = {};
  match.matchResult.forEach((m) => { if (m.matched && m.gfc_id && m.etabs_id) g2e[m.gfc_id] = m.etabs_id; });

  // Build GFC column position lookup for positional fallback
  const gfcPos = new Map(contract.gfc_cols.map((c) => [c.id, { x: c.cx, y: c.cy }]));

  // Pass 1 — topological match
  const beams: BeamRow[] = contract.drawing_beams.map((db) => {
    const ea = g2e[db.a] ?? null, eb = g2e[db.b] ?? null;
    let status: BeamStatus, etabs_edge: [string, string] | null = null;
    if (!ea || !eb) {
      status = 'nocol';  // may be upgraded in Pass 2
    } else {
      const k = [ea, eb].sort().join('|');
      if (eEdges.has(k)) { status = 'matched'; etabs_edge = [ea, eb]; eEdges.delete(k); }
      else status = 'drawing_only';
    }
    return { ...db, ea, eb, status, etabs_edge };
  });

  // Pass 2 — positional corridor fallback (only when affine is available)
  if (affine) {
    // Collect remaining (unmatched) ETABS edges as candidates
    const remainingEdges = new Map(eEdges);  // snapshot before Pass 2 starts

    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b.status !== 'drawing_only' && b.status !== 'nocol') continue;

      // Get GFC endpoint positions, transform to ETABS space
      const pa = gfcPos.get(b.a), pb = gfcPos.get(b.b);
      if (!pa || !pb) continue;
      const [eax, eay] = applyAffine(affine, pa.x, pa.y);
      const [ebx, eby] = applyAffine(affine, pb.x, pb.y);
      const midX = (eax + ebx) / 2, midY = (eay + eby) / 2;

      // Find the closest ETABS edge whose corridor contains this midpoint
      let bestKey: string | null = null, bestDist = Infinity;
      for (const [k, edge] of remainingEdges) {
        const d = corridorDist(midX, midY, edge);
        if (d < bestDist) { bestDist = d; bestKey = k; }
      }

      if (bestKey !== null) {
        const edge = remainingEdges.get(bestKey)!;
        beams[i] = { ...b, status: 'pos_match', etabs_edge: [edge.a, edge.b] };
        remainingEdges.delete(bestKey);  // consumed — can't match another drawing beam
        eEdges.delete(bestKey);          // remove from the pool used for etabs_only below
      }
    }
  }

  // Remaining ETABS edges whose BOTH ends are matched columns = modeled-not-drawn
  const matchedEtabs = new Set(match.matchResult.filter((m) => m.matched).map((m) => m.etabs_id));
  const etabsOnlyEdges = [...eEdges.values()].filter((e) => matchedEtabs.has(e.a) && matchedEtabs.has(e.b));

  return {
    beams,
    etabsOnlyEdges,
    counts: {
      matched: beams.filter((b) => b.status === 'matched').length,
      pos_match: beams.filter((b) => b.status === 'pos_match').length,
      drawing_only: beams.filter((b) => b.status === 'drawing_only').length,
      etabs_only: etabsOnlyEdges.length,
      nocol: beams.filter((b) => b.status === 'nocol').length,
    },
  };
}
