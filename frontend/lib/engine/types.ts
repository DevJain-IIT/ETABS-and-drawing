// Engine types — mirror the Python data contract (backend/contract.py).
// The TS engine consumes exactly these arrays; coordinates are NOT pre-flipped
// (the reflection-aware ICP handles GFC↔ETABS reflection).

// kind: a grey box is a "column" (aspect <=4, gets a C-mark) or a "wall" (aspect
// >4 -> shear wall, named "SW"). Classified by the backend detector (§0a).
export interface GfcCol { id: string; cx: number; cy: number; rw: number; rh: number; kind?: 'column' | 'wall'; aspect?: number; }

// Raw C-mark name layer (rides in schedule.cmark_layer) — names + positions read
// from the Column Layout sheet, SAME frame as schedule.layout_cols. Display/verify
// only; attached to columns in the browser "Name the columns" step (Registration A).
export interface CMarkLayer {
  marks: { mark: string; x: number; y: number }[];
  counts: Record<string, number>;
  labels_found: number;
  schedule_total: number;
  reconciled: boolean | null;
  n_columns?: number;
}
export interface EtabsCol { id: string; x: number; y: number; B: number; D: number; ang: number; sec: string; }
export interface EtabsBeam { id: string; x1: number; y1: number; x2: number; y2: number; }
export interface EtabsWall { sw: string; pier: string; x1: number; y1: number; x2: number; y2: number; thk: number; }

export interface DrawingBeam {
  id: string; a: string; b: string;
  mark?: string | null; size?: string | null;
  faces?: number; Lf?: number | null; contiguous?: boolean | null; aligned?: boolean | null;
}

export interface Contract {
  project_name: string;
  img: { w: number; h: number; src: string };
  etabs_cols: EtabsCol[];
  etabs_beams: EtabsBeam[];
  etabs_walls: EtabsWall[];
  gfc_cols: GfcCol[];
  gfc_cmark: Record<string, string>;
  gfc_cmark_flagged: string[];
  drawing_beams: DrawingBeam[];
  secondary_draw: unknown[];
  schedule: Record<string, unknown>;
}

// 2-D affine: [x'] = a·x + b·y + c ; [y'] = d·x + e·y + f
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number; }

export type Confidence = 'HIGH' | 'MED' | 'LOW' | 'WALL' | 'UNMATCHED_ETABS';

export interface MatchRow {
  gfc_id: string | null;
  etabs_id: string | null;
  gfc_tx: number | null; gfc_ty: number | null;
  etabs_x: number | null; etabs_y: number | null;
  dist: number | null;
  matched: boolean;
  confidence: Confidence;
  ratio: number | null;
  mutual?: boolean;
  posdev?: boolean;
  pier?: string | null;
  wall_dist?: number | null;
}

export interface MatchOutput {
  refined: Affine;
  anisotropy: number;
  counts: Record<Confidence, number>;
  matchResult: MatchRow[];
}
