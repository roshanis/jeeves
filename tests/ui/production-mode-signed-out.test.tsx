/**
 * L19: in production the signed-out prompts say "Sign in" (and point at
 * /sign-in) instead of "Start the demo", and the console chrome carries no
 * company name and no persona name. Demo wording is pinned unchanged.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ optional: vi.fn(), live: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.optional, useLiveSession: mocks.live }));
vi.mock("@/lib/client/evidence-api", () => ({ evidenceRequest: vi.fn(), downloadEvidenceFile: vi.fn(), fileBase64: vi.fn() }));

import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import type { DeploymentMode } from "@/lib/config/deployment-mode";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { EvidenceTab } from "@/components/jeeves/evidence-tab";
import { ReviewEvidenceWorkspace } from "@/components/jeeves/review-evidence-workspace";
import { AgentConnectionTest } from "@/components/jeeves/agent-connection-test";
import { IntakeChat } from "@/components/jeeves/intake-chat";
import { IntakeDraftEditor } from "@/components/jeeves/intake-draft-editor";
import { DisableWithTooltip } from "@/components/jeeves/role-gate";
import { RoleProvider } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";
import { signInPrompt, sessionExpiredMessage } from "@/lib/client/mode-copy";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DEMO_WORDING = /Meridian|fictional|synthetic|\bdemo\b|\bpersonas?\b/i;
// The review workspace also says synthetic monitoring charts are not evidence, which is about telemetry, not the demo.
const DEMO_WORDING_NO_SYNTHETIC = /Meridian|fictional|\bdemo\b|\bpersonas?\b/i;

function inMode(mode: DeploymentMode, ui: React.ReactElement) {
  return render(
    <DeploymentModeProvider mode={mode}>
      <RoleProvider>
        <TooltipProvider>{ui}</TooltipProvider>
      </RoleProvider>
    </DeploymentModeProvider>,
  );
}

function signedOut() {
  mocks.optional.mockReturnValue({ session: null, startDemo: vi.fn(), logout: vi.fn() });
  mocks.live.mockReturnValue({ session: null, startDemo: vi.fn(), logout: vi.fn(), pending: false });
}

const SIGNED_OUT: [string, () => React.ReactElement][] = [
  ["evidence tab", () => <EvidenceTab slug="x" />],
  ["review evidence workspace", () => <ReviewEvidenceWorkspace slug="x" domain="legal" citations={[]} reviewStatus="drafted">{() => null}</ReviewEvidenceWorkspace>],
  ["agent connection test", () => <AgentConnectionTest />],
  ["intake chat", () => <IntakeChat />],
  ["intake draft editor", () => <IntakeDraftEditor initiativeId="i" />],
  ["gated action", () => <DisableWithTooltip label="Sign" requiresRole="reviewer" onAction={() => {}} />],
];

describe("signed-out prompts", () => {
  it.each(SIGNED_OUT)("%s: production says Sign in, with no demo wording and no demo button", (name, make) => {
    signedOut();
    const { container } = inMode("production", make());
    expect(container.textContent).not.toMatch(name === "review evidence workspace" ? DEMO_WORDING_NO_SYNTHETIC : DEMO_WORDING);
    expect(screen.queryByRole("button", { name: /start (the )?demo/i })).toBeNull();
  });

  it.each(SIGNED_OUT.slice(0, 2))("%s: production offers a Sign in link to /sign-in", (_name, make) => {
    signedOut();
    inMode("production", make());
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
  });

  it.each(SIGNED_OUT.slice(0, 2))("%s: demo keeps the Start demo button", (_name, make) => {
    signedOut();
    inMode("demo", make());
    expect(screen.getByRole("button", { name: "Start demo" })).toBeTruthy();
  });

  it("copy helper", () => {
    expect(signInPrompt("demo", "try this action")).toBe("Start the demo to try this action");
    expect(signInPrompt("production", "use this action")).toBe("Sign in to use this action");
    expect(sessionExpiredMessage("demo")).toBe("Your session expired. Start the demo again.");
    expect(sessionExpiredMessage("production")).toBe("Your session expired. Sign in again.");
  });
});

describe("inbox by deployment mode", () => {
  const props = {
    initiatives: [], recentDecisions: [], decisionCounts: { approved: 0, conditional: 0, rejected: 0, total: 0 },
    alerts: [], incidentCount: 0, counts: { inReview: 0, slaBreaches: 0, reassessing: 0, deployed: 0 },
    domainReviews: [], controls: [], evalBreaches: [],
  };

  it("production: no company name, no Viewing-as persona strip, no persona names", () => {
    const { container } = inMode("production", <RoleAwareInbox {...props} />);
    expect(container.textContent).not.toMatch(/Meridian|Viewing as/);
    for (const p of DEMO_PERSONAS) expect(container.textContent).not.toContain(p.name);
    expect(container.textContent).toContain("AI governance —");
  });

  it("demo: unchanged", () => {
    const { container } = inMode("demo", <RoleAwareInbox {...props} />);
    expect(container.textContent).toContain("Meridian Health AI governance —");
    expect(container.textContent).toContain("Viewing as");
  });
});
