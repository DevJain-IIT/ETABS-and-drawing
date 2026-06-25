'use client';

// STEP 1 — "Name the columns" (Registration A). ONE drawing: the Column Layout
// Plan. It carries both the column BOXES and the C-mark NAMES in the same frame,
// so we Hungarian-match names→columns directly (no calibration). Shear walls
// (aspect>4) are tagged SW. Un-greyed columns (a name with no detected box) are
// surfaced as "add column here?". The engineer confirms / flags / corrects /
// adds / deletes. Names never drive geometry (display/verify only).

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T } from '@/lib/design';
import type { Contract, CMarkLayer, GfcCol } from '@/lib/engine/types';
import { autoName, type NamedCol, type NamingResult, type OrphanName } from '@/lib/engine';
import {
  newView, fitCloud, zoomAt, gfcToCanvas, canvasToGfc, type View,
} from '@/lib/engine/render';
import { api } from '@/lib/api';
import { usePdfBitmap } from '@/lib/usePdfBitmap';

const CW = 920, CH = 620;

export default function NamePage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const router = useRouter();
  const [contract, setContract] = React.useState<Contract | null>(null);
  const [result, setResult] = React.useState<NamingResult | null>(null);
  // editable overrides: id -> name (engineer corrections/confirmations)
  const [edits, setEdits] = React.useState<Record<string, string | null>>({});
  const [added, setAdded] = React.useState<NamedCol[]>([]);     // orphan→added columns
  const [deleted, setDeleted] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [drawingAlpha, setDrawingAlpha] = React.useState(0.9);
  const [viewScale, setViewScale] = React.useState(1);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const view = React.useRef<View>(newView());
  const drag = React.useRef<{ x: number; y: number; moved: number } | null>(null);
  const [, redraw] = React.useReducer((x) => x + 1, 0);

  // PDF background — crisp at any zoom via PDF.js, re-rendered when zoom settles
  const pdfBitmap = usePdfBitmap(
    contract ? api.getPdfUrl(projectId, 'layout_pdf') : null,
    viewScale,
  );

  // ---- load contract, run auto-naming, load raster background ----
  React.useEffect(() => {
    api.getContract(projectId).then((c) => {
      setContract(c);
      const layoutCols = (c.schedule?.layout_cols as GfcCol[] | undefined) ?? [];
      const layer = (c.schedule?.cmark_layer as CMarkLayer | undefined) ?? null;
      if (!layoutCols.length) { setErr('No Column Layout boxes found in this project. Re-run extraction with a Column Layout PDF.'); return; }
      setResult(autoName(layoutCols, layer ?? { marks: [], counts: {}, labels_found: 0, schedule_total: 0, reconciled: null }));
    }).catch(() => setErr(`Could not load project ${projectId}.`));
  }, [projectId]);

  // ---- initial fit ----
  React.useEffect(() => {
    if (!result) return;
    const pts = result.cols.map((c) => ({ x: c.cx, y: c.cy }));
    if (pts.length) view.current = fitCloud(pts, CW, CH, false);
    setViewScale(view.current.scale);
    redraw();
  }, [result]);

  // merged view of columns (auto result + edits + adds − deletes)
  const cols: NamedCol[] = React.useMemo(() => {
    if (!result) return [];
    const base = result.cols
      .filter((c) => !deleted.has(c.id))
      .map((c) => (c.id in edits ? { ...c, name: edits[c.id], flagged: false, reason: undefined } : c));
    return [...base, ...added.filter((c) => !deleted.has(c.id))];
  }, [result, edits, added, deleted]);

  const orphans: OrphanName[] = React.useMemo(
    () => (result?.orphanNames ?? []).filter((o) => !added.some((a) => a.name === o.mark && a.cx === o.x && a.cy === o.y)),
    [result, added],
  );

  // ---- draw ----
  const draw = React.useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d')!; const v = view.current;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH);

    // 1) PDF background — bitmap from PDF.js, always sharp at current zoom
    if (pdfBitmap && drawingAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = drawingAlpha;
      ctx.drawImage(pdfBitmap.bitmap, 0, 0, pdfBitmap.bitmap.width, pdfBitmap.bitmap.height,
        v.ox, v.oy, pdfBitmap.pageW * v.scale, pdfBitmap.pageH * v.scale);
      ctx.restore();
    }

    // 2) Extracted boxes + labels — ALWAYS full opacity, drawn on top of the PDF drawing
    for (const c of cols) {
      const p = gfcToCanvas(v, c.cx, c.cy);
      const hw = Math.max(3, (c.rw / 2) * v.scale), hh = Math.max(3, (c.rh / 2) * v.scale);
      const isSW = c.kind === 'wall';
      const named = c.name != null;
      ctx.fillStyle = isSW ? 'rgba(168,85,247,0.30)' : named ? 'rgba(14,159,110,0.25)' : 'rgba(225,29,72,0.22)';
      ctx.strokeStyle = c.id === selected ? '#0A1628' : isSW ? '#A855F7' : named ? '#0E9F6E' : '#E11D48';
      ctx.lineWidth = c.id === selected ? 2.5 : 1.5;
      ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
      ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
    }
    // orphan names — amber ring only, no text on canvas
    for (const o of orphans) {
      const p = gfcToCanvas(v, o.x, o.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#E08A00'; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [cols, orphans, selected, pdfBitmap, drawingAlpha]);
  React.useEffect(() => { draw(); });

  // ---- interactions ----
  const toCanvas = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    return { cx: ((ev.clientX - r.left) / r.width) * CW, cy: ((ev.clientY - r.top) / r.height) * CH };
  };
  // Wheel zoom — native non-passive listener so preventDefault() works.
  // Must depend on `result` because the canvas is only in the DOM after data loads
  // (the page returns a loading shell before that, so canvasRef.current is null on mount).
  React.useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect();
      const cx = ((ev.clientX - r.left) / r.width) * CW, cy = ((ev.clientY - r.top) / r.height) * CH;
      zoomAt(view.current, cx, cy, ev.deltaY);
      setViewScale(view.current.scale);
      redraw();
    };
    cv.addEventListener('wheel', handler, { passive: false });
    return () => cv.removeEventListener('wheel', handler);
  }, [result]);
  const onDown = (ev: React.MouseEvent) => { const { cx, cy } = toCanvas(ev); drag.current = { x: cx, y: cy, moved: 0 }; };
  const onMove = (ev: React.MouseEvent) => {
    if (!drag.current) return;
    const { cx, cy } = toCanvas(ev); const v = view.current;
    v.ox += cx - drag.current.x; v.oy += cy - drag.current.y;
    drag.current.moved += Math.abs(cx - drag.current.x) + Math.abs(cy - drag.current.y);
    drag.current.x = cx; drag.current.y = cy; redraw();
  };
  const onUp = (ev: React.MouseEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved > 4) return;
    const { cx, cy } = toCanvas(ev); const w = canvasToGfc(view.current, cx, cy);
    // pick nearest box
    let best: NamedCol | null = null, bd = Infinity;
    for (const c of cols) { const dd = Math.hypot(c.cx - w.x, c.cy - w.y); if (dd < bd) { bd = dd; best = c; } }
    if (best && bd < 40 / view.current.scale) setSelected(best.id);
    else setSelected(null);
  };

  // ---- review actions ----
  const setName = (id: string, name: string | null) => setEdits((e) => ({ ...e, [id]: name }));
  const del = (id: string) => { setDeleted((s) => new Set(s).add(id)); setSelected(null); };
  const addOrphan = (o: OrphanName) => {
    const id = `ADD_${o.mark}_${Math.round(o.x)}_${Math.round(o.y)}`;
    setAdded((a) => [...a, { id, cx: o.x, cy: o.y, rw: 12, rh: 12, kind: 'column', name: o.mark, dist: 0, flagged: false }]);
    setSelected(id);
  };

  const confirmAndContinue = async () => {
    // gfc_cmark from the (layout) ids; persist decisions; go to mapper
    const gfc_cmark: Record<string, string> = {};
    for (const c of cols) if (c.kind === 'column' && c.name) gfc_cmark[c.id] = c.name;
    try {
      await api.saveResults(projectId, {
        step: 'naming',
        gfc_cmark,
        walls: cols.filter((c) => c.kind === 'wall').map((c) => c.id),
        deleted: [...deleted],
        added: added.map((a) => ({ id: a.id, cx: a.cx, cy: a.cy, name: a.name })),
      });
    } catch { /* non-fatal — naming is client-truth; persist is best-effort */ }
    router.push(`/project/${projectId}/floor`);
  };

  if (err) return <Shell><Banner text={err} /><Link href="/projects" style={lnk}>← projects</Link></Shell>;
  if (!contract || !result) return <Shell><div style={{ fontFamily: T.serif, fontSize: 18 }}>Loading column layout…</div></Shell>;

  const sel = cols.find((c) => c.id === selected) || null;
  const reviewCols = cols.filter((c) => c.flagged && !(c.id in edits));
  const total = result.columns, named = cols.filter((c) => c.kind === 'column' && c.name != null).length;

  return (
    <div style={{ minHeight: '100vh', background: T.paper, color: T.ink, fontFamily: T.sans }}>
      <Header />
      <div style={{ maxWidth: 1340, margin: '0 auto', padding: '18px 24px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: T.serif, fontSize: 22 }}>Step 1 — Name the columns</div>
            <div style={{ color: T.muted, fontSize: 13.5, marginTop: 4, maxWidth: 720 }}>
              One drawing (the Column Layout Plan). We matched each <b>name</b> (C1, C2…) to its nearest column <b>box</b> —
              same sheet, so no alignment needed. Shear walls (long boxes, L/B&gt;4) are tagged <b style={{ color: '#7E22CE' }}>SW</b>.
              Review the flagged ones, then continue.
            </div>
          </div>
          <button onClick={confirmAndContinue} style={primaryBtn}>Confirm &amp; continue → map to ETABS</button>
        </div>

        <StatBar total={total} named={named} walls={result.walls} orphans={orphans.length} flagged={reviewCols.length} />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16, marginTop: 14 }}>
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontFamily: T.serif, fontSize: 16 }}>Column Layout Plan</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Overlay transparency slider: 0 = drawing only, 1 = full overlay */}
                <label style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  drawing
                  <input type="range" min={0} max={1} step={0.05} value={drawingAlpha}
                    onChange={(e) => setDrawingAlpha(+e.target.value)}
                    style={{ width: 90, accentColor: T.cyanDeep }} />
                  <span style={{ width: 28, textAlign: 'right' }}>{Math.round(drawingAlpha * 100)}%</span>
                </label>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle }}>scroll = zoom · drag = pan · click a box</span>
              </div>
            </div>
            <canvas ref={canvasRef} width={CW} height={CH}
              style={{ width: '100%', height: 'auto', aspectRatio: `${CW} / ${CH}`, background: '#fff',
                borderRadius: 10, border: `1px solid ${T.border}`, cursor: 'crosshair', touchAction: 'none' }}
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
              onMouseLeave={() => { drag.current = null; }} />
            <Legend />
          </div>

          <SidePanel
            sel={sel} onName={setName} onDelete={del}
            review={reviewCols} orphans={orphans} onAddOrphan={addOrphan} onSelect={setSelected}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------- subcomponents ----------------
function StatBar({ total, named, walls, orphans, flagged }: { total: number; named: number; walls: number; orphans: number; flagged: number }) {
  const item = (v: number, l: string, c: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
      <b style={{ color: T.ink }}>{v}</b> <span style={{ color: T.muted }}>{l}</span>
    </span>
  );
  return (
    <div style={{ display: 'flex', gap: 22, marginTop: 14, fontFamily: T.mono, fontSize: 13, flexWrap: 'wrap',
      background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 16px' }}>
      {item(named, `named / ${total} columns`, '#0E9F6E')}
      {item(total - named, 'unnamed', '#E11D48')}
      {item(walls, 'shear walls (SW)', '#A855F7')}
      {item(orphans, 'un-greyed (add?)', '#E08A00')}
      {item(flagged, 'to review', '#64748B')}
    </div>
  );
}

function SidePanel({ sel, onName, onDelete, review, orphans, onAddOrphan, onSelect }: {
  sel: NamedCol | null; onName: (id: string, n: string | null) => void; onDelete: (id: string) => void;
  review: NamedCol[]; orphans: OrphanName[]; onAddOrphan: (o: OrphanName) => void; onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sel && <SelectedCard sel={sel} onName={onName} onDelete={onDelete} />}
      {orphans.length > 0 && (
        <Card title={`Un-greyed columns (${orphans.length})`} tone="#E08A00"
          sub="A name with no grey box near it — likely a column the fill detector missed. Add it where the name sits.">
          {orphans.map((o, i) => (
            <Row key={i}>
              <span style={{ fontFamily: T.mono, fontSize: 12.5 }}>{o.mark}</span>
              <span style={{ fontFamily: T.mono, fontSize: 11, color: T.subtle }}>{o.nearestDist}pt away</span>
              <button onClick={() => onAddOrphan(o)} style={miniBtn}>+ add</button>
            </Row>
          ))}
        </Card>
      )}
      {review.length > 0 && (
        <Card title={`Review (${review.length})`} tone="#64748B" sub="Flagged for a quick check — confirm or fix.">
          {review.map((c) => (
            <Row key={c.id} onClick={() => onSelect(c.id)}>
              <span style={{ fontFamily: T.mono, fontSize: 12.5, color: c.kind === 'wall' ? '#7E22CE' : c.name ? T.ink : '#E11D48' }}>
                {c.id} · {c.name || '—'}
              </span>
              <span style={{ fontSize: 11, color: T.muted, flex: 1 }}>{c.reason}</span>
            </Row>
          ))}
        </Card>
      )}
      {!sel && review.length === 0 && orphans.length === 0 && (
        <Card title="All clear" tone="#0E9F6E" sub="Every column has a name and nothing needs review. Click a box to edit, or continue." >{null}</Card>
      )}
    </div>
  );
}

function SelectedCard({ sel, onName, onDelete }: { sel: NamedCol; onName: (id: string, n: string | null) => void; onDelete: (id: string) => void }) {
  const [val, setVal] = React.useState(sel.name ?? '');
  React.useEffect(() => setVal(sel.name ?? ''), [sel.id, sel.name]);
  return (
    <Card title={`Selected · ${sel.id}`} tone={sel.kind === 'wall' ? '#A855F7' : '#0E9F6E'}
      sub={sel.kind === 'wall' ? `Shear wall — aspect ${(sel.aspect ?? 0).toFixed(1)}` : sel.dist != null ? `name ${sel.dist}pt from box` : 'no auto name'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="C-mark e.g. C12"
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 13 }} />
        <button onClick={() => onName(sel.id, val.trim() || null)} style={miniBtn}>set</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onName(sel.id, sel.name)} style={ghostBtn}>confirm</button>
        <button onClick={() => onName(sel.id, 'SW')} style={ghostBtn}>mark SW</button>
        <button onClick={() => onDelete(sel.id)} style={{ ...ghostBtn, color: '#BE123C', borderColor: 'rgba(225,29,72,0.4)' }}>delete</button>
      </div>
    </Card>
  );
}

function Card({ title, sub, tone, children }: { title: string; sub?: string; tone: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderLeft: `3px solid ${tone}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontFamily: T.serif, fontSize: 15 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 3, marginBottom: 10 }}>{sub}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  );
}
function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
    borderRadius: 8, background: T.sand, cursor: onClick ? 'pointer' : 'default' }}>{children}</div>;
}
function Legend() {
  const items = [['named column', '#0E9F6E'], ['unnamed', '#E11D48'], ['shear wall (SW)', '#A855F7'], ['un-greyed (add?)', '#E08A00']] as const;
  return <div style={{ display: 'flex', gap: 16, marginTop: 10, fontFamily: T.mono, fontSize: 11.5, color: T.muted, flexWrap: 'wrap' }}>
    {items.map(([l, c]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 11, height: 11, borderRadius: 2, background: c }} /> {l}</span>)}
  </div>;
}
function Header() {
  return <header style={{ borderBottom: `1px solid ${T.border}`, background: T.panel, display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
    <Link href="/projects" style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, textDecoration: 'none' }}>Column Rosetta Mapper</Link>
    <span style={{ fontFamily: T.mono, fontSize: 12, color: T.subtle }}>1 · Name → 2 · Floor → 3 · Map → 4 · Rosetta</span>
  </header>;
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: T.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>{children}</div>;
}
function Banner({ text }: { text: string }) {
  return <div style={{ background: 'rgba(225,29,72,0.08)', border: '1px solid rgba(225,29,72,0.3)', color: '#BE123C',
    borderRadius: 10, padding: '12px 16px', fontSize: 13.5, maxWidth: 560 }}>{text}</div>;
}

const primaryBtn: React.CSSProperties = { padding: '11px 20px', borderRadius: 10, border: 'none', background: T.ink, color: T.textD, fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const miniBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: 'none', background: T.ink, color: T.textD, fontFamily: T.mono, fontSize: 12, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.panel, color: T.ink, fontFamily: T.mono, fontSize: 12, cursor: 'pointer' };
const lnk: React.CSSProperties = { fontFamily: T.mono, fontSize: 13, color: T.cyanDeep };
