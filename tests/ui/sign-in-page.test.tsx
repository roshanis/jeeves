// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * /sign-in is where production sends a visitor with no session. Until single
 * sign-on lands it can only say so honestly; in demo there is nothing to sign
 * in to (personas are passwordless), so it forwards to the site root.
 */
const nav = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
    }
  }
  return { Redirected };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new nav.Redirected(url);
  },
}));

import SignInPage, { metadata } from "@/app/sign-in/page";

afterEach(() => vi.unstubAllEnvs());

describe("/sign-in", () => {
  it("in production says single sign-on is not configured and who to ask", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const html = renderToStaticMarkup(<SignInPage />);
    expect(html).toMatch(/single sign-on/i);
    expect(html).toMatch(/not (yet )?configured/i);
    expect(html).toMatch(/administrator/i);
    expect(html).toMatch(/<h1[^>]*>[^<]*sign in/i);
  });

  it("in production offers no way to continue as a demo persona", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const html = renderToStaticMarkup(<SignInPage />);
    expect(html).not.toMatch(/demo|persona|passcode|password/i);
    expect(html).not.toMatch(/<form|<input|<button/i);
  });

  it("in demo forwards to the site root", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(() => SignInPage()).toThrowError(expect.objectContaining({ url: "/" }));
  });

  it("is kept out of search engines", () => {
    expect(metadata).toMatchObject({ title: "Sign in", robots: { index: false, follow: false } });
  });
});
