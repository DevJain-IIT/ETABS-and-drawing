'use client';
import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';
import { api } from '@/lib/api';
import { usePdfBitmap } from '@/lib/usePdfBitmap';
import type { Contract, MatchOutput, Affine } from '@/lib/engine/types';
import { deriveSeed, applyAffine } from '@/lib/engine/geometry';
import { runColumnMatch } from '@/lib/engine/match';
import { runBeamMatchV2 } from '@/lib/engine/beams';
import type { BeamMatchV2Output, EtabsBeamResult, DrawingBeamResult } from '@/lib/engine/beams';
import {
  renderGFC, renderETABS,
  newView, fitCloud, zoomAt,
  gfcToCanvas, etabsToCanvas, canvasToGfc, canvasToEtabs,
  type View,
} from '@/lib/engine/render';

const HEADER_H = 54;
const CW = 860, CH = 680;

// Beam status colours
const BEAM_CLR = {
  verified: '#0E9F6E',
  missing:  '#E11D48',
  extra:    '#E08A00',
};

// ---- Header ----------------------------------------------------------------
function Header({ projectName }: { projectName?: string }) {
  const steps = ['1 · Name', '2 · Floor', '3 · Map', '4 · Rosetta'];
  return (
    <header style={{
      height: HEADER_H, borderBottom: `1px solid ${T.border}`, background: T.panel,
      display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px', flexShrink: 0,
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
        <Link href="/projects" style={{ fontFamily: T.serif, fontSize: 18, color: T.ink, textDecoration: 'none', fontWeight: 700 }}>
          Column Rosetta Mapper
        </Link>
        {projectName && <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>· {projectName}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: T.mono, fontSize: 12 }}>
        {steps.map((l, i) => (
          <React.Fragment key={l}>
            <span style={{
              padding: '4px 12px', borderRadius: 999,
              background: i === 3 ? T.cyan : T.sand,
              color: i === 3 ? T.navy : T.muted,
              fontWeight: 600, whiteSpace: 'nowrap',
            }}>{l}</span>
            {i < 3 && <span style={{ color: T.subtle, fontSize: 10 }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    </header>
  );
}

// ---- Inspector panel -------------------------------------------------------
function InspectorPanel({
  colId, contract, match, beamMatch, beamOverrides, log, onBeamOverride,
}: {
  colId: string | null;
  contract: Contract | null;
  match: MatchOutput | null;
  beamMatch: BeamMatchV2Output | null;
  beamOverrides: Record<string, 'verified' | 'missing' | 'extra'>;
  log: string[];
  onBeamOverride: (beamKey: string, status: 'verified' | 'missing' | 'extra') => void;
}) {
  const logEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log.length]);

  const panelBase: React.CSSProperties = {
    position: 'fixed', right: 0, top: HEADER_H, bottom: 0, width: 320,
    background: T.navy, borderLeft: `1px solid ${T.borderD}`, zIndex: 50,
    display: 'flex', flexDirection: 'column',
  };

  const row2 = (label: string, val: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontFamily: T.mono }}>{label}</span>
      <span style={{ color: '#fff', fontSize: 12, fontFamily: T.mono, fontWeight: 600 }}>{val}</span>
    </div>
  );

  const logFooter = (
    <div style={{ borderTop: `1px solid ${T.borderD}`, flexShrink: 0 }}>
      <div style={{ padding: '8px 14px 4px', fontFamily: T.mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)' }}>
        ACTIVITY
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 160, padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {log.map((m, i) => (
          <div key={i} style={{ fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.5)' }}>
            <span style={{ color: T.cyan, marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>{m}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );

  if (!colId || !contract) {
    return (
      <div style={panelBase}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 24 }}>
          Click any column to inspect beams
        </div>
        {logFooter}
      </div>
    );
  }

  // Determine if clicked column is a GFC or ETABS column
  const isGfc = contract.gfc_cols.some((c) => c.id === colId);
  const isEtabs = contract.etabs_cols.some((c) => c.id === colId);

  // Resolve GFC ↔ ETABS pairing
  let gfcId: string | null = null;
  let etabsId: string | null = null;
  let cmark: string | null = null;

  if (isGfc) {
    gfcId = colId;
    const row = match?.matchResult.find((r) => r.gfc_id === colId);
    etabsId = row?.etabs_id ?? null;
  } else if (isEtabs) {
    etabsId = colId;
    const row = match?.matchResult.find((r) => r.etabs_id === colId);
    gfcId = row?.gfc_id ?? null;
  }
  if (gfcId) cmark = contract.gfc_cmark?.[gfcId] ?? null;

  const etabsCol = etabsId ? contract.etabs_cols.find((c) => c.id === etabsId) : null;

  // Beams for this ETABS column
  const colBeams = beamMatch
    ? beamMatch.etabsBeams.filter((b) => etabsId && (b.ea === etabsId || b.eb === etabsId))
    : [];

  const effectiveStatus = (b: EtabsBeamResult): 'verified' | 'missing' => {
    const key = `${b.ea}|${b.eb}`;
    return (beamOverrides[key] as 'verified' | 'missing' | undefined) ?? b.status;
  };

  const BeamHitlRow = ({ b }: { b: EtabsBeamResult }) => {
    const key = `${b.ea}|${b.eb}`;
    const status = effectiveStatus(b);
    const otherCol = etabsId === b.ea ? b.eb : b.ea;
    const overridden = !!beamOverrides[key];
    return (
      <div style={{
        borderRadius: 8, padding: '10px 12px', marginBottom: 8,
        background: status === 'verified' ? 'rgba(14,159,110,0.12)' : 'rgba(225,29,72,0.10)',
        border: `1px solid ${status === 'verified' ? 'rgba(14,159,110,0.3)' : 'rgba(225,29,72,0.3)'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: status === 'verified' ? '#0E9F6E' : '#E11D48', fontSize: 14, fontWeight: 700 }}>
            {status === 'verified' ? '✓' : '✕'}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: '#fff', fontWeight: 600 }}>
            {etabsId} ↔ {otherCol}
          </span>
          {overridden && (
            <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: '#94A3B8',
              background: 'rgba(148,163,184,0.12)', borderRadius: 4, padding: '1px 6px' }}>HITL</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onBeamOverride(key, 'verified')} style={{
            flex: 1, padding: '5px 0', borderRadius: 6, cursor: 'pointer', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
            background: status === 'verified' ? 'rgba(14,159,110,0.25)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${status === 'verified' ? 'rgba(14,159,110,0.5)' : 'rgba(255,255,255,0.12)'}`,
            color: status === 'verified' ? '#0E9F6E' : 'rgba(255,255,255,0.4)',
          }}>Mark present</button>
          <button onClick={() => onBeamOverride(key, 'missing')} style={{
            flex: 1, padding: '5px 0', borderRadius: 6, cursor: 'pointer', fontFamily: T.mono, fontSize: 11, fontWeight: 600,
            background: status === 'missing' ? 'rgba(225,29,72,0.20)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${status === 'missing' ? 'rgba(225,29,72,0.45)' : 'rgba(255,255,255,0.12)'}`,
            color: status === 'missing' ? '#F87171' : 'rgba(255,255,255,0.4)',
          }}>Mark missing</button>
        </div>
      </div>
    );
  };

  return (
    <div style={panelBase}>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Column identity header */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.borderD}` }}>
          <div style={{ fontFamily: T.serif, fontSize: 16, color: T.cyan, marginBottom: 2 }}>
            {cmark ?? gfcId ?? etabsId ?? colId}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
            {isGfc ? `Drawing: ${gfcId}` : `ETABS: ${etabsId}`}
          </div>
        </div>

        {/* Column pair info */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.borderD}` }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginBottom: 8 }}>
            COLUMN PAIRING
          </div>
          {row2('Drawing', gfcId ? <span style={{ color: '#22D3EE' }}>{gfcId}{cmark ? ` (${cmark})` : ''}</span> : <span style={{ color: '#E08A00' }}>unmatched</span>)}
          {row2('ETABS', etabsId ? <span style={{ color: '#22D3EE' }}>{etabsId}</span> : <span style={{ color: '#E08A00' }}>unmatched</span>)}
          {etabsCol && row2('Section', etabsCol.sec || '—')}
          {etabsCol && row2('B × D', `${etabsCol.B} × ${etabsCol.D} mm`)}
        </div>

        {/* Beams connected to this column */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>
            CONNECTED BEAMS {colBeams.length > 0 ? `(${colBeams.length})` : ''}
          </div>
          {!etabsId && (
            <div style={{ fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
              Column not matched to ETABS — no beam data available.
            </div>
          )}
          {etabsId && colBeams.length === 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
              No ETABS beams connect to this column.
            </div>
          )}
          {colBeams.map((b, i) => <BeamHitlRow key={i} b={b} />)}
        </div>
      </div>
      {logFooter}
    </div>
  );
}

// ---- Summary bar -----------------------------------------------------------
function SummaryBar({ counts, beamOverrides, etabsBeams }: {
  counts: BeamMatchV2Output['counts'];
  beamOverrides: Record<string, 'verified' | 'missing' | 'extra'>;
  etabsBeams: EtabsBeamResult[];
}) {
  const overrideCount = Object.keys(beamOverrides).length;
  // recompute effective counts with overrides
  const eff = { verified: 0, missing: 0 };
  for (const b of etabsBeams) {
    const key = `${b.ea}|${b.eb}`;
    const s = (beamOverrides[key] as 'verified' | 'missing' | undefined) ?? b.status;
    if (s === 'verified') eff.verified++; else eff.missing++;
  }
  const chip = (label: string, n: number, color: string, bg: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
      background: bg, borderRadius: 8, border: `1px solid ${color}22`,
    }}>
      <span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 700, color }}>{n}</span>
      <span style={{ fontFamily: T.sans, fontSize: 12, color, opacity: 0.85 }}>{label}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      {chip('Verified', eff.verified, '#047857', 'rgba(14,159,110,0.08)')}
      {chip('Missing in drawing', eff.missing, '#BE123C', 'rgba(225,29,72,0.07)')}
      {chip('Extra in drawing', counts.extra, '#B45309', 'rgba(224,138,0,0.07)')}
      {overrideCount > 0 && chip(`${overrideCount} HITL override${overrideCount > 1 ? 's' : ''}`, overrideCount, '#94A3B8', 'rgba(148,163,184,0.08)')}
    </div>
  );
}

// ---- Legend ----------------------------------------------------------------
function Legend() {
  const items: [string, string][] = [
    ['Verified beam', BEAM_CLR.verified],
    ['Missing beam', BEAM_CLR.missing],
    ['Extra in drawing', BEAM_CLR.extra],
  ];
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      {items.map(([label, color]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 3, background: color, borderRadius: 2 }} />
          <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.muted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Page ------------------------------------------------------------------
export default function RosettaPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [contract, setContract] = React.useState<Contract | null>(null);
  const [match, setMatch] = React.useState<MatchOutput | null>(null);
  const [affine, setAffine] = React.useState<Affine | null>(null);
  const [beamMatch, setBeamMatch] = React.useState<BeamMatchV2Output | null>(null);
  const [beamOverrides, setBeamOverrides] = React.useState<Record<string, 'verified' | 'missing' | 'extra'>>({});
  const [log, setLog] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [inspectedId, setInspectedId] = React.useState<string | null>(null);
  const [gfcScale, setGfcScale] = React.useState(1);
  const [etabsScale, setEtabsScale] = React.useState(1);

  const gfcRef  = React.useRef<HTMLCanvasElement>(null);
  const etabsRef = React.useRef<HTMLCanvasElement>(null);
  const gfcView  = React.useRef<View>(newView());
  const etabsView = React.useRef<View>(newView());
  const gfcDrag  = React.useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const etabsDrag = React.useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const addLog = React.useCallback((msg: string) => setLog((l) => [...l, msg]), []);

  const gfcBitmap = usePdfBitmap(
    contract ? api.getPdfUrl(projectId, 'gfc_pdf') : null,
    gfcScale,
  );

  // Load contract + run engine
  React.useEffect(() => {
    addLog('Loading contract…');
    api.getContract(projectId).then((c) => {
      setContract(c);
      addLog(`Loaded — ${c.gfc_cols.length} GFC cols, ${c.etabs_cols.length} ETABS cols, ${c.etabs_beams.length} ETABS beams`);

      addLog('Deriving alignment…');
      const seed = deriveSeed(c.gfc_cols, c.etabs_cols);
      setAffine(seed.seed);
      addLog(`Seed: ${seed.desc} — residual ${Math.round(seed.residual)} mm`);

      addLog('Running column match…');
      const m = runColumnMatch(seed.seed, { GFC_COLS: c.gfc_cols, ETABS_COLS: c.etabs_cols, ETABS_WALLS: c.etabs_walls });
      setMatch(m);
      addLog(`Columns: ${m.counts.HIGH} HIGH, ${m.counts.MED} MED, ${m.counts.LOW} LOW`);

      addLog('Running beam corridor check…');
      const bm = runBeamMatchV2(c, seed.seed, m);
      setBeamMatch(bm);
      addLog(`Beams: ${bm.counts.verified} verified, ${bm.counts.missing} missing, ${bm.counts.extra} extra`);
    }).catch((e) => { setErr(String(e)); addLog(`Error: ${String(e)}`); });
  }, [projectId, addLog]);

  // Fit views once contract is ready
  React.useEffect(() => {
    if (!contract) return;
    if (gfcBitmap) {
      const pts = contract.gfc_cols.map((c) => ({ x: c.cx, y: c.cy }));
      if (pts.length) {
        gfcView.current = fitCloud(pts, CW, CH, false);
        setGfcScale(gfcView.current.scale);
      }
    }
    const epts = contract.etabs_cols.map((c) => ({ x: c.x, y: c.y }));
    if (epts.length) {
      etabsView.current = fitCloud(epts, CW, CH, true);
      setEtabsScale(etabsView.current.scale);
    }
  }, [contract, gfcBitmap]);

  // Draw function
  const draw = React.useCallback(() => {
    if (!contract) return;
    const g = gfcRef.current?.getContext('2d');
    const e = etabsRef.current?.getContext('2d');
    const gv = gfcView.current, ev = etabsView.current;

    // --- GFC canvas ---
    if (g) {
      g.clearRect(0, 0, CW, CH);
      // PDF background
      if (gfcBitmap) {
        g.save();
        g.globalAlpha = 0.85;
        g.drawImage(gfcBitmap.bitmap, 0, 0, gfcBitmap.bitmap.width, gfcBitmap.bitmap.height,
          gv.ox, gv.oy, gfcBitmap.pageW * gv.scale, gfcBitmap.pageH * gv.scale);
        g.restore();
      }
      // Beam lines from beamMatch GFC coords (gx1/gy1/gx2/gy2 are already in GFC space)
      if (beamMatch) {
        for (const b of beamMatch.etabsBeams) {
          const key = `${b.ea}|${b.eb}`;
          const status = (beamOverrides[key] as 'verified' | 'missing' | undefined) ?? b.status;
          const p1 = gfcToCanvas(gv, b.gx1, b.gy1), p2 = gfcToCanvas(gv, b.gx2, b.gy2);
          g.strokeStyle = BEAM_CLR[status] ?? BEAM_CLR.verified;
          g.lineWidth = Math.max(1.5, gv.scale * 0.5);
          g.globalAlpha = status === 'verified' ? 0.5 : 0.85;
          g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
          g.globalAlpha = 1;
        }
        // Extra drawing beams — amber (midpoint-to-midpoint between GFC cols)
        const gfcById = new Map(contract.gfc_cols.map((c) => [c.id, c]));
        for (const b of beamMatch.drawingBeams) {
          if (b.status !== 'extra') continue;
          const db = contract.drawing_beams.find((d) => d.id === b.drawing_id);
          if (!db) continue;
          const ca = gfcById.get(db.a), cb = gfcById.get(db.b);
          if (!ca || !cb) continue;
          const p1 = gfcToCanvas(gv, ca.cx, ca.cy), p2 = gfcToCanvas(gv, cb.cx, cb.cy);
          g.strokeStyle = BEAM_CLR.extra;
          g.lineWidth = Math.max(1.5, gv.scale * 0.5);
          g.setLineDash([6, 4]);
          g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
          g.setLineDash([]);
        }
      }
      // GFC column dots (same renderGFC style)
      renderGFC(g, gv, contract, match, CW, CH, {
        selected: inspectedId ?? undefined, cmarks: contract.gfc_cmark ?? {},
      });
    }

    // --- ETABS canvas ---
    if (e) {
      renderETABS(e, ev, contract, match, CW, CH, {
        selected: inspectedId ?? undefined, affine: affine ?? undefined,
      });
      // Overlay beam lines in ETABS space
      if (beamMatch) {
        const ecById = new Map(contract.etabs_cols.map((c) => [c.id, c]));
        for (const b of beamMatch.etabsBeams) {
          const key = `${b.ea}|${b.eb}`;
          const status = (beamOverrides[key] as 'verified' | 'missing' | undefined) ?? b.status;
          const ca = ecById.get(b.ea), cb = ecById.get(b.eb);
          if (!ca || !cb) continue;
          const p1 = etabsToCanvas(ev, ca.x, ca.y), p2 = etabsToCanvas(ev, cb.x, cb.y);
          e.strokeStyle = BEAM_CLR[status] ?? BEAM_CLR.verified;
          e.lineWidth = Math.max(1.5, ev.scale * 0.004);
          e.globalAlpha = status === 'verified' ? 0.4 : 0.9;
          e.beginPath(); e.moveTo(p1.x, p1.y); e.lineTo(p2.x, p2.y); e.stroke();
          e.globalAlpha = 1;
        }
      }
    }
  }, [contract, match, affine, beamMatch, beamOverrides, inspectedId, gfcBitmap]);

  React.useEffect(() => { draw(); });

  // ---- Wheel zoom (native, non-passive) ----
  React.useEffect(() => {
    const bind = (cv: HTMLCanvasElement | null, vRef: React.MutableRefObject<View>, isGfc: boolean) => {
      if (!cv) return () => {};
      const h = (ev: WheelEvent) => {
        ev.preventDefault();
        const r = cv.getBoundingClientRect();
        zoomAt(vRef.current, ev.clientX - r.left, ev.clientY - r.top, ev.deltaY);
        if (isGfc) setGfcScale(vRef.current.scale);
        else setEtabsScale(vRef.current.scale);
      };
      cv.addEventListener('wheel', h, { passive: false });
      return () => cv.removeEventListener('wheel', h);
    };
    const ug = bind(gfcRef.current, gfcView, true);
    const ue = bind(etabsRef.current, etabsView, false);
    return () => { ug(); ue(); };
  }, []);

  // ---- Mouse drag (pan) + click (select) ----
  const onGfcMouseDown = (ev: React.MouseEvent) => {
    const r = gfcRef.current!.getBoundingClientRect();
    gfcDrag.current = { sx: ev.clientX - r.left, sy: ev.clientY - r.top, ox: gfcView.current.ox, oy: gfcView.current.oy };
  };
  const onGfcMouseMove = (ev: React.MouseEvent) => {
    if (!gfcDrag.current) return;
    const r = gfcRef.current!.getBoundingClientRect();
    gfcView.current.ox = gfcDrag.current.ox + (ev.clientX - r.left) - gfcDrag.current.sx;
    gfcView.current.oy = gfcDrag.current.oy + (ev.clientY - r.top) - gfcDrag.current.sy;
    setGfcScale(gfcView.current.scale);
  };
  const onGfcMouseUp = (ev: React.MouseEvent) => {
    const d = gfcDrag.current; gfcDrag.current = null;
    if (!d || !contract) return;
    const r = gfcRef.current!.getBoundingClientRect();
    const dx = (ev.clientX - r.left) - d.sx, dy = (ev.clientY - r.top) - d.sy;
    if (Math.hypot(dx, dy) > 4) return; // drag, not click
    const pt = canvasToGfc(gfcView.current, ev.clientX - r.left, ev.clientY - r.top);
    let best: string | null = null, bd = 20 / gfcView.current.scale;
    for (const c of contract.gfc_cols) {
      const dist = Math.hypot(c.cx - pt.x, c.cy - pt.y);
      if (dist < bd) { bd = dist; best = c.id; }
    }
    setInspectedId(best);
  };

  const onEtabsMouseDown = (ev: React.MouseEvent) => {
    const r = etabsRef.current!.getBoundingClientRect();
    etabsDrag.current = { sx: ev.clientX - r.left, sy: ev.clientY - r.top, ox: etabsView.current.ox, oy: etabsView.current.oy };
  };
  const onEtabsMouseMove = (ev: React.MouseEvent) => {
    if (!etabsDrag.current) return;
    const r = etabsRef.current!.getBoundingClientRect();
    etabsView.current.ox = etabsDrag.current.ox + (ev.clientX - r.left) - etabsDrag.current.sx;
    etabsView.current.oy = etabsDrag.current.oy + (ev.clientY - r.top) - etabsDrag.current.sy;
    setEtabsScale(etabsView.current.scale);
  };
  const onEtabsMouseUp = (ev: React.MouseEvent) => {
    const d = etabsDrag.current; etabsDrag.current = null;
    if (!d || !contract) return;
    const r = etabsRef.current!.getBoundingClientRect();
    const dx = (ev.clientX - r.left) - d.sx, dy = (ev.clientY - r.top) - d.sy;
    if (Math.hypot(dx, dy) > 4) return;
    const pt = canvasToEtabs(etabsView.current, ev.clientX - r.left, ev.clientY - r.top);
    // snap to nearest ETABS column
    let best: string | null = null, bd = 40 / etabsView.current.scale;
    for (const c of contract.etabs_cols) {
      const dist = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (dist < bd) { bd = dist; best = c.id; }
    }
    // Also sync: if ETABS col clicked, cross-highlight its matching GFC col
    if (best) {
      const gfcRow = match?.matchResult.find((r) => r.etabs_id === best);
      setInspectedId(gfcRow?.gfc_id ?? best);
    } else {
      setInspectedId(null);
    }
  };

  // HITL beam override
  const onBeamOverride = (key: string, status: 'verified' | 'missing' | 'extra') => {
    setBeamOverrides((prev) => ({ ...prev, [key]: status }));
    addLog(`HITL: beam ${key} → ${status}`);
    api.saveResults(projectId, { step: 'beam_overrides', overrides: { ...beamOverrides, [key]: status } }).catch(() => {});
  };

  if (err) return (
    <>
      <Header />
      <div style={{ marginTop: HEADER_H, marginRight: 320, padding: 40 }}>
        <div style={{ fontFamily: T.mono, color: '#E11D48' }}>{err}</div>
      </div>
      <InspectorPanel colId={null} contract={null} match={null} beamMatch={null}
        beamOverrides={{}} log={log} onBeamOverride={onBeamOverride} />
    </>
  );

  if (!beamMatch || !contract) return (
    <>
      <Header projectName={contract?.project_name} />
      <div style={{ marginTop: HEADER_H, marginRight: 320, padding: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: T.muted, fontFamily: T.mono, fontSize: 13 }}>
          <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 999, border: `2px solid ${T.cyan}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          Running beam verification…
        </div>
      </div>
      <InspectorPanel colId={null} contract={null} match={null} beamMatch={null}
        beamOverrides={{}} log={log} onBeamOverride={onBeamOverride} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );

  return (
    <>
      <Header projectName={contract.project_name} />
      <div style={{
        marginTop: HEADER_H, marginRight: 320,
        minHeight: `calc(100vh - ${HEADER_H}px)`,
        background: T.paper, display: 'flex', flexDirection: 'column',
      }}>

        {/* Summary + Legend bar */}
        <div style={{ padding: '14px 20px 0', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          <SummaryBar counts={beamMatch.counts} beamOverrides={beamOverrides} etabsBeams={beamMatch.etabsBeams} />
          <Legend />
        </div>

        {/* Dual canvas row */}
        <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden' }}>
          {/* GFC pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.border}` }}>
            <div style={{ padding: '6px 12px', background: T.panel, borderBottom: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.muted, display: 'flex', justifyContent: 'space-between' }}>
              <span>Ground floor arrangement</span>
              <span style={{ fontFamily: T.mono, fontSize: 11 }}>scroll = zoom · drag = pan</span>
            </div>
            <canvas ref={gfcRef} width={CW} height={CH} style={{ width: '100%', cursor: 'crosshair', display: 'block' }}
              onMouseDown={onGfcMouseDown} onMouseMove={onGfcMouseMove} onMouseUp={onGfcMouseUp} onMouseLeave={() => { gfcDrag.current = null; }} />
          </div>

          {/* ETABS pane */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 12px', background: T.panel, borderBottom: `1px solid ${T.border}`,
              fontFamily: T.sans, fontSize: 12, color: T.muted, display: 'flex', justifyContent: 'space-between' }}>
              <span>ETABS model</span>
              <span style={{ fontFamily: T.mono, fontSize: 11 }}>{contract.etabs_cols.length} columns · {contract.etabs_beams.length} beams</span>
            </div>
            <canvas ref={etabsRef} width={CW} height={CH} style={{ width: '100%', cursor: 'crosshair', display: 'block' }}
              onMouseDown={onEtabsMouseDown} onMouseMove={onEtabsMouseMove} onMouseUp={onEtabsMouseUp} onMouseLeave={() => { etabsDrag.current = null; }} />
          </div>
        </div>

      </div>

      <InspectorPanel
        colId={inspectedId}
        contract={contract}
        match={match}
        beamMatch={beamMatch}
        beamOverrides={beamOverrides}
        log={log}
        onBeamOverride={onBeamOverride}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
