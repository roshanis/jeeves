// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoOnlyError, assertDemoMode, demoDoorClosed, demoDoorFallbacks } from "./demo-doors";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demoDoorClosed", () => {
  it("is null in demo, so the route carries on", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(demoDoorClosed()).toBeNull();
  });

  it("is a bare, uncacheable 404 in production", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const res = demoDoorClosed()!;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("assertDemoMode", () => {
  it("returns in demo", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(() => assertDemoMode("persona sessions")).not.toThrow();
  });

  it("throws a typed error naming the door in production", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    try {
      assertDemoMode("persona sessions");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DemoOnlyError);
      expect(error).toBeInstanceOf(Error);
      expect((error as DemoOnlyError).door).toBe("persona sessions");
      expect((error as Error).message).toContain("persona sessions");
    }
  });
});

describe("demoDoorFallbacks", () => {
  const req = new Request("http://localhost/x");

  it("covers every method the route does not implement", () => {
    expect(Object.keys(demoDoorFallbacks("POST")).sort()).toEqual([
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "PATCH",
      "PUT",
    ]);
  });

  // Next derives HEAD from GET on its own; exporting a HEAD would replace that.
  it("leaves HEAD to Next when the route implements GET", () => {
    expect(Object.keys(demoDoorFallbacks("GET")).sort()).toEqual(["DELETE", "OPTIONS", "PATCH", "POST", "PUT"]);
  });

  it("is 404 in production for every method, OPTIONS included", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    for (const handler of Object.values(demoDoorFallbacks("POST"))) {
      const res = handler(req);
      expect(res.status).toBe(404);
      expect(res.headers.get("allow")).toBeNull();
    }
  });

  it("reproduces Next's defaults in demo: empty 405, OPTIONS 204 with an Allow list", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    const post = demoDoorFallbacks("POST");
    const notAllowed = post.PUT(req);
    expect(notAllowed.status).toBe(405);
    expect(await notAllowed.text()).toBe("");

    const options = post.OPTIONS(req);
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("OPTIONS, POST");

    // A GET route also answers HEAD, so Next lists it.
    expect(demoDoorFallbacks("GET").OPTIONS(req).headers.get("allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("decides the mode per request, not when the module loads", () => {
    const post = demoDoorFallbacks("POST");
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(post.PUT(req).status).toBe(405);
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(post.PUT(req).status).toBe(404);
  });
});
