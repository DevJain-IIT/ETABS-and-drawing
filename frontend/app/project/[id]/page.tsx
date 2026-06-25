'use client';

import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';
import type { Contract, GfcCol, MatchOutput, Affine } from '@/lib/engine/types';
import { runColumnMatch, solveAffine, icpRefine, linAnisotropy } from '@/lib/engine';
import { runBeamMatch, type BeamMatchOutput } from '@/lib/engine/beams';
import {
  renderGFC, renderETABS, TIER_COLORS, newView, fitCloud, zoomAt,
  canvasToGfc, canvasToEtabs, type View,
} from '@/lib/engine/render';
import { api } from '@/lib/api';
import { usePdfBitmap } from '@/lib/usePdfBitmap';

const CW = 900, CH = 720;          // canvas pixel size (high-res for sharp PDF rendering)
type CalibPt = { px: number; py: number; id: string | null };

export default function MapperPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [contract, setContract] = React.useState<Contract | null>(null);
  const [match, setMatch] = React.useState<MatchOutput | null>(null);
  const [beamMatch, setBeamMatch] = React.useState<BeamMatchOutput | null>(null);
  const [affine, setAffine] = React.useState<Affine | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showBeams, setShowBeams] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  // calibration (Registration B): 3 GFC control points + 3 ETABS matches
  const [gfcPts, setGfcPts] = React.useState<CalibPt[]>([]);
  const [etabsPts, setEtabsPts] = React.useState<CalibPt[]>([]);
  const calibMode: 'gfc' | 'etabs' | 'ready' | 'done' =
    affine ? 'done' : gfcPts.length < 3 ? 'gfc' : etabsPts.length < 3 ? 'etabs' : 'ready';

  // Inspector: clicked element properties panel (ETABS or GFC side)
  const [inspectedId, setInspectedId] = React.useState<string | null>(null);
  const [inspectedSide, setInspectedSide] = React.useState<'gfc' | 'etabs'>('etabs');

  // PDF background opacity slider
  const [floorAlpha, setFloorAlpha] = React.useState(0.9);

  // dev narration log (removable before production)
  const [log, setLog] = React.useState<string[]>([]);
  const say = React.useCallback((m: string) => setLog((L) => [...L, m]), []);

  const gfcRef = React.useRef<HTMLCanvasElement>(null);
  const etabsRef = React.useRef<HTMLCanvasElement>(null);
  const gfcView = React.useRef<View>(newView());
  const etabsView = React.useRef<View>(newView());
  const drag = React.useRef<{ which: 'gfc' | 'etabs'; x: number; y: number; moved: number } | null>(null);
  const [, forceDraw] = React.useReducer((x) => x + 1, 0);
  // Track GFC view scale as state so PDF re-renders when zoom level changes significantly
  const [gfcScale, setGfcScale] = React.useState(1);

  // load contract
  React.useEffect(() => {
    api.getContract(projectId).then((c) => {
      setContract(c);
      say(`Loaded project: ${c.gfc_cols.length} drawing columns, ${c.etabs_cols.length} model columns, ${c.etabs_walls.length} walls, ${c.drawing_beams.length} drawing beams.`);
      say('Step 1 of 3 — Map: scroll to zoom, drag to pan. Click 3 control points on the GFC drawing (left).');
    }).catch(() => setErr(`Could not load project ${projectId}.`));
  }, [projectId, say]);

  // PDF background: re-rendered at the current zoom scale so text is always crisp
  const pdfUrl = contract ? api.getPdfUrl(projectId, 'gfc_pdf') : null;
  const pdfBitmap = usePdfBitmap(pdfUrl, gfcScale);

  // initial fit once contract is in
  React.useEffect(() => {
    if (!contract) return;
    gfcView.current = fitCloud(contract.gfc_cols.map((c) => ({ x: c.cx, y: c.cy })), CW, CH, false);
    const ePts = contract.etabs_cols.map((c) => ({ x: c.x, y: c.y }));
    etabsView.current = fitCloud(ePts, CW, CH, true);
    setGfcScale(gfcView.current.scale);
    forceDraw();
  }, [contract]);

  // redraw on any relevant change
  const draw = React.useCallback(() => {
    if (!contract) return;
    const g = gfcRef.current, e = etabsRef.current;
    const bm = showBeams ? beamMatch : null;
    const v = gfcView.current;
    const cmarks = contract.gfc_cmark ?? {};
    if (g) {
      const ctx = g.getContext('2d')!;
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH);

      // PDF background: stamp the pre-rendered PDF bitmap, aligned to the current view transform.
      // The bitmap covers the full PDF page (pageW × pageH pts); v maps pts → canvas px.
      if (pdfBitmap && floorAlpha > 0) {
        const { bitmap, pageW, pageH } = pdfBitmap;
        ctx.save();
        ctx.globalAlpha = floorAlpha;
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height,
          v.ox, v.oy, pageW * v.scale, pageH * v.scale);
        ctx.restore();
      }

      // GFC columns as green outlined boxes with names
      for (const c of contract.gfc_cols) {
        const p = { x: c.cx * v.scale + v.ox, y: c.cy * v.scale + v.oy };
        const hw = Math.max(4, (c.rw / 2) * v.scale);
        const hh = Math.max(4, (c.rh / 2) * v.scale);
        const isSel = c.id === selected;
        ctx.strokeStyle = isSel ? '#0f7b45' : '#16a34a';
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.fillStyle = isSel ? 'rgba(22,163,74,0.25)' : 'rgba(22,163,74,0.08)';
        ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
        ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
        // Column name label
        const nm = cmarks[c.id];
        if (nm) {
          const fs = Math.max(8, v.scale * 8);
          ctx.font = `bold ${fs}px monospace`;
          ctx.fillStyle = isSel ? '#0f7b45' : '#16a34a';
          ctx.globalAlpha = isSel ? 1 : 0.75;
          ctx.fillText(nm, p.x + hw + 2, p.y + fs * 0.35);
          ctx.globalAlpha = 1;
        }
      }
      // Calibration control points on top (skip clear + skip columns — we drew our own above)
      renderGFC(ctx, v, contract, match, CW, CH,
        { selected, beamMatch: bm, calibPts: gfcPts, cmarks: {}, skipClear: true, skipColumns: true });
    }
    if (e) renderETABS(e.getContext('2d')!, etabsView.current, contract, match, CW, CH,
      { selected, beamMatch: bm, affine, calibPts: etabsPts,
        ghosts: affine ? contract.gfc_cols : undefined });
  }, [contract, match, beamMatch, showBeams, selected, gfcPts, etabsPts, affine, pdfBitmap, floorAlpha]);
  React.useEffect(() => { draw(); });

  // ---- Apply calibration: 3-pt affine seed -> ICP refine ----
  const applyCalibration = () => {
    if (!contract || gfcPts.length < 3 || etabsPts.length < 3) return;
    const seed = solveAffine(gfcPts.map((p) => ({ x: p.px, y: p.py })), etabsPts.map((p) => ({ x: p.px, y: p.py })));
    say(`3-point seed solved. Refining with ICP (snaps every drawing column to its nearest model column, 10 passes)…`);
    const refined = icpRefine(seed, contract.gfc_cols, contract.etabs_cols);
    const an = linAnisotropy(refined);
    setAffine(refined);
    say(`Aligned. Anisotropy ${an.toFixed(3)} (1.0 = clean similarity, no skew). Blue dots = drawing columns projected onto the model — they should land on model columns.`);
    say('Step 3 — click “Refine & match” to run the matching engine.');
  };

  const runMatch = () => {
    if (!contract || !affine) return;
    const out = runColumnMatch(affine, {
      GFC_COLS: contract.gfc_cols, ETABS_COLS: contract.etabs_cols, ETABS_WALLS: contract.etabs_walls,
    }, 1e9, affine);   // pass the calibrated affine so the engine uses it (no re-seed)
    setMatch(out);
    const bm = runBeamMatch(contract, out, affine);
    setBeamMatch(bm);
    say(`Engine matched columns: ${out.counts.HIGH} high, ${out.counts.MED} med, ${out.counts.LOW} review, ${out.counts.WALL} reclassified-as-wall, ${out.counts.UNMATCHED_ETABS} modeled-not-drawn.`);
    say(`Beams: ${bm.counts.matched} topological + ${bm.counts.pos_match} positional = ${bm.counts.matched + bm.counts.pos_match} matched, ${bm.counts.drawing_only} drawn-not-modeled, ${bm.counts.etabs_only} modeled-not-drawn.`);
  };

  const resetCalib = () => {
    setGfcPts([]); setEtabsPts([]); setAffine(null); setMatch(null); setBeamMatch(null);
    setSelected(null); setInspectedId(null); setInspectedSide('etabs');
    say('Calibration reset. Click 3 control points on the GFC drawing again.');
  };

  // ---- canvas pointer handlers (zoom / pan / pick) ----
  // Wheel zoom uses NATIVE non-passive listeners (React onWheel is passive, so
  // preventDefault there throws and the page scrolls instead of the pane zooming).
  React.useEffect(() => {
    const bind = (cv: HTMLCanvasElement | null, v: React.MutableRefObject<View>, isGfc: boolean) => {
      if (!cv) return () => {};
      const h = (ev: WheelEvent) => {
        ev.preventDefault();
        const r = cv.getBoundingClientRect();
        const cx = ((ev.clientX - r.left) / r.width) * CW, cy = ((ev.clientY - r.top) / r.height) * CH;
        zoomAt(v.current, cx, cy, ev.deltaY);
        forceDraw();
        if (isGfc) setGfcScale(v.current.scale);
      };
      cv.addEventListener('wheel', h, { passive: false });
      return () => cv.removeEventListener('wheel', h);
    };
    const ug = bind(gfcRef.current, gfcView, true), ue = bind(etabsRef.current, etabsView, false);
    return () => { ug(); ue(); };
  }, [contract]);
  const toCanvas = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return { cx: ((ev.clientX - r.left) / r.width) * CW, cy: ((ev.clientY - r.top) / r.height) * CH };
  };
  const onDown = (which: 'gfc' | 'etabs') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy } = toCanvas(ev); drag.current = { which, x: cx, y: cy, moved: 0 };
  };
  const onMove = (which: 'gfc' | 'etabs') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag.current || drag.current.which !== which) return;
    const { cx, cy } = toCanvas(ev);
    const v = which === 'gfc' ? gfcView.current : etabsView.current;
    v.ox += cx - drag.current.x; v.oy += cy - drag.current.y;
    drag.current.moved += Math.abs(cx - drag.current.x) + Math.abs(cy - drag.current.y);
    drag.current.x = cx; drag.current.y = cy; forceDraw();
  };
  const onUp = (which: 'gfc' | 'etabs') => (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const d = drag.current; drag.current = null;
    if (!contract || !d || d.moved > 4) return;   // a drag, not a click
    const { cx, cy } = toCanvas(ev);
    if (which === 'gfc') {
      const w = canvasToGfc(gfcView.current, cx, cy);
      const near = nearest(contract.gfc_cols.map((c) => ({ id: c.id, x: c.cx, y: c.cy })), w);
      if (calibMode === 'gfc') {
        const snap = near && dist(near, w) < 30 / gfcView.current.scale ? { px: near.x, py: near.y, id: near.id } : { px: w.x, py: w.y, id: null };
        const next = [...gfcPts, snap]; setGfcPts(next);
        say(`GFC control point ${next.length}/3 placed${snap.id ? ` on ${snap.id}` : ''}.`);
        if (next.length === 3) say('Now click the 3 MATCHING columns on the ETABS model (right), in the same order.');
      } else {
        const snapId = near && dist(near, w) < 30 / gfcView.current.scale ? near.id : null;
        setSelected(snapId);
        setInspectedId(snapId);
        setInspectedSide('gfc');
      }
    } else {
      const w = canvasToEtabs(etabsView.current, cx, cy);
      const near = nearest(contract.etabs_cols.map((c) => ({ id: c.id, x: c.x, y: c.y })), w);
      if (calibMode === 'etabs') {
        const snap = near && dist(near, w) < 30 / etabsView.current.scale ? { px: near.x, py: near.y, id: near.id } : { px: w.x, py: w.y, id: null };
        const next = [...etabsPts, snap]; setEtabsPts(next);
        say(`ETABS control point ${next.length}/3 placed${snap.id ? ` on ${snap.id}` : ''}.`);
        if (next.length === 3) say('3 pairs set — click “Apply alignment” to compute the transform.');
      } else {
        // Select + open inspector for the nearest ETABS column
        const snapId = near && dist(near, w) < 40 / etabsView.current.scale ? near.id : null;
        setSelected(snapId);
        setInspectedId(snapId);
        setInspectedSide('etabs');
      }
    }
  };

  if (!contract && !err) return <Center>Loading project…</Center>;

  return (
    <div style={{ minHeight: '100vh', background: T.paper, color: T.ink, fontFamily: T.sans }}>
      <Header projectName={contract?.project_name} />
      <div style={{ maxWidth: 1340, margin: '0 auto', padding: `18px 340px 60px 24px` }}>
        {err && <Banner text={err} />}

        <Toolbar
          calibMode={calibMode} hasMatch={!!match}
          onApply={applyCalibration} onMatch={runMatch} onReset={resetCalib}
          counts={match?.counts}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
          <Pane title="Ground floor arrangement" subtitle={`${contract?.gfc_cols.length ?? 0} columns · scroll = zoom · drag = pan`}
            hint={calibMode === 'gfc' ? `Click control point ${gfcPts.length + 1} of 3` : undefined}
            alphaControl={pdfBitmap ? { value: floorAlpha, onChange: setFloorAlpha } : undefined}>
            <canvas ref={gfcRef} width={CW} height={CH} style={canvasStyle}
              onMouseDown={onDown('gfc')} onMouseMove={onMove('gfc')}
              onMouseUp={onUp('gfc')} onMouseLeave={() => { drag.current = null; }} />
          </Pane>
          <Pane title="ETABS model" subtitle={`${contract?.etabs_cols.length ?? 0} columns · ${contract?.etabs_walls.length ?? 0} walls`}
            hint={calibMode === 'etabs' ? `Click matching column ${etabsPts.length + 1} of 3` : undefined}>
            <canvas ref={etabsRef} width={CW} height={CH} style={canvasStyle}
              onMouseDown={onDown('etabs')} onMouseMove={onMove('etabs')}
              onMouseUp={onUp('etabs')} onMouseLeave={() => { drag.current = null; }} />
          </Pane>
        </div>

        <Legend />
        {beamMatch && <BeamStats bm={beamMatch} showBeams={showBeams} onToggle={() => { setShowBeams((s) => !s); }} />}
        {match && <ReviewQueue match={match} selected={selected} onSelect={(id) => { setSelected(id); setInspectedId(id); setInspectedSide('etabs'); }} />}

      </div>

      {contract && (
        <InspectorPanel
          colId={inspectedId}
          side={inspectedSide}
          contract={contract}
          match={match}
          log={log}
        />
      )}
    </div>
  );
}

// ---------- helpers ----------
function dist(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
function nearest<P extends { id: string; x: number; y: number }>(arr: P[], w: { x: number; y: number }): P | null {
  let best: P | null = null, bd = Infinity;
  for (const p of arr) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bd) { bd = d; best = p; } }
  return best;
}

const canvasStyle: React.CSSProperties = {
  width: '100%', height: 'auto', aspectRatio: `${CW} / ${CH}`,
  background: '#fff', borderRadius: 10, border: `1px solid ${T.border}`, cursor: 'crosshair', touchAction: 'none',
};

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: T.paper, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontFamily: T.serif, fontSize: 18, color: T.ink }}>
      {children}
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

const HEADER_H = 54;

function Header({ projectName }: { projectName?: string }) {
  const steps = ['1 · Name', '2 · Floor', '3 · Map', '4 · Rosetta'];
  return (
    <header style={{ height: HEADER_H, borderBottom: `1px solid ${T.border}`, background: T.panel,
      display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
        <Link href="/projects" style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, textDecoration: 'none' }}>
          Column Rosetta Mapper
        </Link>
        {projectName && (
          <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.subtle }}>· {projectName}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: T.mono, fontSize: 12 }}>
        {steps.map((l, i) => (
          <React.Fragment key={l}>
            <span style={{ padding: '4px 12px', borderRadius: 999,
              background: i === 2 ? T.cyan : T.sand,
              color: i === 2 ? T.navy : T.muted,
              fontWeight: 600, whiteSpace: 'nowrap' }}>{l}</span>
            {i < 3 && <span style={{ color: T.subtle, fontSize: 10 }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    </header>
  );
}

function Toolbar({ calibMode, hasMatch, onApply, onMatch, onReset, counts }: {
  calibMode: string; hasMatch: boolean; onApply: () => void; onMatch: () => void; onReset: () => void;
  counts?: Record<string, number>;
}) {
  const btn = (label: string, on: () => void, enabled: boolean, primary = false): React.ReactNode => (
    <button onClick={on} disabled={!enabled} style={{ padding: '10px 18px', borderRadius: 10, border: primary ? 'none' : `1px solid ${T.border}`,
      background: !enabled ? T.sand : primary ? T.ink : T.panel, color: !enabled ? T.muted : primary ? T.textD : T.ink,
      fontWeight: 600, fontSize: 14, cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: T.sans }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {btn(`Apply alignment${calibMode === 'ready' ? ' (3/3)' : ''}`, onApply, calibMode === 'ready', true)}
      {btn('Refine & match', onMatch, calibMode === 'done')}
      {btn('Reset calibration', onReset, calibMode !== 'gfc' || hasMatch)}
      {counts && (
        <div style={{ display: 'flex', gap: 16, fontFamily: T.mono, fontSize: 12.5, color: T.muted, marginLeft: 6 }}>
          <Stat label="high" v={counts.HIGH} color={TIER_COLORS.HIGH} />
          <Stat label="med" v={counts.MED} color={TIER_COLORS.MED} />
          <Stat label="review" v={counts.LOW} color={TIER_COLORS.LOW} />
          <Stat label="walls" v={counts.WALL} color={TIER_COLORS.WALL} />
          <Stat label="not-drawn" v={counts.UNMATCHED_ETABS} color={TIER_COLORS.UNMATCHED_ETABS} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, v, color }: { label: string; v: number; color: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} /><b style={{ color: T.ink }}>{v ?? 0}</b> {label}
  </span>;
}

function Pane({ title, subtitle, hint, alphaControl, children }: {
  title: string; subtitle: string; hint?: string;
  alphaControl?: { value: number; onChange: (v: number) => void };
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: T.serif, fontSize: 16 }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {alphaControl && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: T.mono, fontSize: 11, color: T.subtle }}>
              PDF
              <input type="range" min={0} max={1} step={0.05} value={alphaControl.value}
                onChange={(e) => alphaControl.onChange(parseFloat(e.target.value))}
                style={{ width: 72, accentColor: T.cyan, cursor: 'pointer' }} />
              {Math.round(alphaControl.value * 100)}%
            </label>
          )}
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle }}>{subtitle}</span>
        </div>
      </div>
      {hint && <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: `${T.cyan}1a`,
        border: `1px solid ${T.cyan}55`, fontFamily: T.mono, fontSize: 11.5, color: T.cyanDeep }}>{hint}</div>}
      {children}
    </div>
  );
}

function Legend() {
  const colItems = [['HIGH', TIER_COLORS.HIGH], ['MED', TIER_COLORS.MED], ['LOW / review', TIER_COLORS.LOW],
    ['wall', TIER_COLORS.WALL], ['modeled-not-drawn', TIER_COLORS.UNMATCHED_ETABS]] as const;
  const beamItems: [string, string][] = [
    ['beam matched', '#0E9F6E'], ['beam corridor', '#06B6D4'],
    ['beam flaw', '#E11D48'], ['no-col', 'rgba(100,116,139,0.6)'],
  ];
  return (
    <div style={{ display: 'flex', gap: 18, marginTop: 12, fontFamily: T.mono, fontSize: 11.5, color: T.muted, flexWrap: 'wrap' }}>
      {colItems.map(([l, c]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 11, height: 11, borderRadius: 2, background: c }} /> {l}</span>)}
      <span style={{ color: T.border }}>·</span>
      {beamItems.map(([l, c]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 18, height: 3, borderRadius: 2, background: c }} /> {l}</span>)}
    </div>
  );
}

function BeamStats({ bm, showBeams, onToggle }: { bm: BeamMatchOutput; showBeams: boolean; onToggle: () => void }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
    <button onClick={onToggle} style={{ padding: '6px 12px', borderRadius: 8, fontFamily: T.mono, fontSize: 12,
      cursor: 'pointer', border: `1px solid ${T.border}`, background: showBeams ? T.cyan : T.panel, color: showBeams ? T.navy : T.muted }}>
      {showBeams ? 'hide beams' : 'show beams'}</button>
    <span style={{ fontFamily: T.mono, fontSize: 12.5, color: T.muted, display: 'flex', gap: 16 }}>
      <span><span style={{ color: '#0E9F6E' }}>■</span> <b style={{ color: T.ink }}>{bm.counts.matched}</b> matched</span>
      {bm.counts.pos_match > 0 && (
        <span><span style={{ color: '#06B6D4' }}>■</span> <b style={{ color: T.ink }}>{bm.counts.pos_match}</b> corridor match</span>
      )}
      <span><span style={{ color: '#E11D48' }}>■</span> <b style={{ color: T.ink }}>{bm.counts.drawing_only}</b> drawn-not-modeled</span>
      <span><span style={{ color: '#E08A00' }}>■</span> <b style={{ color: T.ink }}>{bm.counts.etabs_only}</b> modeled-not-drawn</span>
    </span>
  </div>;
}

function ReviewQueue({ match, selected, onSelect }: { match: MatchOutput; selected: string | null; onSelect: (id: string) => void }) {
  const queue = match.matchResult.filter((m) => m.confidence === 'LOW' || m.confidence === 'WALL' || m.confidence === 'UNMATCHED_ETABS');
  return <div style={{ marginTop: 24 }}>
    <div style={{ fontFamily: T.serif, fontSize: 18, marginBottom: 12 }}>Review queue <span style={{ fontFamily: T.mono, fontSize: 13, color: T.muted }}>({queue.length})</span></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {queue.map((m, i) => {
        const color = (TIER_COLORS as Record<string, string>)[m.confidence] || T.muted;
        const label = m.confidence === 'WALL' ? 'Reclassified as wall' : m.confidence === 'UNMATCHED_ETABS' ? 'Modeled, not drawn' : 'Needs review';
        return <button key={i} onClick={() => m.gfc_id && onSelect(m.gfc_id)} style={{ textAlign: 'left', background: T.panel,
          borderTop: `1px solid ${selected === m.gfc_id ? color : T.border}`, borderRight: `1px solid ${selected === m.gfc_id ? color : T.border}`,
          borderBottom: `1px solid ${selected === m.gfc_id ? color : T.border}`, borderLeft: `3px solid ${color}`,
          borderRadius: 10, padding: '11px 13px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 600 }}>{m.gfc_id || '—'}{m.etabs_id ? ` ↔ ${m.etabs_id}` : ''}</span>
            <span style={{ fontFamily: T.mono, fontSize: 11, color }}>{m.confidence}</span>
          </div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 5 }}>{label}{m.pier ? ` · on ${m.pier}` : ''}{m.dist != null ? ` · ${m.dist}mm` : ''}</div>
        </button>;
      })}
    </div>
  </div>;
}


function InspectorPanel({ colId, side, contract, match, log }: {
  colId: string | null;
  side: 'gfc' | 'etabs';
  contract: Contract;
  match: MatchOutput | null;
  log: string[];
}) {
  const logEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);
  const CONF_COLOR: Record<string, string> = {
    HIGH: '#22D3EE', MED: '#0E7490', LOW: '#94A3B8', WALL: '#A855F7', UNMATCHED_ETABS: '#E08A00',
  };
  const row2 = (label: string, val: React.ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0',
      borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontFamily: T.mono }}>{label}</span>
      <span style={{ color: '#fff', fontSize: 12.5, fontFamily: T.mono, fontWeight: 600 }}>{val}</span>
    </div>
  );

  const panelBase: React.CSSProperties = {
    position: 'fixed', right: 0, top: HEADER_H, bottom: 0, width: 316,
    background: T.navy, borderLeft: `1px solid ${T.borderD}`, zIndex: 50,
    display: 'flex', flexDirection: 'column',
  };

  // Shared log footer — always visible at the bottom of the panel
  const logFooter = (
    <div style={{ borderTop: `1px solid ${T.borderD}`, flexShrink: 0 }}>
      <div style={{ padding: '8px 14px 4px', fontFamily: T.mono, fontSize: 10,
        letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)' }}>ACTIVITY</div>
      <div style={{ overflowY: 'auto', maxHeight: 180, padding: '0 14px 10px',
        display: 'flex', flexDirection: 'column', gap: 4 }}>
        {log.length === 0 && (
          <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>
            Steps will appear here…
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} style={{ fontFamily: T.mono, fontSize: 11, lineHeight: 1.5,
            color: 'rgba(255,255,255,0.5)' }}>
            <span style={{ color: T.cyan, marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>{m}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );

  if (!colId) {
    return (
      <div style={panelBase}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 24 }}>
          Click any column to inspect
        </div>
        {logFooter}
      </div>
    );
  }

  // ---- GFC side: look up by gfc_id ----
  if (side === 'gfc') {
    const cmark = contract.gfc_cmark?.[colId] ?? null;
    const row = match?.matchResult.find((m) => m.gfc_id === colId);
    const etabsId = row?.etabs_id ?? null;
    const conf = row?.confidence ?? null;
    return (
      <div style={panelBase}>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.borderD}` }}>
            <div style={{ fontFamily: T.serif, fontSize: 17, color: T.cyan }}>{cmark ?? colId}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Drawing: {colId}</div>
          </div>
          <div style={{ padding: '12px 18px' }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)',
              letterSpacing: '0.08em', marginBottom: 10 }}>DRAWING COLUMN</div>
            {row2('C-mark', cmark ? <span style={{ color: T.cyan }}>{cmark}</span> : '—')}
            {row2('Drawing ID', colId)}
            {etabsId && (
              <>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)',
                  letterSpacing: '0.08em', margin: '16px 0 10px' }}>MATCHED MODEL</div>
                {row2('ETABS column', etabsId)}
                {conf && row2('Confidence', <span style={{ color: CONF_COLOR[conf] ?? '#fff' }}>{conf}</span>)}
                {row?.dist != null && row2('Distance', `${row.dist.toFixed(0)} mm`)}
              </>
            )}
            {!etabsId && match && (
              <div style={{ marginTop: 16, fontFamily: T.mono, fontSize: 12, color: CONF_COLOR.UNMATCHED_ETABS }}>
                No model match — drawn but not modeled
              </div>
            )}
            {!match && (
              <div style={{ marginTop: 16, fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
                Run "Refine &amp; match" to see model pairing.
              </div>
            )}
            <div style={{ margin: '20px 0 0', padding: '12px 14px', borderRadius: 8,
              border: `1px dashed ${T.borderD}`, background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.3)',
                letterSpacing: '0.08em' }}>COLUMN SCHEDULE</div>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 6 }}>
                Coming soon — schedule data will appear here.
              </div>
            </div>
          </div>
        </div>
        {logFooter}
      </div>
    );
  }

  // ---- ETABS side: look up by etabs_id ----
  const col = contract.etabs_cols.find((c) => c.id === colId);
  const wall = !col ? contract.etabs_walls.find((w) => w.sw === colId || w.pier === colId) : null;
  const row = match?.matchResult.find((m) => m.etabs_id === colId);
  const gfcId = row?.gfc_id ?? null;
  const cmark = gfcId ? (contract.gfc_cmark?.[gfcId] ?? null) : null;
  const conf = row?.confidence ?? null;

  return (
    <div style={panelBase}>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${T.borderD}` }}>
          <div style={{ fontFamily: T.serif, fontSize: 17, color: cmark ? T.cyan : T.textD }}>
            {cmark ?? (col ? col.id : wall ? wall.sw : colId)}
          </div>
          {cmark && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              ETABS: {col ? col.id : wall?.sw ?? colId}
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px' }}>
          {col && (
            <>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em', marginBottom: 10 }}>ETABS COLUMN</div>
              {cmark && row2('C-mark', <span style={{ color: T.cyan }}>{cmark}</span>)}
              {row2('Section', col.sec || '—')}
              {row2('B × D', `${col.B} × ${col.D} mm`)}
              {row2('Angle', `${col.ang}°`)}
              {row2('Center X', `${col.x.toFixed(0)} mm`)}
              {row2('Center Y', `${col.y.toFixed(0)} mm`)}
              {gfcId && (
                <>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)',
                    letterSpacing: '0.08em', margin: '16px 0 10px' }}>MATCHED DRAWING</div>
                  {row2('Drawing ID', gfcId)}
                  {conf && row2('Confidence', <span style={{ color: CONF_COLOR[conf] ?? '#fff' }}>{conf}</span>)}
                  {row?.dist != null && row2('Distance', `${row.dist.toFixed(0)} mm`)}
                </>
              )}
              {!gfcId && (
                <div style={{ marginTop: 16, fontFamily: T.mono, fontSize: 12, color: CONF_COLOR.UNMATCHED_ETABS }}>
                  No drawing match — modeled but not drawn
                </div>
              )}
            </>
          )}
          {wall && (
            <>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em', marginBottom: 10 }}>ETABS SHEAR WALL</div>
              {row2('SW', wall.sw)}
              {row2('Pier', wall.pier || '—')}
              {row2('Thickness', `${wall.thk} mm`)}
              {row2('Start', `(${wall.x1.toFixed(0)}, ${wall.y1.toFixed(0)}) mm`)}
              {row2('End', `(${wall.x2.toFixed(0)}, ${wall.y2.toFixed(0)}) mm`)}
              {row2('Length', `${Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1).toFixed(0)} mm`)}
            </>
          )}
          <div style={{ margin: '20px 0 0', padding: '12px 14px', borderRadius: 8,
            border: `1px dashed ${T.borderD}`, background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: 'rgba(255,255,255,0.3)',
              letterSpacing: '0.08em' }}>COLUMN SCHEDULE</div>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: 'rgba(255,255,255,0.2)', marginTop: 6 }}>
              Coming soon — schedule data will appear here.
            </div>
          </div>
        </div>
      </div>
      {logFooter}
    </div>
  );
}

function Banner({ text }: { text: string }) {
  return <div style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.3)',
    color: '#BE123C', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13.5 }}>{text}</div>;
}
