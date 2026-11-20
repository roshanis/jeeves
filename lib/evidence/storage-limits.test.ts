// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_TOTAL_EVIDENCE_MIB, DEMO_WORKSPACE_EVIDENCE_MIB, EVIDENCE_LOCK_TIMEOUT_MS, MIB, evidenceStorageLimits, formatCeiling, parseCeilingMiB, resetEvidenceLimitWarningsForTests } from './storage-limits';

const WS = 'JEEVES_EVIDENCE_WORKSPACE_MAX_MIB', TOTAL = 'JEEVES_EVIDENCE_TOTAL_MAX_MIB';
const demo = (extra: Record<string, string> = {}) => ({ JEEVES_MODE: 'demo', ...extra });
beforeEach(() => { resetEvidenceLimitWarningsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('parseCeilingMiB', () => {
  it('reads whole MiB, trimmed', () => {
    expect(parseCeilingMiB('250')).toEqual({ kind: 'bytes', bytes: 250 * MIB });
    expect(parseCeilingMiB(' 250 ')).toEqual({ kind: 'bytes', bytes: 250 * MIB });
  });
  it.each(['none', 'NONE', ' None '])('treats %j as no ceiling', (raw) => expect(parseCeilingMiB(raw)).toEqual({ kind: 'none' }));
  it.each([undefined, '', '   '])('treats %j as unset', (raw) => expect(parseCeilingMiB(raw)).toEqual({ kind: 'unset' }));
  it.each(['0', '-5', '1.5', '100MB', '1e3', '0x10', '99999999999999999'])('treats %j as malformed', (raw) => expect(parseCeilingMiB(raw)).toEqual({ kind: 'malformed' }));
});

describe('evidenceStorageLimits', () => {
  it('uses the demo defaults', () => {
    expect(evidenceStorageLimits(demo())).toMatchObject({ workspaceBytes: 104857600, totalBytes: 2147483648, demo: true, misconfigured: false, lockTimeoutMs: EVIDENCE_LOCK_TIMEOUT_MS });
    expect(DEMO_WORKSPACE_EVIDENCE_MIB).toBe(100);
    expect(DEMO_TOTAL_EVIDENCE_MIB).toBe(2048);
  });
  it('has no ceilings in production by default and ignores the total variable there', () => {
    expect(evidenceStorageLimits({})).toMatchObject({ workspaceBytes: null, totalBytes: null, demo: false, misconfigured: false });
    expect(evidenceStorageLimits({ [TOTAL]: '5' })).toMatchObject({ totalBytes: null });
    expect(evidenceStorageLimits({ [WS]: '500' })).toMatchObject({ workspaceBytes: 500 * MIB, totalBytes: null });
  });
  it('lets the operator raise, lower or lift a demo ceiling', () => {
    expect(evidenceStorageLimits(demo({ [WS]: '250', [TOTAL]: 'none' }))).toMatchObject({ workspaceBytes: 250 * MIB, totalBytes: null });
    expect(evidenceStorageLimits(demo({ [WS]: ' ' }))).toMatchObject({ workspaceBytes: 100 * MIB });
  });
  it.each(['0', '-5', '1.5', '100MB', '1e3', '0x10', '99999999999999999'])('falls back to the demo default for malformed %j', (raw) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(evidenceStorageLimits(demo({ [WS]: raw, [TOTAL]: raw }))).toMatchObject({ workspaceBytes: 100 * MIB, totalBytes: 2048 * MIB, misconfigured: false });
    expect(error).toHaveBeenCalled();
  });
  it.each(['0', '-5', '1.5', '100MB', '1e3', '0x10', '99999999999999999'])('marks production misconfigured for malformed %j', (raw) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const limits = evidenceStorageLimits({ [WS]: raw, [TOTAL]: raw });
    expect(limits.misconfigured).toBe(true);
    expect(limits.workspaceBytes).not.toBe(100 * MIB);
    expect(limits.totalBytes).toBeNull();
    expect(error).toHaveBeenCalled();
  });
  it('logs the variable name, never the value, once per process', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    evidenceStorageLimits(demo({ [WS]: 'secretish-value' }));
    evidenceStorageLimits(demo({ [WS]: 'secretish-value' }));
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]![0]);
    expect(line).toContain(WS);
    expect(line).not.toContain('secretish-value');
  });
});

describe('formatCeiling', () => {
  it('prints GiB for whole multiples and MiB otherwise', () => {
    expect(formatCeiling(2048 * MIB)).toBe('2 GiB');
    expect(formatCeiling(100 * MIB)).toBe('100 MiB');
    expect(formatCeiling(1536 * MIB)).toBe('1536 MiB');
  });
});
