import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceError } from './files';
import { evidenceResponseError, readEvidenceJson, MAX_UPLOAD_BODY } from './http';

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

describe('readEvidenceJson', () => {
  const post = (body?: BodyInit | null, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    new Request('http://localhost/api/initiatives/i/evidence', { method: 'POST', headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit);
  const fail = async (req: Request) => readEvidenceJson(req).then(() => null, (e: unknown) => e as EvidenceError);

  it('accepts a body that starts with a byte order mark', async () => {
    await expect(readEvidenceJson(post('\uFEFF' + '{"action":"submit"}'))).resolves.toEqual({ action: 'submit' });
  });

  it('answers a failed body stream 400 without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = post(new ReadableStream({ pull(c) { c.error(new Error('aborted')); } }));
    const err = await fail(req);
    expect(err).toBeInstanceOf(EvidenceError);
    expect(err!.status).toBe(400);
    expect(evidenceResponseError(err).status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects a declared length above the cap with 413', async () => {
    const err = await fail(post('{}', { 'content-type': 'application/json', 'content-length': String(MAX_UPLOAD_BODY + 1) }));
    expect([err!.status, err!.message]).toEqual([413, 'Upload request exceeds the size limit.']);
  });

  it('rejects a streamed body above the cap with 413', async () => {
    const chunk = new Uint8Array(MAX_UPLOAD_BODY + 1).fill(32);
    const err = await fail(post(new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } })));
    expect([err!.status, err!.message]).toEqual([413, 'Upload request exceeds the size limit.']);
  });

  it('rejects a missing body, a wrong type, a NUL and malformed JSON', async () => {
    const none = await fail(post());
    expect([none!.status, none!.message]).toEqual([400, 'Missing request body.']);
    expect((await fail(post('{}', { 'content-type': 'text/plain' })))!.status).toBe(415);
    const nul = await fail(post('{"a":"x\\u0000"}'));
    expect([nul!.status, nul!.message]).toEqual([400, 'Invalid JSON body.']);
    const bad = await fail(post('{nope'));
    expect([bad!.status, bad!.message]).toEqual([400, 'Invalid JSON body.']);
  });
});
