'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { T } from '@/lib/design';
import { api } from '@/lib/api';

type FileKind = 'etabs' | 'gfc_pdf' | 'layout_pdf';
const SLOTS: { kind: FileKind; label: string; hint: string; accept: string; required: boolean }[] = [
  { kind: 'etabs', label: 'ETABS model', hint: '.$et / .e2k structural model', accept: '.et,.e2k,.$et', required: true },
  { kind: 'gfc_pdf', label: 'Ground floor arrangement', hint: 'GFC drawing PDF (columns + beams)', accept: '.pdf', required: true },
  { kind: 'layout_pdf', label: 'Column layout plan', hint: 'PDF with C-mark names (optional)', accept: '.pdf', required: false },
];

export default function UploadPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [files, setFiles] = React.useState<Partial<Record<FileKind, File>>>({});
  const [stage, setStage] = React.useState<'idle' | 'working' | 'error'>('idle');
  const [msg, setMsg] = React.useState<string>('');

  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('cs-email') : null;
    if (saved) setEmail(saved);
    api.warmup();
  }, []);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const ready = emailValid && !!files.etabs && !!files.gfc_pdf && name.trim().length > 0;

  const run = async () => {
    if (!ready) return;
    localStorage.setItem('cs-email', email.trim().toLowerCase());
    setStage('working');
    try {
      setMsg('Creating project…');
      const proj = await api.createProject(name.trim(), email.trim().toLowerCase());
      setMsg('Uploading files…');
      await api.uploadFiles(proj.id, files as Record<string, File>);
      setMsg('Extracting (parsing ETABS + detecting columns + reading names + beams)…');
      const res = await api.extract(proj.id);
      setMsg(`Extracted ${res.columns} columns · ${res.drawing_beams} beams. Opening…`);
      // Step 1 is naming (Registration A) — the flow starts there, then the mapper.
      setTimeout(() => router.push(`/project/${proj.id}/name`), 700);
    } catch (e) {
      setStage('error');
      setMsg(e instanceof Error ? e.message : 'Upload/extract failed.');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: T.paper, color: T.ink, fontFamily: T.sans }}>
      <header style={{ borderBottom: `1px solid ${T.border}`, background: T.panel, padding: '16px 28px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/" style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, textDecoration: 'none' }}>
          Column Rosetta Mapper
        </Link>
        <Link href="/projects" style={{ fontFamily: T.mono, fontSize: 12.5, color: T.cyanDeep }}>History →</Link>
      </header>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 28px 80px' }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, color: T.cyanDeep, letterSpacing: '0.18em', marginBottom: 12 }}>
          NEW PROJECT
        </div>
        <h1 style={{ fontFamily: T.serif, fontSize: 38, margin: 0, fontWeight: 400 }}>
          Reconcile a drawing against an ETABS model
        </h1>
        <p style={{ fontSize: 15.5, color: T.muted, marginTop: 12, lineHeight: 1.55 }}>
          Upload the ETABS model and the GFC drawing. We extract columns, names, walls and beams,
          then the engine maps them so you can confirm matches and flag discrepancies.
        </p>

        {stage === 'working' ? (
          <Working msg={msg} />
        ) : (
          <div style={{ marginTop: 28 }}>
            <Field label="Project name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gwalior Hospital ULS"
                style={inputStyle} />
            </Field>
            <Field label="Your email">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@firm.com"
                style={{ ...inputStyle, borderColor: email && !emailValid ? '#E11D48' : T.border }} />
            </Field>

            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {SLOTS.map((s) => (
                <FileSlot key={s.kind} slot={s} file={files[s.kind]}
                  onPick={(f) => setFiles((prev) => ({ ...prev, [s.kind]: f }))} />
              ))}
            </div>

            {stage === 'error' && (
              <div style={{ marginTop: 16, padding: '11px 14px', background: 'rgba(225,29,72,0.08)',
                border: '1px solid rgba(225,29,72,0.3)', color: '#BE123C', borderRadius: 10, fontSize: 13.5 }}>
                {msg}
              </div>
            )}

            <button onClick={run} disabled={!ready} style={{ marginTop: 22, padding: '14px 28px', borderRadius: 12,
              border: 'none', background: ready ? T.ink : T.sand, color: ready ? T.textD : T.muted,
              fontWeight: 600, fontSize: 15.5, cursor: ready ? 'pointer' : 'not-allowed', fontFamily: T.sans }}>
              Upload &amp; extract →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${T.border}`,
  background: T.panel, color: T.ink, fontSize: 14.5, fontFamily: T.sans, outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <label style={{ display: 'block', fontFamily: T.mono, fontSize: 11, color: T.subtle,
        letterSpacing: '0.06em', marginBottom: 7 }}>{label.toUpperCase()}</label>
      {children}
    </div>
  );
}

function FileSlot({ slot, file, onPick }: {
  slot: { kind: FileKind; label: string; hint: string; accept: string; required: boolean };
  file?: File; onPick: (f: File) => void;
}) {
  // The input is a real, focusable element layered over the slot (opacity 0) so
  // both real clicks and programmatic file-set reliably fire React's onChange —
  // a display:none input can drop the change event in some browsers.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPick(f);
  };
  return (
    <label style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
      background: file ? `${T.cyan}10` : T.panel, border: `1px dashed ${file ? T.cyan : '#D8D2C6'}` }}>
      <input type="file" accept={slot.accept} onChange={onChange}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
      <div style={{ width: 40, height: 40, borderRadius: 9, background: file ? T.cyan : `${T.cyan}1a`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontFamily: T.mono, fontWeight: 700, color: file ? T.navy : T.cyanDeep, fontSize: 13 }}>
        {file ? '✓' : '+'}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {slot.label}{!slot.required && <span style={{ color: T.subtle, fontWeight: 400 }}> · optional</span>}
        </div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>
          {file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : slot.hint}
        </div>
      </div>
    </label>
  );
}

function Working({ msg }: { msg: string }) {
  return (
    <div style={{ marginTop: 40, textAlign: 'center' }}>
      <div style={{ width: 44, height: 44, margin: '0 auto 20px', borderRadius: 999,
        border: `3px solid ${T.cyan}33`, borderTopColor: T.cyan, animation: 'spin 0.9s linear infinite' }} />
      <div style={{ fontFamily: T.serif, fontSize: 22 }}>Processing</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8 }}>{msg}</div>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
