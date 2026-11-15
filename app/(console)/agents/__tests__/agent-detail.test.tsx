import { afterEach, describe, expect, it, vi } from "vitest";
import { GOVERNANCE_AGENTS, AGENT_GUARDRAIL } from "@/lib/agents/registry";
import { renderWithProviders } from "@/tests/ui/helpers";
import AgentDetailPage from "../[id]/page";

// The page is behind the viewer gate (lib/services/require-viewer.ts), which
// reads the request's cookies; a bare call has no request scope. Demo mode
// (the suite default) lets an anonymous visitor through, so stand in for it.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const missing = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/agents/adapter-shared", async (orig) => {
  const actual = await orig<typeof import("@/lib/agents/adapter-shared")>();
  return {
    ...actual,
    readAgentFile: (...a: Parameters<typeof actual.readAgentFile>) => {
      if (missing.on) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return actual.readAgentFile(...a);
    },
  };
});
afterEach(() => { missing.on = false; });

// AgentDetailPage is an async server component (Next 16 passes `params` as a
// Promise). Calling it directly and rendering the resolved JSX exercises the
// real lookup + disk-read logic without needing a running Next server.
async function renderDetail(id: string) {
  const element = await AgentDetailPage({ params: Promise.resolve({ id }) });
  return renderWithProviders(element);
}

describe("AgentDetailPage", () => {
  it("renders a known review agent with its name, track content, and the guardrail", async () => {
    const { container } = await renderDetail("reviewer-privacy-hipaa");

    expect(container.textContent).toContain("Privacy / HIPAA Review Agent");
    // Content pulled straight from agents/reviewer/tracks/privacy-hipaa.md.
    expect(container.textContent).toContain("MP-H");
    expect(container.textContent).toContain(AGENT_GUARDRAIL);
  });

  it("shows both a shared-instructions section and a track-overlay section for review agents", async () => {
    const { container } = await renderDetail("reviewer-privacy-hipaa");

    expect(container.textContent).toContain("Shared reviewer instructions");
    expect(container.textContent).toContain("Domain track overlay");
    // Shared corpus content (agents/reviewer/instructions.md).
    expect(container.textContent).toContain("Citation rules");
  });

  it("says the instructions file is missing, not that the prompt is inline", async () => {
    missing.on = true;
    const { container } = await renderDetail("reviewer-privacy-hipaa");
    expect(container.textContent).toContain("Instructions file not found in this deployment");
    expect(container.textContent).not.toContain("defined inline");
  });

  it("titles the deterministic monitor card as a specification, not a system prompt", async () => {
    const monitor = GOVERNANCE_AGENTS.find((a) => a.kind === "monitor")!;
    const { container } = await renderDetail(monitor.id);
    expect(container.textContent).toContain("Specification (not an LLM prompt)");
    expect(container.textContent).not.toContain("System prompt");
  });

  it("every governance agent id is URL-safe for the dynamic /agents/[id] route", () => {
    for (const agent of GOVERNANCE_AGENTS) {
      expect(agent.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
