import { describe, expect, it } from "vitest";
import { GOVERNANCE_AGENTS, AGENT_GUARDRAIL } from "@/lib/agents/registry";
import { renderWithProviders } from "@/tests/ui/helpers";
import AgentDetailPage from "../[id]/page";

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

  it("renders the completeness agent without throwing, via the inline-prompt fallback", async () => {
    const { container } = await renderDetail("completeness");

    expect(container.textContent).toContain("Completeness Check Agent");
    expect(container.textContent).toContain(
      "Flags missing or inconsistent required intake evidence as advisory gaps. Authoritative completeness is deterministic code.",
    );
    expect(container.textContent).toContain(
      "System prompt is defined inline in code (lib/intake/completeness.ts).",
    );
  });

  it("every governance agent id is URL-safe for the dynamic /agents/[id] route", () => {
    for (const agent of GOVERNANCE_AGENTS) {
      expect(agent.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
