'use client';
import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';
import { api } from '@/lib/api';
import type { Contract } from '@/lib/engine/types';
import { deriveSeed } from '@/lib/engine/geometry';
import { runColumnMatch } from '@/lib/engine/match';
import { runBeamMatch } from '@/lib/engine/beams';
import type { BeamMatchOutput, BeamRow } from '@/lib/engine/beams';

const HEADER_H = 54;

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
        {projectName && (
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>· {projectName}</span>
        )}
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

// ---- Inspector / Activity log ----------------------------------------------
function InspectorPanel({ log }: { log: string[] }) {
  const logEndRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);

  const panelBase: React.CSSProperties = {
    position: 'fixed', right: 0, top: HEADER_H, bottom: 0, width: 316,
    background: T.navy, borderLeft: `1px solid ${T.borderD}`, zIndex: 50,
    display: 'flex', flexDirection: 'column',
  };
  return (
    <div style={panelBase}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px' }}>
        <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginBottom: 10 }}>
          BEAM VERIFICATION
        </div>
        <div style={{ fontFamily: T.sans, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          Topological check — a drawing beam is matched when both its column endpoints map to the same
          ETABS column pair. No positional tolerance; relies on Step 3 column alignment.
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${T.borderD}`, flexShrink: 0 }}>
        <div style={{ padding: '8px 14px 4px', fontFamily: T.mono, fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)' }}>
          ACTIVITY
        </div>
        <div style={{ overflowY: 'auto', maxHeight: 200, padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {log.map((m, i) => (
            <div key={i} style={{ fontFamily: T.mono, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.5)' }}>
              <span style={{ color: T.cyan, marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>{m}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ---- Summary card ----------------------------------------------------------
function SummaryCard({ label, count, color, bg, border }: {
  label: string; count: number; color: string; bg: string; border: string;
}) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, minWidth: 180,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>
        {count}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 13, color, opacity: 0.85, lineHeight: 1.4 }}>
        {label}
      </div>
    </div>
  );
}

// ---- Beam row card ---------------------------------------------------------
function BeamCard({ beam, cmark, verdict }: {
  beam: BeamRow;
  cmark: Record<string, string>;
  verdict: 'FLAW' | 'REVIEW';
}) {
  const labelA = cmark[beam.a] ?? beam.a;
  const labelB = cmark[beam.b] ?? beam.b;
  const isFlaw = verdict === 'FLAW';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      background: isFlaw ? 'rgba(225,29,72,0.06)' : 'rgba(224,138,0,0.06)',
      border: `1px solid ${isFlaw ? 'rgba(225,29,72,0.22)' : 'rgba(224,138,0,0.22)'}`,
      borderRadius: 8, fontFamily: T.mono, fontSize: 13,
    }}>
      <span style={{ color: isFlaw ? '#E11D48' : '#E08A00', fontWeight: 700, fontSize: 16 }}>
        {isFlaw ? '✕' : '⚠'}
      </span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelA}</span>
      <span style={{ color: T.muted, fontSize: 11 }}>→</span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelB}</span>
      {beam.mark && (
        <span style={{ marginLeft: 'auto', background: T.sand, borderRadius: 4, padding: '2px 8px', fontSize: 11, color: T.muted }}>
          {beam.mark}
        </span>
      )}
      <span style={{
        marginLeft: beam.mark ? 0 : 'auto',
        fontFamily: T.sans, fontSize: 11, fontWeight: 600,
        color: isFlaw ? '#BE123C' : '#B45309',
        background: isFlaw ? 'rgba(225,29,72,0.10)' : 'rgba(224,138,0,0.10)',
        border: `1px solid ${isFlaw ? 'rgba(225,29,72,0.30)' : 'rgba(224,138,0,0.30)'}`,
        borderRadius: 4, padding: '2px 8px',
      }}>
        {isFlaw ? 'FLAW' : 'REVIEW'}
      </span>
    </div>
  );
}

// ---- ETABS-only edge card --------------------------------------------------
function EtabsOnlyCard({ edge, colById }: {
  edge: { a: string; b: string };
  colById: Map<string, { id: string; sec: string }>;
}) {
  const ca = colById.get(edge.a), cb = colById.get(edge.b);
  const labelA = ca ? `${edge.a} (${ca.sec})` : edge.a;
  const labelB = cb ? `${edge.b} (${cb.sec})` : edge.b;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      background: 'rgba(224,138,0,0.06)', border: '1px solid rgba(224,138,0,0.22)',
      borderRadius: 8, fontFamily: T.mono, fontSize: 13,
    }}>
      <span style={{ color: '#E08A00', fontWeight: 700, fontSize: 16 }}>⚠</span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelA}</span>
      <span style={{ color: T.muted, fontSize: 11 }}>↔</span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelB}</span>
      <span style={{
        marginLeft: 'auto', fontFamily: T.sans, fontSize: 11, fontWeight: 600,
        color: '#B45309', background: 'rgba(224,138,0,0.10)',
        border: '1px solid rgba(224,138,0,0.30)', borderRadius: 4, padding: '2px 8px',
      }}>
        MISSING IN DRAWING
      </span>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------
export default function RosettaPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [contract, setContract] = React.useState<Contract | null>(null);
  const [beamMatch, setBeamMatch] = React.useState<BeamMatchOutput | null>(null);
  const [log, setLog] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const addLog = React.useCallback((msg: string) => setLog((l) => [...l, msg]), []);

  React.useEffect(() => {
    addLog('Loading contract…');
    api.getContract(projectId).then((c) => {
      setContract(c);
      addLog(`Contract loaded — ${c.gfc_cols.length} GFC cols, ${c.etabs_cols.length} ETABS cols, ${c.drawing_beams.length} drawing beams`);

      addLog('Deriving alignment seed (auto)…');
      const seed = deriveSeed(c.gfc_cols, c.etabs_cols);
      addLog(`Seed: ${seed.desc} — residual ${Math.round(seed.residual)} mm`);

      addLog('Running column match…');
      const match = runColumnMatch(seed.seed, { GFC_COLS: c.gfc_cols, ETABS_COLS: c.etabs_cols, ETABS_WALLS: c.etabs_walls });
      const { HIGH, MED } = match.counts;
      addLog(`Column match: ${HIGH} HIGH, ${MED} MED`);

      addLog('Running beam topology check…');
      const bm = runBeamMatch(c, match);
      setBeamMatch(bm);
      addLog(`Beams: ${bm.counts.matched} matched, ${bm.counts.drawing_only} drawn-not-modeled, ${bm.counts.etabs_only} modeled-not-drawn`);
      if (bm.counts.drawing_only === 0 && bm.counts.etabs_only === 0) {
        addLog('All beams verified — no topology discrepancies found.');
      }
    }).catch((e) => {
      setErr(String(e));
      addLog(`Error: ${String(e)}`);
    });
  }, [projectId, addLog]);

  const cmark = contract?.gfc_cmark ?? {};
  const etabsColById = React.useMemo(() => {
    const m = new Map<string, { id: string; sec: string }>();
    contract?.etabs_cols.forEach((c) => m.set(c.id, c));
    return m;
  }, [contract]);

  const flawBeams = beamMatch?.beams.filter((b) => b.status === 'drawing_only') ?? [];
  const missingBeams = beamMatch?.etabsOnlyEdges ?? [];

  const mainStyle: React.CSSProperties = {
    marginTop: HEADER_H, marginRight: 316, minHeight: `calc(100vh - ${HEADER_H}px)`,
    background: T.paper, padding: '32px 40px', overflowY: 'auto',
  };

  if (err) {
    return (
      <>
        <Header />
        <div style={mainStyle}>
          <div style={{ fontFamily: T.mono, fontSize: 13, color: '#E11D48', padding: 24 }}>{err}</div>
        </div>
        <InspectorPanel log={log} />
      </>
    );
  }

  if (!beamMatch) {
    return (
      <>
        <Header projectName={contract?.project_name} />
        <div style={mainStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: T.muted, fontFamily: T.mono, fontSize: 13 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 999, border: `2px solid ${T.cyan}`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
            Running beam verification…
          </div>
        </div>
        <InspectorPanel log={log} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  return (
    <>
      <Header projectName={contract?.project_name} />
      <div style={mainStyle}>

        {/* Title */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: T.serif, fontSize: 26, color: T.ink, margin: 0, fontWeight: 700 }}>
            Beam Topology Verification
          </h1>
          <p style={{ fontFamily: T.sans, fontSize: 13, color: T.muted, margin: '6px 0 0', lineHeight: 1.5 }}>
            Comparing drawing beams against the ETABS model using column-pair topology.
            Each drawing beam is matched if both its endpoint columns align to the same ETABS beam.
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 36 }}>
          <SummaryCard
            label="Beams matched"
            count={beamMatch.counts.matched}
            color="#047857"
            bg="rgba(14,159,110,0.07)"
            border="rgba(14,159,110,0.25)"
          />
          <SummaryCard
            label="Drawn — not in ETABS"
            count={beamMatch.counts.drawing_only}
            color="#BE123C"
            bg="rgba(225,29,72,0.06)"
            border="rgba(225,29,72,0.22)"
          />
          <SummaryCard
            label="In ETABS — not drawn"
            count={beamMatch.counts.etabs_only}
            color="#B45309"
            bg="rgba(224,138,0,0.07)"
            border="rgba(224,138,0,0.25)"
          />
          {beamMatch.counts.nocol > 0 && (
            <SummaryCard
              label="Endpoints unmatched"
              count={beamMatch.counts.nocol}
              color={T.muted}
              bg={T.sand}
              border={T.border}
            />
          )}
        </div>

        {/* FLAW list */}
        {flawBeams.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: '0.12em', color: '#BE123C', marginBottom: 12 }}>
              ✕ DRAWN BUT NOT IN ETABS MODEL — {flawBeams.length} FLAW{flawBeams.length !== 1 ? 'S' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {flawBeams.map((b) => (
                <BeamCard key={b.id} beam={b} cmark={cmark} verdict="FLAW" />
              ))}
            </div>
          </section>
        )}

        {/* MISSING list */}
        {missingBeams.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: '0.12em', color: '#B45309', marginBottom: 12 }}>
              ⚠ IN ETABS MODEL — MISSING FROM DRAWING — {missingBeams.length} ITEM{missingBeams.length !== 1 ? 'S' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {missingBeams.map((e, i) => (
                <EtabsOnlyCard key={`${e.a}|${e.b}|${i}`} edge={e} colById={etabsColById} />
              ))}
            </div>
          </section>
        )}

        {/* All clear */}
        {flawBeams.length === 0 && missingBeams.length === 0 && (
          <div style={{
            padding: '28px 24px', background: 'rgba(14,159,110,0.07)',
            border: '1px solid rgba(14,159,110,0.25)', borderRadius: 12,
            fontFamily: T.sans, fontSize: 15, color: '#047857', fontWeight: 600,
          }}>
            ✓ All {beamMatch.counts.matched} beams verified — no topology discrepancies found.
          </div>
        )}

        {/* Nocol note */}
        {beamMatch.counts.nocol > 0 && (
          <div style={{
            marginTop: 24, padding: '14px 18px',
            background: T.sand, border: `1px solid ${T.border}`, borderRadius: 8,
            fontFamily: T.sans, fontSize: 12, color: T.muted, lineHeight: 1.6,
          }}>
            <strong style={{ color: T.ink }}>{beamMatch.counts.nocol} drawing beam{beamMatch.counts.nocol !== 1 ? 's' : ''}</strong> could not be checked because one or both of their endpoint columns were not matched in Step 3. Return to Step 3 and improve the column match before assessing these beams.
          </div>
        )}
      </div>

      <InspectorPanel log={log} />
    </>
  );
}
