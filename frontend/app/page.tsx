'use client';

import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: T.navy, color: T.textD, fontFamily: T.sans, position: 'relative' }}>
      <GridBg />
      <div style={{ position: 'absolute', top: -160, right: -120, width: 520, height: 520,
        background: `radial-gradient(circle, ${T.cyan}1f, transparent 62%)`, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', maxWidth: 1080, margin: '0 auto', padding: '0 32px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '24px 0', borderBottom: `1px solid ${T.borderD}` }}>
          <span style={{ fontFamily: T.serif, fontSize: 22 }}>Column Rosetta Mapper</span>
          <nav style={{ display: 'flex', gap: 26, alignItems: 'center', fontSize: 13.5, color: T.mutedD }}>
            <Link href="/projects" style={{ color: T.mutedD, textDecoration: 'none' }}>My projects</Link>
            <Link href="/upload" style={ctaPill}>New project</Link>
          </nav>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 50,
          alignItems: 'center', padding: '72px 0 80px' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 13px',
              border: `1px solid ${T.borderD}`, borderRadius: 999, fontFamily: T.mono, fontSize: 11,
              color: T.mutedD, letterSpacing: '0.08em', marginBottom: 26 }}>
              <Dot /> ETABS ↔ GFC DRAWING · DETERMINISTIC
            </div>
            <h1 style={{ fontFamily: T.serif, fontSize: 56, lineHeight: 1.07, letterSpacing: '-0.02em',
              margin: 0, fontWeight: 400 }}>
              Reconcile any drawing against its<br />
              <span style={{ color: T.cyan, fontStyle: 'italic' }}>ETABS model.</span>
            </h1>
            <p style={{ fontSize: 16.5, color: T.mutedD, lineHeight: 1.6, maxWidth: 470, marginTop: 24 }}>
              Upload an ETABS model and the GFC drawings. We extract columns, names, walls and beams,
              then map them so you can confirm every match and flag every discrepancy — for any building.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 34 }}>
              <Link href="/upload" style={ctaBig}>Upload your building →</Link>
              <Link href="/projects" style={{ fontFamily: T.mono, fontSize: 12.5, color: T.mutedD }}>
                or view past projects
              </Link>
            </div>
          </div>
          <HowItWorks />
        </section>
      </div>
    </div>
  );
}

const ctaPill: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 999, background: T.cyan, color: T.navy,
  fontSize: 13, fontWeight: 600, textDecoration: 'none',
};
const ctaBig: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10, padding: '15px 28px', borderRadius: 12,
  background: T.cyan, color: T.navy, fontWeight: 600, fontSize: 15.5, textDecoration: 'none',
  boxShadow: `0 16px 40px -18px ${T.cyan}`,
};

function Dot() {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: T.cyan, opacity: 0.4 }} />
      <span style={{ position: 'absolute', inset: 2, borderRadius: 999, background: T.cyan }} />
    </span>
  );
}

function GridBg() {
  const c = 'rgba(255,255,255,0.022)';
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
      backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
      backgroundSize: '38px 38px' }} />
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', t: 'Upload', d: 'ETABS .$et model + GFC arrangement PDF (+ optional column layout).' },
    { n: '02', t: 'Extract', d: 'Columns, names, walls and beams pulled out automatically.' },
    { n: '03', t: 'Map & review', d: 'Engine matches drawing↔model; you confirm and flag discrepancies.' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {steps.map((s) => (
        <div key={s.n} style={{ background: T.surface, border: `1px solid ${T.borderD}`, borderRadius: 14,
          padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <span style={{ fontFamily: T.mono, fontSize: 12, color: T.cyan, marginTop: 2 }}>{s.n}</span>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>{s.t}</div>
            <div style={{ fontSize: 13.5, color: T.mutedD, marginTop: 4, lineHeight: 1.5 }}>{s.d}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
