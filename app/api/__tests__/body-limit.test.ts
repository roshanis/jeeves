/**
 * Request bodies are authenticated before they are read, and capped while they
 * are read. An anonymous caller must get 401 without the body being consumed;
 * a signed-in caller who sends too much gets 413, even when Content-Length lies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "@/lib/db/test-client";
import { issueDemoSession } from "@/lib/services/route-guard";

let testDb: TestDb;
vi.mock("@/lib/db/client", () => ({ getDb: () => testDb }));

beforeEach(async () => {
  process.env.JEEVES_COOKIE_SECRET = "body-limit-test-secret";
  testDb = await createTestDb();
});

afterEach(async () => {
  await closeTestDb(testDb);
  delete process.env.JEEVES_COOKIE_SECRET;
});

/** A body that reports how much of it was pulled by the reader. */
function trackedBody(totalBytes: number, chunk = 64 * 1024) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= totalBytes) return controller.close();
      state.pulled += chunk;
      controller.enqueue(new Uint8Array(chunk).fill(0x20));
    },
  });
  return { state, stream };
}

function post(url: string, body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers },
    body,
    // @ts-expect-error node fetch requires duplex for stream bodies
    duplex: "half",
  });
}

describe("body is read only after authentication", () => {
  it("answers 401 (not 400) to an anonymous malformed body on chat/auditor", async () => {
    const { POST } = await import("../chat/auditor/route");
    const res = await POST(post("http://localhost/api/chat/auditor", "not json"));
    expect(res.status).toBe(401);
  });

  it("answers 401 to an anonymous empty-object body on qc-return", async () => {
    const { POST } = await import("../initiatives/[id]/qc-return/route");
    const res = await POST(post("http://localhost/api/initiatives/x/qc-return", "{}"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("does not consume an oversized anonymous body", async () => {
    const { POST } = await import("../exceptions/route");
    const { state, stream } = trackedBody(8 * 1024 * 1024);
    const res = await POST(post("http://localhost/api/exceptions", stream));
    expect(res.status).toBe(401);
    expect(state.pulled).toBeLessThanOrEqual(64 * 1024);
  });
});

describe("body size cap for signed-in callers", () => {
  it("answers 413 to an oversized streamed body and stops reading early", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../chat/auditor/route");
    const { state, stream } = trackedBody(8 * 1024 * 1024);
    const res = await POST(
      post("http://localhost/api/chat/auditor", stream, { authorization: `Bearer ${session.token}` }),
    );
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(4 * 1024 * 1024);
  });

  it("answers 413 when Content-Length is declared too large", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../chat/auditor/route");
    const res = await POST(
      post("http://localhost/api/chat/auditor", "{}", {
        authorization: `Bearer ${session.token}`,
        "content-length": String(5 * 1024 * 1024),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("catches a Content-Length that lies about a large body", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../chat/auditor/route");
    const { stream } = trackedBody(3 * 1024 * 1024);
    const res = await POST(
      post("http://localhost/api/chat/auditor", stream, {
        authorization: `Bearer ${session.token}`,
        "content-length": "10",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("keeps 400 for a signed-in malformed body", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../chat/auditor/route");
    const res = await POST(
      post("http://localhost/api/chat/auditor", "not json", { authorization: `Bearer ${session.token}` }),
    );
    expect(res.status).toBe(400);
  });
});

describe("routes that read before a session exists", () => {
  it("caps POST /api/session at a small body", async () => {
    const { POST } = await import("../session/route");
    const res = await POST(
      post("http://localhost/api/session", JSON.stringify({ personaKey: "priya-raman", pad: "x".repeat(40_000) })),
    );
    expect(res.status).toBe(413);
  });

  it("refuses an oversized body on POST /api/initiatives without buffering it", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../initiatives/route");
    const { state, stream } = trackedBody(8 * 1024 * 1024);
    const res = await POST(
      post("http://localhost/api/initiatives", stream, { authorization: `Bearer ${session.token}` }),
    );
    expect(res.status).toBe(413);
    expect(state.pulled).toBeLessThan(1024 * 1024);
  });
});

describe("byte order mark and failed streams", () => {
  const BOM_BODY = "\uFEFF" + '{"a":1}';
  const failingStream = () =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("aborted"));
      },
    });

  it("reads a JSON body that starts with a byte order mark", async () => {
    const { readJsonBody } = await import("@/lib/http/read-json-body");
    expect(await readJsonBody(post("http://localhost/x", BOM_BODY), 1024)).toEqual({ a: 1 });
    expect(await readJsonBody(post("http://localhost/x", BOM_BODY), 1024, { optional: true })).toEqual({ a: 1 });
  });

  it("accepts a byte order mark on POST /api/initiatives", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const { POST } = await import("../initiatives/route");
    const res = await POST(
      post("http://localhost/api/initiatives", BOM_BODY, { authorization: `Bearer ${session.token}` }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).not.toBe("invalid JSON body");
  });

  it("turns a failed body stream into a 400 BodyReadError", async () => {
    const { readBodyText, BodyReadError } = await import("@/lib/http/read-json-body");
    const err = await readBodyText(post("http://localhost/x", failingStream()), 1024).catch((e) => e);
    expect(err).toBeInstanceOf(BodyReadError);
    expect(err.status).toBe(400);
  });

  it("answers 400 (not 413, not a throw) on POST /api/initiatives and a guarded route", async () => {
    const session = (await issueDemoSession("priya-raman"))!;
    const auth = { authorization: `Bearer ${session.token}` };
    const { POST } = await import("../initiatives/route");
    expect((await POST(post("http://localhost/api/initiatives", failingStream(), auth))).status).toBe(400);
    const { POST: chat } = await import("../chat/auditor/route");
    expect((await chat(post("http://localhost/api/chat/auditor", failingStream(), auth))).status).toBe(400);
  });
});
