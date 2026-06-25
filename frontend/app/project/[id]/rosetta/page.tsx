'use client';
import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';
import { api } from '@/lib/api';
import type { Contract } from '@/lib/engine/types';
import { deriveSeed } from '@/lib/engine/geometry';
import { runColumnMatch } from '@/lib/engine/match';
import { runBeamMatchV2 } from '@/lib/engine/beams';
import type { BeamMatchV2Output, EtabsBeamResult } from '@/lib/engine/beams';

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
          ETABS is ground truth. For each ETABS beam, we check whether a
          corresponding drawn beam exists within a ±300mm perpendicular corridor
          between the two column faces. Missing = drawn but absent from ETABS.
          Extra = in drawing but no ETABS beam corridor covers it.
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
      <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{count}</div>
      <div style={{ fontFamily: T.sans, fontSize: 13, color, opacity: 0.85, lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

// ---- ETABS beam result card ------------------------------------------------
function EtabsBeamCard({ beam, colById }: {
  beam: EtabsBeamResult;
  colById: Map<string, { id: string; sec: string }>;
}) {
  const ca = colById.get(beam.ea), cb = colById.get(beam.eb);
  const labelA = ca ? `${beam.ea}${ca.sec ? ` (${ca.sec})` : ''}` : beam.ea;
  const labelB = cb ? `${beam.eb}${cb.sec ? ` (${cb.sec})` : ''}` : beam.eb;
  const isMissing = beam.status === 'missing';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      background: isMissing ? 'rgba(225,29,72,0.06)' : 'rgba(14,159,110,0.05)',
      border: `1px solid ${isMissing ? 'rgba(225,29,72,0.22)' : 'rgba(14,159,110,0.2)'}`,
      borderRadius: 8, fontFamily: T.mono, fontSize: 13,
    }}>
      <span style={{ color: isMissing ? '#E11D48' : '#0E9F6E', fontWeight: 700, fontSize: 16 }}>
        {isMissing ? '✕' : '✓'}
      </span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelA}</span>
      <span style={{ color: T.muted, fontSize: 11 }}>↔</span>
      <span style={{ color: T.ink, fontWeight: 600 }}>{labelB}</span>
      <span style={{
        marginLeft: 'auto', fontFamily: T.sans, fontSize: 11, fontWeight: 600,
        color: isMissing ? '#BE123C' : '#047857',
        background: isMissing ? 'rgba(225,29,72,0.10)' : 'rgba(14,159,110,0.10)',
        border: `1px solid ${isMissing ? 'rgba(225,29,72,0.30)' : 'rgba(14,159,110,0.25)'}`,
        borderRadius: 4, padding: '2px 8px',
      }}>
        {isMissing ? 'MISSING IN DRAWING' : 'VERIFIED'}
      </span>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------
export default function RosettaPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const [contract, setContract] = React.useState<Contract | null>(null);
  const [beamMatch, setBeamMatch] = React.useState<BeamMatchV2Output | null>(null);
  const [log, setLog] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [showVerified, setShowVerified] = React.useState(false);

  const addLog = React.useCallback((msg: string) => setLog((l) => [...l, msg]), []);

  React.useEffect(() => {
    addLog('Loading contract…');
    api.getContract(projectId).then((c) => {
      setContract(c);
      addLog(`Contract loaded — ${c.gfc_cols.length} GFC cols, ${c.etabs_cols.length} ETABS cols, ${c.etabs_beams.length} ETABS beams, ${c.drawing_beams.length} drawing beams`);

      addLog('Deriving alignment (auto-seed)…');
      const seed = deriveSeed(c.gfc_cols, c.etabs_cols);
      addLog(`Seed: ${seed.desc} — residual ${Math.round(seed.residual)} mm`);

      addLog('Running column match…');
      const match = runColumnMatch(seed.seed, { GFC_COLS: c.gfc_cols, ETABS_COLS: c.etabs_cols, ETABS_WALLS: c.etabs_walls });
      addLog(`Column match: ${match.counts.HIGH} HIGH, ${match.counts.MED} MED, ${match.counts.LOW} LOW`);

      addLog('Running ETABS-first beam corridor check…');
      const bm = runBeamMatchV2(c, seed.seed, match);
      setBeamMatch(bm);
      addLog(`Beams: ${bm.counts.verified} verified ✓, ${bm.counts.missing} missing in drawing ✕, ${bm.counts.extra} extra in drawing ⚠`);
      if (bm.counts.missing === 0) addLog('No missing beams — all ETABS beams found in drawing.');
    }).catch((e) => {
      setErr(String(e));
      addLog(`Error: ${String(e)}`);
    });
  }, [projectId, addLog]);

  const etabsColById = React.useMemo(() => {
    const m = new Map<string, { id: string; sec: string }>();
    contract?.etabs_cols.forEach((c) => m.set(c.id, c));
    return m;
  }, [contract]);

  const mainStyle: React.CSSProperties = {
    marginTop: HEADER_H, marginRight: 316, minHeight: `calc(100vh - ${HEADER_H}px)`,
    background: T.paper, padding: '32px 40px', overflowY: 'auto',
  };

  if (err) return (
    <>
      <Header />
      <div style={mainStyle}>
        <div style={{ fontFamily: T.mono, fontSize: 13, color: '#E11D48', padding: 24 }}>{err}</div>
      </div>
      <InspectorPanel log={log} />
    </>
  );

  if (!beamMatch) return (
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

  const missingBeams = beamMatch.etabsBeams.filter((b) => b.status === 'missing');
  const verifiedBeams = beamMatch.etabsBeams.filter((b) => b.status === 'verified');
  const extraBeams = beamMatch.drawingBeams.filter((b) => b.status === 'extra');

  return (
    <>
      <Header projectName={contract?.project_name} />
      <div style={mainStyle}>

        {/* Title */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: T.serif, fontSize: 26, color: T.ink, margin: 0, fontWeight: 700 }}>
            Beam Verification
          </h1>
          <p style={{ fontFamily: T.sans, fontSize: 13, color: T.muted, margin: '6px 0 0', lineHeight: 1.5 }}>
            ETABS is ground truth. Every ETABS beam is checked for a corresponding drawn beam
            within a ±300 mm perpendicular corridor between the column faces.
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 36 }}>
          <SummaryCard label="Verified in drawing" count={beamMatch.counts.verified}
            color="#047857" bg="rgba(14,159,110,0.07)" border="rgba(14,159,110,0.25)" />
          <SummaryCard label="Missing from drawing" count={beamMatch.counts.missing}
            color="#BE123C" bg="rgba(225,29,72,0.06)" border="rgba(225,29,72,0.22)" />
          <SummaryCard label="Extra in drawing" count={beamMatch.counts.extra}
            color="#B45309" bg="rgba(224,138,0,0.07)" border="rgba(224,138,0,0.25)" />
        </div>

        {/* MISSING list — primary flaw */}
        {missingBeams.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: '0.12em', color: '#BE123C', marginBottom: 12 }}>
              ✕ ETABS BEAMS MISSING FROM DRAWING — {missingBeams.length} FLAW{missingBeams.length !== 1 ? 'S' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {missingBeams.map((b) => (
                <EtabsBeamCard key={`${b.ea}|${b.eb}`} beam={b} colById={etabsColById} />
              ))}
            </div>
          </section>
        )}

        {/* EXTRA list — secondary review */}
        {extraBeams.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: '0.12em', color: '#B45309', marginBottom: 12 }}>
              ⚠ EXTRA IN DRAWING — NOT IN ETABS MODEL — {extraBeams.length} ITEM{extraBeams.length !== 1 ? 'S' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {extraBeams.map((b, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  background: 'rgba(224,138,0,0.06)', border: '1px solid rgba(224,138,0,0.22)',
                  borderRadius: 8, fontFamily: T.mono, fontSize: 13,
                }}>
                  <span style={{ color: '#E08A00', fontWeight: 700, fontSize: 16 }}>⚠</span>
                  <span style={{ color: T.ink, fontWeight: 600 }}>{b.a || '—'}</span>
                  <span style={{ color: T.muted, fontSize: 11 }}>→</span>
                  <span style={{ color: T.ink, fontWeight: 600 }}>{b.b || '—'}</span>
                  <span style={{
                    marginLeft: 'auto', fontFamily: T.sans, fontSize: 11, fontWeight: 600,
                    color: '#B45309', background: 'rgba(224,138,0,0.10)',
                    border: '1px solid rgba(224,138,0,0.30)', borderRadius: 4, padding: '2px 8px',
                  }}>EXTRA</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All clear */}
        {missingBeams.length === 0 && (
          <div style={{
            padding: '28px 24px', background: 'rgba(14,159,110,0.07)',
            border: '1px solid rgba(14,159,110,0.25)', borderRadius: 12,
            fontFamily: T.sans, fontSize: 15, color: '#047857', fontWeight: 600, marginBottom: 24,
          }}>
            ✓ All {beamMatch.counts.verified} ETABS beams verified in drawing — no missing beams.
          </div>
        )}

        {/* Verified list (collapsible) */}
        {verifiedBeams.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <button onClick={() => setShowVerified((v) => !v)} style={{
              fontFamily: T.mono, fontSize: 11, letterSpacing: '0.12em', color: '#047857',
              marginBottom: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}>
              {showVerified ? '▾' : '▸'} VERIFIED — {verifiedBeams.length} BEAM{verifiedBeams.length !== 1 ? 'S' : ''}
            </button>
            {showVerified && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {verifiedBeams.map((b) => (
                  <EtabsBeamCard key={`${b.ea}|${b.eb}`} beam={b} colById={etabsColById} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <InspectorPanel log={log} />
    </>
  );
}
