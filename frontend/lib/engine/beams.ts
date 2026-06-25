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

// ---- V2 types (ETABS-first corridor algorithm) ----
export type BeamStatusV2 = 'verified' | 'missing' | 'extra';

export interface EtabsBeamResult {
  etabs_id: string;
  ea: string; eb: string;           // ETABS column IDs
  status: 'verified' | 'missing';
  // GFC-space corridor corners (for rendering)
  gx1: number; gy1: number; gx2: number; gy2: number;
}

export interface DrawingBeamResult {
  drawing_id: string;
  a: string; b: string;             // GFC column IDs
  status: 'verified' | 'extra';
}

export interface BeamMatchV2Output {
  etabsBeams: EtabsBeamResult[];
  drawingBeams: DrawingBeamResult[];
  counts: { verified: number; missing: number; extra: number };
}

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

// ---------------------------------------------------------------------------
// V2 — ETABS-first corridor algorithm
//
// ETABS is ground truth. For each ETABS beam A→B:
//  1. Project A and B into GFC drawing space via the inverse affine.
//  2. Build a corridor rectangle: ±PERP_TOL_GFC perpendicular to the beam,
//     clipped between the column faces (not just the column centres).
//  3. Check every raw drawing line segment — if its midpoint (or any endpoint)
//     falls inside the corridor → ETABS beam is "verified".
//  4. Any ETABS beam with no corridor hit → "missing" (primary flaw).
//  5. Any drawing beam whose midpoint wasn't captured by any ETABS corridor
//     → "extra" (secondary review item).
//
// Corridor width: PERP_TOL = 300 mm in ETABS space. We convert to GFC space
// by dividing by the affine scale factor (approximate isotropic scale).
// ---------------------------------------------------------------------------

const PERP_TOL_MM = 300; // mm, perpendicular half-width in ETABS space

// Invert a 2-D affine: given GFC→ETABS affine, return ETABS→GFC affine.
function invertAffine(aff: Affine): Affine {
  const det = aff.a * aff.e - aff.b * aff.d;
  if (Math.abs(det) < 1e-12) throw new Error('Singular affine — cannot invert');
  const ia = aff.e / det, ib = -aff.b / det;
  const id = -aff.d / det, ie = aff.a / det;
  return {
    a: ia, b: ib, c: -(ia * aff.c + ib * aff.f),
    d: id, e: ie, f: -(id * aff.c + ie * aff.f),
  };
}

// Approximate scale factor of a GFC→ETABS affine (mm per PDF pt)
function affineScale(aff: Affine): number {
  return Math.sqrt(Math.abs(aff.a * aff.e - aff.b * aff.d));
}

// Signed perpendicular distance from point P to segment A→B (positive = left side)
// and projection scalar t (0 = at A, 1 = at B).
function segProx(px: number, py: number, ax: number, ay: number, bx: number, by: number): { perp: number; t: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { perp: Math.hypot(px - ax, py - ay), t: 0 };
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return { perp: Math.hypot((px - ax) - t * dx, (py - ay) - t * dy), t };
}

export function runBeamMatchV2(
  contract: Contract,
  affine: Affine,       // GFC → ETABS
  match: MatchOutput,
): BeamMatchV2Output {
  const inv = invertAffine(affine);
  const scale = affineScale(affine); // mm per GFC pt (approx)
  // Convert PERP_TOL from mm to GFC pts
  const perpTolGfc = PERP_TOL_MM / scale;

  // Build ETABS column lookup
  const ecById = new Map(contract.etabs_cols.map((c) => [c.id, c]));

  // Build a map: ETABS col pair → ETABS beam
  // Snap ETABS beam endpoints to nearest column (same 60mm snap as V1)
  const snap60 = (x: number, y: number): string | null => {
    let best: string | null = null, bd = 60;
    for (const c of contract.etabs_cols) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  };

  interface EtabsEdge { id: string; ea: string; eb: string; x1: number; y1: number; x2: number; y2: number; }
  const etabsEdges: EtabsEdge[] = [];
  for (const b of contract.etabs_beams) {
    const ea = snap60(b.x1, b.y1), eb = snap60(b.x2, b.y2);
    if (ea && eb && ea !== eb) etabsEdges.push({ id: b.id, ea, eb, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
  }

  // Deduplicate by column pair (keep first)
  const seen = new Set<string>();
  const uniqueEdges = etabsEdges.filter((e) => {
    const k = [e.ea, e.eb].sort().join('|');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Collect all drawing line segments from raw_lines (backend-extracted beam lines in GFC space)
  // Fall back to drawing_beams midpoints if raw_lines unavailable.
  // raw_lines are in GFC (PDF) space already.
  const rawLines: { x1: number; y1: number; x2: number; y2: number }[] =
    (contract.schedule?.raw_lines as typeof rawLines | undefined) ?? [];

  // GFC column position lookup
  const gfcById = new Map(contract.gfc_cols.map((c) => [c.id, c]));
  // Drawing beam midpoints (GFC space) as fallback line segments
  const drawingSegs = contract.drawing_beams.map((db) => {
    const ca = gfcById.get(db.a), cb = gfcById.get(db.b);
    if (!ca || !cb) return null;
    return { x1: ca.cx, y1: ca.cy, x2: cb.cx, y2: cb.cy, id: db.id };
  }).filter(Boolean) as { x1: number; y1: number; x2: number; y2: number; id: string }[];

  const segments = rawLines.length > 0
    ? rawLines.map((l, i) => ({ ...l, id: `raw_${i}` }))
    : drawingSegs;

  // For each ETABS beam, project into GFC space and check corridor
  const verifiedDrawingIds = new Set<string>();
  const etabsResults: EtabsBeamResult[] = [];

  for (const edge of uniqueEdges) {
    // Project ETABS column centres into GFC space
    const [gx1, gy1] = applyAffine(inv, edge.x1, edge.y1);
    const [gx2, gy2] = applyAffine(inv, edge.x2, edge.y2);

    // Column face clipping: shrink corridor ends inward by half the column B/D
    // along the beam axis to avoid including segments that just touch a column box.
    const ca = ecById.get(edge.ea), cb = ecById.get(edge.eb);
    const len = Math.hypot(gx2 - gx1, gy2 - gy1);
    // Inward clip as fraction of beam length (column half-dimension / beam length)
    const clipA = ca ? (Math.max(ca.B, ca.D) / 2) / scale / Math.max(len, 1) : 0;
    const clipB = cb ? (Math.max(cb.B, cb.D) / 2) / scale / Math.max(len, 1) : 0;
    // t range for corridor: [clipA, 1-clipB]
    const tMin = clipA, tMax = 1 - clipB;

    let verified = false;
    for (const seg of segments) {
      // Check both endpoints and midpoint of the drawing segment
      const pts = [
        { x: seg.x1, y: seg.y1 },
        { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 },
        { x: seg.x2, y: seg.y2 },
      ];
      for (const pt of pts) {
        const { perp, t } = segProx(pt.x, pt.y, gx1, gy1, gx2, gy2);
        if (perp <= perpTolGfc && t >= tMin && t <= tMax) {
          verified = true;
          verifiedDrawingIds.add(seg.id);
          break;
        }
      }
      if (verified) break;
    }

    etabsResults.push({
      etabs_id: edge.id,
      ea: edge.ea, eb: edge.eb,
      status: verified ? 'verified' : 'missing',
      gx1, gy1, gx2, gy2,
    });
  }

  // Drawing beams not captured by any ETABS corridor → "extra"
  const drawingResults: DrawingBeamResult[] = drawingSegs.map((seg) => ({
    drawing_id: seg.id,
    a: contract.drawing_beams.find((db) => {
      const ca = gfcById.get(db.a); return ca && Math.hypot(ca.cx - seg.x1, ca.cy - seg.y1) < 1;
    })?.a ?? '',
    b: contract.drawing_beams.find((db) => {
      const cb = gfcById.get(db.b); return cb && Math.hypot(cb.cx - seg.x2, cb.cy - seg.y2) < 1;
    })?.b ?? '',
    status: verifiedDrawingIds.has(seg.id) ? 'verified' : 'extra',
  }));

  return {
    etabsBeams: etabsResults,
    drawingBeams: drawingResults,
    counts: {
      verified: etabsResults.filter((e) => e.status === 'verified').length,
      missing: etabsResults.filter((e) => e.status === 'missing').length,
      extra: drawingResults.filter((d) => d.status === 'extra').length,
    },
  };
}
