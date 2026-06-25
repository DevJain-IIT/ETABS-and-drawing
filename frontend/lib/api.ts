// Backend client for the CivilSpace Rosetta FastAPI service.
// Base URL from NEXT_PUBLIC_API_BASE (Render in prod, localhost in dev).

import type { Contract } from './engine/types';

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8765';

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}
async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.json();
}

export interface ProjectRef { id: string; name: string; status: string; }

export const api = {
  createProject: (name: string, email: string) =>
    jpost<ProjectRef>('/projects', { name, email }),

  listProjects: (email: string) =>
    jget<ProjectRef[]>(`/projects?email=${encodeURIComponent(email)}`),

  async uploadFiles(pid: string, files: Record<string, File>): Promise<{ saved: Record<string, string> }> {
    const fd = new FormData();
    for (const [k, f] of Object.entries(files)) fd.append(k, f, f.name);
    const r = await fetch(`${BASE}/projects/${pid}/files`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`upload -> ${r.status}`);
    return r.json();
  },

  extract: (pid: string) => jpost<Record<string, number | string>>(`/projects/${pid}/extract`, {}),

  pushContract: (pid: string, contract: Contract) =>
    jpost<{ status: string; columns: number }>(`/projects/${pid}/contract`, contract),

  getContract: (pid: string) => jget<Contract>(`/projects/${pid}/contract`),

  saveResults: (pid: string, decisions: unknown) =>
    jpost<{ status: string }>(`/projects/${pid}/results`, decisions),

  warmup: () => fetch(`${BASE}/`).catch(() => {}),

  getPdfUrl: (pid: string, kind: 'gfc_pdf' | 'layout_pdf' | 'floor_pdf' | 'schedule_pdf') =>
    `${BASE}/projects/${pid}/files/${kind}`,
};
