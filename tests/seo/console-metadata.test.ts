// @vitest-environment node
/**
 * The <head> of a console page is mode-aware, and it is not a way around the
 * viewer gate.
 *
 * Demo is unchanged: "Meridian Health" in the descriptions that always carried
 * it. Production is one customer's installation, so the demo wording is dropped
 * from the static metadata of Portfolio, Control catalog and Administration.
 *
 * Metadata for /agents/[id] is resolved separately from the page body and used
 * to run BEFORE the viewer gate, so the agent name (or "Agent not found") in a
 * signed-out visitor's <head> told them which ids exist, contradicting the
 * page's own "first, so an unauthenticated visitor cannot tell which agent ids
 * exist". The metadata now passes the same gate.
 *
 * Every case sets JEEVES_MODE explicitly: unset means production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/domain/types";
import { generateMetadata as portfolioMetadata } from "@/app/(console)/portfolio/page";
import { generateMetadata as controlsMetadata } from "@/app/(console)/controls/page";
import { generateMetadata as adminMetadata } from "@/app/(console)/admin/page";
import { generateMetadata as agentMetadata } from "@/app/(console)/agents/[id]/page";
import { generateMetadata as initiativeMetadata } from "@/app/(console)/initiatives/[slug]/page";

const next = vi.hoisted(() => {
  class Redirected extends Error {
    constructor(readonly url: string) {
      super(`redirect:${url}`);
    }
  }
  return { Redirected, headers: new Headers() };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => next.headers,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new next.Redirected(url);
  },
  notFound: (): never => {
    throw new Error("not-found");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Production has no session type yet; a signed-in viewer is stood in here.
const session = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/lib/services/route-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/route-guard")>()),
  resolveSession: async () => ({ actor: session.actor, workspaceId: session.actor ? "ws_org_0123456789" : null }),
}));

// The initiative page resolves its detail through the data layer.
vi.mock("@/app/_lib/data-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/_lib/data-provider")>()),
  getInitiativeDetailCoherent: async () => ({
    summary: { title: "Member Chat Copilot", tier: "high", state: "deployed" },
  }),
}));

beforeEach(() => {
  next.headers = new Headers();
  session.actor = null;
});
afterEach(() => vi.unstubAllEnvs());

const DEMO_WORDING = /meridian|fictional|synthetic|demo/i;
const text = (m: { title?: unknown; description?: unknown }) => `${String(m.title)} | ${String(m.description)}`;

describe.each([
  ["Portfolio", portfolioMetadata, "Portfolio", "Every Meridian Health AI initiative"],
  ["Control catalog", controlsMetadata, "Control catalog", "Every governance control Meridian Health enforces"],
  ["Administration", adminMetadata, "Administration", "AI governance demo"],
] as const)("%s metadata", (_name, generateMetadata, title, demoWording) => {
  it("is unchanged in demo", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(title);
    expect(String(metadata.description)).toContain(demoWording);
  });

  it("drops the demo wording in production and keeps the title", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const metadata = await generateMetadata();
    expect(metadata.title).toBe(title);
    expect(text(metadata)).not.toMatch(DEMO_WORDING);
    expect(String(metadata.description).length).toBeGreaterThan(20);
  });

  it("drops it when the mode is mistyped, too", async () => {
    vi.stubEnv("JEEVES_MODE", "Demo");
    expect(text(await generateMetadata())).not.toMatch(DEMO_WORDING);
  });
});

describe("Administration metadata keeps its separation-of-duties statement in production", () => {
  it("still says Admin never approves, signs or returns", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    expect(String((await adminMetadata()).description)).toMatch(/never approves, signs, or returns/);
  });
});

describe("/agents/[id] metadata", () => {
  const known = { params: Promise.resolve({ id: "reviewer-privacy-hipaa" }) };
  const unknown = { params: Promise.resolve({ id: "no-such-agent" }) };

  describe("in production", () => {
    beforeEach(() => vi.stubEnv("JEEVES_MODE", undefined));

    it.each([["a known id", known], ["an unknown id", unknown]])(
      "sends a signed-out visitor to sign-in for %s, so the head cannot say which ids exist",
      async (_label, props) => {
        await expect(agentMetadata(props)).rejects.toMatchObject({ url: "/sign-in" });
      },
    );

    it("gives a signed-in viewer the agent's own title", async () => {
      session.actor = { id: "mei-chen", role: "program" };
      next.headers = new Headers({ cookie: "jeeves_session=page-token" });
      const metadata = await agentMetadata(known);
      expect(metadata.title).toBe("Privacy / HIPAA Review Agent");
    });
  });

  describe("in demo", () => {
    beforeEach(() => vi.stubEnv("JEEVES_MODE", "demo"));

    it("is unchanged for an anonymous visitor: the agent's name, or 'Agent not found'", async () => {
      expect((await agentMetadata(known)).title).toBe("Privacy / HIPAA Review Agent");
      expect(await agentMetadata(unknown)).toEqual({
        title: "Agent not found",
        description: "No such governance agent.",
      });
    });
  });
});

describe("/initiatives/[slug] metadata", () => {
  it("keeps 'Synthetic demo data.' in demo", async () => {
    vi.stubEnv("JEEVES_MODE", "demo");
    expect(String((await initiativeMetadata({ params: Promise.resolve({ slug: "member-chat-copilot" }) })).description)).toContain(
      "Synthetic demo data.",
    );
  });

  it("drops it in production", async () => {
    vi.stubEnv("JEEVES_MODE", undefined);
    const metadata = await initiativeMetadata({ params: Promise.resolve({ slug: "member-chat-copilot" }) });
    expect(text(metadata)).toContain("Member Chat Copilot");
    expect(text(metadata)).not.toMatch(DEMO_WORDING);
  });
});
