// Evidence storage ceilings: how many bytes of evidence one workspace, and the
// whole demo database, may hold. Server code only: import it from the evidence
// service, never from components/ or lib/evidence/types.ts (the repository has
// no 'server-only' package, so this is a convention).
//
// Demo: 100 MiB per workspace and 2 GiB overall. Production: no default
// ceiling, because a production install may keep every initiative in one
// workspace and a demo-sized default would cap the whole customer install; the
// workspace ceiling there is opt-in, and the total ceiling is never applied.
// A malformed value never means "unlimited": demo falls back to its default,
// production refuses uploads (fail closed) until the value is fixed.
import { deploymentMode } from '../config/deployment-mode';

export const MIB = 1024 * 1024;
export const DEMO_WORKSPACE_EVIDENCE_MIB = 100;
export const DEMO_TOTAL_EVIDENCE_MIB = 2048;
/** How long an upload waits for the storage lock before answering 503. */
export const EVIDENCE_LOCK_TIMEOUT_MS = 10000;

export type EvidenceStorageLimits = { workspaceBytes: number | null; totalBytes: number | null; demo: boolean; misconfigured: boolean; lockTimeoutMs: number };
export type CeilingSetting = { kind: 'unset' } | { kind: 'none' } | { kind: 'malformed' } | { kind: 'bytes'; bytes: number };

/** Blank is unset, `none` lifts the ceiling, a positive whole number is MiB; anything else is malformed. */
export function parseCeilingMiB(raw: string | undefined): CeilingSetting {
  const value = (raw ?? '').trim();
  if (value === '') return { kind: 'unset' };
  if (value.toLowerCase() === 'none') return { kind: 'none' };
  if (!/^[0-9]+$/.test(value)) return { kind: 'malformed' };
  const bytes = Number(value) * MIB;
  return Number(value) > 0 && Number.isSafeInteger(bytes) ? { kind: 'bytes', bytes } : { kind: 'malformed' };
}

const warned = new Set<string>();
export function resetEvidenceLimitWarningsForTests(): void { warned.clear(); }
function warnMalformed(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.error(`[evidence] ${name} is not a positive whole number of MiB or "none"; see docs/environment-reference.md.`);
}

type Env = Record<string, string | undefined>;
export function evidenceStorageLimits(env: Env = process.env): EvidenceStorageLimits {
  const demo = deploymentMode(env) === 'demo';
  const workspace = parseCeilingMiB(env.JEEVES_EVIDENCE_WORKSPACE_MAX_MIB);
  const total = demo ? parseCeilingMiB(env.JEEVES_EVIDENCE_TOTAL_MAX_MIB) : ({ kind: 'none' } as const);
  if (workspace.kind === 'malformed') warnMalformed('JEEVES_EVIDENCE_WORKSPACE_MAX_MIB');
  if (total.kind === 'malformed') warnMalformed('JEEVES_EVIDENCE_TOTAL_MAX_MIB');
  const pick = (s: CeilingSetting, demoMiB: number): number | null =>
    s.kind === 'bytes' ? s.bytes : s.kind === 'none' ? null : demo ? demoMiB * MIB : null;
  return {
    workspaceBytes: pick(workspace, DEMO_WORKSPACE_EVIDENCE_MIB),
    totalBytes: pick(total, DEMO_TOTAL_EVIDENCE_MIB),
    demo,
    misconfigured: !demo && workspace.kind === 'malformed',
    lockTimeoutMs: EVIDENCE_LOCK_TIMEOUT_MS,
  };
}

/** '2 GiB' for a whole number of GiB, otherwise 'n MiB'. */
export function formatCeiling(bytes: number): string {
  const mib = Math.round(bytes / MIB);
  return mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`;
}
