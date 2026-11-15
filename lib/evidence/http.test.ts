import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceError } from './files';
import { evidenceResponseError } from './http';

afterEach(() => vi.restoreAllMocks());

describe('evidenceResponseError', () => {
  it('logs an unexpected error with the requestId it returns, without leaking the message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = evidenceResponseError(new Error('relation "x" does not exist'));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toBe('Evidence is temporarily unavailable. Please try again.');
    expect(JSON.stringify(body)).not.toContain('relation');
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ requestId: body.requestId, errorName: 'Error', errorMessage: 'relation "x" does not exist' }));
  });

  it('does not log an expected EvidenceError', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = evidenceResponseError(new EvidenceError(404, 'Evidence not found.'));
    expect(response.status).toBe(404);
    expect(log).not.toHaveBeenCalled();
  });
});
