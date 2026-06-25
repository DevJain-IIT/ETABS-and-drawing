// Verdict semantics — the engineer's decision states (distinct from match
// CONFIDENCE tiers HIGH/MED/LOW, which use a separate cyan ramp in the UI).
// Re-exported so the ported DBR design.tsx (which imports { Verdict }) resolves.
export type Verdict = 'PASS' | 'FLAW' | 'REVIEW' | 'MISSING' | 'NOT_APPLICABLE';
