'use client';

import React from 'react';
import Link from 'next/link';
import { T } from '@/lib/design';
import { api, type ProjectRef } from '@/lib/api';

export default function ProjectsPage() {
  const [email, setEmail] = React.useState('');
  const [projects, setProjects] = React.useState<ProjectRef[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('cs-email') : null;
    if (saved) { setEmail(saved); load(saved); }
  }, []);

  const load = async (em: string) => {
    try { setProjects(await api.listProjects(em)); } catch { /* offline */ }
    setLoaded(true);
  };

  return (
    <div style={{ minHeight: '100vh', background: T.paper, color: T.ink, fontFamily: T.sans }}>
      <header style={{ borderBottom: `1px solid ${T.border}`, background: T.panel, padding: '16px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/" style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, textDecoration: 'none' }}>
          Column Rosetta Mapper
        </Link>
        <Link href="/upload" style={{ padding: '8px 16px', borderRadius: 9, background: T.ink, color: T.textD,
          fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>New project</Link>
      </header>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 28px 80px' }}>
        <h1 style={{ fontFamily: T.serif, fontSize: 30, margin: '0 0 18px', fontWeight: 400 }}>Your projects</h1>
        <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@firm.com"
            style={{ flex: 1, padding: '10px 13px', borderRadius: 9, border: `1px solid ${T.border}`,
              fontSize: 14, fontFamily: T.sans, outline: 'none' }} />
          <button onClick={() => load(email)} style={{ padding: '10px 18px', borderRadius: 9, border: 'none',
            background: T.cyan, color: T.navy, fontWeight: 600, cursor: 'pointer', fontFamily: T.sans }}>Load</button>
        </div>

        {loaded && projects.length === 0 && (
          <div style={{ color: T.muted, fontSize: 14 }}>No projects yet. <Link href="/upload" style={{ color: T.cyanDeep }}>Upload one →</Link></div>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/project/${p.id}`} style={{ textDecoration: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', borderRadius: 11, background: T.panel, border: `1px solid ${T.border}` }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{p.name}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 11.5, color: T.subtle, marginTop: 3 }}>{p.id}</div>
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
                  background: p.status === 'extracted' || p.status === 'reviewed' ? `${T.cyan}22` : T.sand,
                  color: p.status === 'created' ? T.muted : T.cyanDeep }}>{p.status}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
