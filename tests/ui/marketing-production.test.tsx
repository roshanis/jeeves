// @vitest-environment node
/**
 * The marketing site is the demo's storefront (a fictional payer, a pilot
 * offer, "try the demo"). A production install has none of it: every marketing
 * page answers 404, and the landing page at "/" sends the visitor to the
 * console instead.
 *
 * Next resolves a page's metadata separately from rendering, so each page is
 * checked twice: the page body AND generateMetadata must refuse. Otherwise the
 * 404 would carry the marketing page's title in its <head>. The landing page's
 * metadata redirects rather than 404s, because a notFound() from metadata
 * would win over the page's redirect.
 *
 * Demo renders exactly as before; the existing marketing suites cover that
 * output, and the cases here pin only that nothing refuses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

const nav = vi.hoisted(() => {
  class NotFound extends Error {
    constructor() {
      super("NEXT_NOT_FOUND");
    }
  }
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
    }
  }
  return { NotFound, Redirected };
});
vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw new nav.NotFound();
  },
  redirect: (url: string): never => {
    throw new nav.Redirected(url);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

import { renderToStaticMarkup } from "react-dom/server";
import MarketingLayout from "@/app/(marketing)/layout";
import { RoleProvider } from "@/components/jeeves/role-context";
import { LiveSessionProvider } from "@/lib/client/session-context";
import HomePage, * as homeModule from "@/app/(marketing)/page";
import FrameworksPage, * as frameworksModule from "@/app/(marketing)/frameworks/page";
import EuAiActPage, * as euModule from "@/app/(marketing)/frameworks/eu-ai-act/page";
import NistPage, * as nistModule from "@/app/(marketing)/frameworks/nist-ai-rmf/page";
import PilotPage, * as pilotModule from "@/app/(marketing)/pilot/page";
import PrivacyPage, * as privacyModule from "@/app/(marketing)/privacy/page";
import TermsPage, * as termsModule from "@/app/(marketing)/terms/page";
import ThankYouPage, * as thankYouModule from "@/app/(marketing)/thank-you/page";

afterEach(() => vi.unstubAllEnvs());

type PageModule = { generateMetadata?: () => Metadata | Promise<Metadata> };

const NOT_FOUND_PAGES: [string, () => unknown, PageModule][] = [
  ["/frameworks", () => FrameworksPage(), frameworksModule],
  ["/frameworks/eu-ai-act", () => EuAiActPage(), euModule],
  ["/frameworks/nist-ai-rmf", () => NistPage(), nistModule],
  ["/pilot", () => PilotPage(), pilotModule],
  ["/privacy", () => PrivacyPage(), privacyModule],
  ["/terms", () => TermsPage(), termsModule],
  ["/thank-you", () => ThankYouPage(), thankYouModule],
];

describe("the marketing layout", () => {
  // The server renders the layout BEFORE a page's notFound() or redirect
  // reaches the client, so its chrome would be in the HTML of every probe of a
  // marketing path. Seen live on `next start`: the disclaimer strip, "Try the
  // demo or send a request" and the footer around a "Page not found".
  it("renders no demo chrome in production, only its children", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const html = renderToStaticMarkup(<MarketingLayout><p>child</p></MarketingLayout>);
    expect(html).toBe("<p>child</p>");
  });

  it("keeps the disclaimer strip, the footer and the nav in demo", () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    const html = renderToStaticMarkup(
      <RoleProvider>
        <LiveSessionProvider>
          <MarketingLayout><p>child</p></MarketingLayout>
        </LiveSessionProvider>
      </RoleProvider>,
    );
    expect(html).toContain("Fictional demo — synthetic data");
    expect(html).toContain("Fictional demo. Synthetic data only.");
    expect(html).toContain('href="/pilot"');
    expect(html).toContain("<p>child</p>");
  });
});

describe("marketing pages in production", () => {
  it.each(NOT_FOUND_PAGES)("%s answers 404 from the page", (_path, page) => {
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(page).toThrowError(nav.NotFound);
  });

  it.each(NOT_FOUND_PAGES)("%s answers 404 from its metadata too", async (_path, _page, mod) => {
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(typeof mod.generateMetadata).toBe("function");
    await expect(Promise.resolve().then(() => mod.generateMetadata!())).rejects.toBeInstanceOf(nav.NotFound);
  });

  it("treats a mistyped mode as production", () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    expect(() => PilotPage()).toThrowError(nav.NotFound);
  });
});

describe("the landing page in production", () => {
  it("redirects to the console instead of rendering the storefront", () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(() => HomePage()).toThrowError(expect.objectContaining({ url: "/inbox" }));
  });

  it("redirects from its metadata as well, so a 404 from metadata cannot win over the redirect", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const metadata = (homeModule as PageModule).generateMetadata!;
    await expect(Promise.resolve().then(() => metadata())).rejects.toMatchObject({ url: "/inbox" });
  });
});

describe("marketing pages in demo", () => {
  // Calling a server component returns its element tree; what matters here is
  // that the guard does not fire. The marketing suites render the output.
  it.each(NOT_FOUND_PAGES)("%s does not refuse and keeps its metadata", async (_path, page, mod) => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(page).not.toThrow();
    const metadata = await mod.generateMetadata!();
    expect(metadata.title).toBeTruthy();
    expect(metadata.description).toBeTruthy();
  });

  it("the landing page does not redirect and keeps its absolute title", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(() => HomePage()).not.toThrow();
    const metadata = await (homeModule as PageModule).generateMetadata!();
    expect(metadata.title).toEqual({ absolute: "Jeeves — AI Governance Gateway for health plans" });
  });
});
