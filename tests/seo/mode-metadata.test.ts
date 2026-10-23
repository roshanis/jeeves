// @vitest-environment node
/**
 * Everything a crawler, a link preview or a browser tab reads is mode-aware.
 *
 * Demo is unchanged: indexable, "Meridian Health demo" title, the fictional
 * disclaimer in every description. Production drops that wording, tells
 * crawlers to stay away (an installation lives in a customer's own account,
 * behind their sign-in), and takes its origin from the RUNTIME APP_BASE_URL:
 * NEXT_PUBLIC_* values are inlined at build, so one origin would otherwise be
 * baked into every customer's image.
 *
 * Every case sets JEEVES_MODE explicitly: unset means production.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import robots, { dynamic as robotsDynamic } from "@/app/robots";
import sitemap, { dynamic as sitemapDynamic } from "@/app/sitemap";
import manifest, { dynamic as manifestDynamic } from "@/app/manifest";
import { dynamic as ogDynamic } from "@/app/opengraph-image";
import { installBaseUrl, ogCopy, rootMetadata } from "@/lib/config/site-metadata";
import { SITE_URL } from "@/lib/marketing/site-config";

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-mock", className: "" }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function asProduction(baseUrl?: string): void {
  vi.stubEnv("JEEVES_MODE", undefined);
  vi.stubEnv("APP_BASE_URL", baseUrl);
}
function asDemo(): void {
  vi.stubEnv("JEEVES_MODE", "demo");
}

const DEMO_WORDING = /fictional|synthetic|demo|meridian/i;

describe("mode is read per request, never baked at build", () => {
  it.each([
    ["robots.txt", robotsDynamic],
    ["sitemap.xml", sitemapDynamic],
    ["manifest", manifestDynamic],
    ["opengraph-image", ogDynamic],
  ])("%s is force-dynamic", (_name, dynamic) => {
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("robots.txt", () => {
  it("is unchanged in demo", () => {
    asDemo();
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${SITE_URL}/sitemap.xml`,
    });
  });

  it("disallows everything in production and advertises no sitemap", () => {
    asProduction("https://jeeves.acme.example");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("disallows everything when the mode is mistyped", () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("sitemap.xml", () => {
  it("lists the public marketing routes in demo, as before", () => {
    asDemo();
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/frameworks`,
      `${SITE_URL}/frameworks/nist-ai-rmf`,
      `${SITE_URL}/frameworks/eu-ai-act`,
      `${SITE_URL}/pilot`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/terms`,
    ]);
  });

  it("is empty in production: the marketing routes it lists do not exist there", () => {
    asProduction("https://jeeves.acme.example");
    expect(sitemap()).toEqual([]);
  });
});

describe("web app manifest", () => {
  it("keeps the fictional-demo description in demo", () => {
    asDemo();
    expect(manifest()).toMatchObject({
      name: "Jeeves — AI Governance Gateway",
      short_name: "Jeeves",
      description: expect.stringContaining("Fictional demo with synthetic data."),
    });
  });

  it("names the product neutrally in production", () => {
    asProduction();
    const result = manifest();
    expect(result.name).toBe("Jeeves — AI Governance Gateway");
    expect(result.short_name).toBe("Jeeves");
    expect(result.description).toBeTruthy();
    expect(result.description).not.toMatch(DEMO_WORDING);
    expect(result.start_url).toBe("/");
  });
});

describe("link-preview card copy", () => {
  it("keeps the fictional-demo wording in demo", () => {
    expect(ogCopy("demo").alt).toContain("Fictional demo with synthetic data");
    expect(ogCopy("demo").footer).toBe("Fictional demo · synthetic data · no real patient information");
  });

  it("is neutral in production", () => {
    const copy = ogCopy("production");
    expect(copy.alt).toMatch(/AI Governance Gateway/);
    expect(copy.alt).not.toMatch(DEMO_WORDING);
    expect(copy.footer).not.toMatch(DEMO_WORDING);
  });

  it.each([
    ["demo", /Fictional demo with synthetic data/],
    ["production", /^(?!.*(fictional|synthetic|demo))/i],
  ] as const)("the opengraph-image alt export follows the runtime mode (%s)", async (mode, expected) => {
    // `alt` is evaluated when the module loads, so load it afresh under the mode.
    vi.resetModules();
    if (mode === "demo") asDemo();
    else asProduction();
    const { alt } = await import("@/app/opengraph-image");
    expect(alt).toMatch(expected);
  });
});

describe("installBaseUrl", () => {
  it("reads the runtime APP_BASE_URL", () => {
    expect(installBaseUrl({ APP_BASE_URL: "https://jeeves.acme.example" })?.href).toBe("https://jeeves.acme.example/");
  });

  it.each([undefined, "", "   ", "not a url", "http://jeeves.acme.example", "https://user:pw@jeeves.acme.example"])(
    "is null for %j: only a plain https origin is a base URL",
    (value) => {
      expect(installBaseUrl({ APP_BASE_URL: value })).toBeNull();
    },
  );
});

describe("root metadata", () => {
  it("is exactly today's in demo", () => {
    asDemo();
    const metadata = rootMetadata();
    expect(metadata.metadataBase?.href).toBe(new URL(SITE_URL).href);
    expect(metadata.title).toEqual({
      template: "%s · Jeeves",
      default: "Jeeves — AI Governance Gateway (Meridian Health demo)",
    });
    expect(metadata.description).toBe(
      "Fictional demo — synthetic data. AI governance workflow demo for a fictional healthcare payer.",
    );
    expect(metadata.applicationName).toBe("Jeeves");
    expect(metadata.openGraph).toMatchObject({ siteName: "Jeeves", url: SITE_URL });
    expect(metadata.robots).toBeUndefined();
  });

  it("drops the demo wording everywhere in production", () => {
    asProduction("https://jeeves.acme.example");
    const metadata = rootMetadata();
    expect(JSON.stringify({ ...metadata, metadataBase: undefined })).not.toMatch(DEMO_WORDING);
    expect(metadata.title).toEqual({ template: "%s · Jeeves", default: "Jeeves — AI Governance Gateway" });
    expect(metadata.applicationName).toBe("Jeeves");
  });

  it("takes its origin from the runtime APP_BASE_URL in production", () => {
    asProduction("https://jeeves.acme.example");
    const metadata = rootMetadata();
    expect(metadata.metadataBase?.href).toBe("https://jeeves.acme.example/");
    expect(metadata.openGraph).toMatchObject({ url: "https://jeeves.acme.example/" });
  });

  it("omits the base rather than inventing one when APP_BASE_URL is not usable", () => {
    asProduction(undefined);
    const metadata = rootMetadata();
    expect(metadata.metadataBase).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain("localhost");
  });

  it("tells crawlers to stay away in production", () => {
    asProduction("https://jeeves.acme.example");
    expect(rootMetadata().robots).toEqual({ index: false, follow: false });
  });
});

describe("the root layout resolves its metadata per request", () => {
  it("exports generateMetadata and no static metadata, which would freeze the build-time mode", async () => {
    asDemo();
    const layout = await import("@/app/layout");
    expect(typeof layout.generateMetadata).toBe("function");
    expect("metadata" in layout).toBe(false);
  });

  it("follows the mode in effect when it is called", async () => {
    const layout = await import("@/app/layout");

    asDemo();
    expect((await layout.generateMetadata()).description).toMatch(/Fictional demo/);

    asProduction("https://jeeves.acme.example");
    const production = await layout.generateMetadata();
    expect(production.description).not.toMatch(DEMO_WORDING);
    expect(production.metadataBase?.href).toBe("https://jeeves.acme.example/");
  });
});
