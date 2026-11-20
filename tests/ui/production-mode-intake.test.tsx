/**
 * The intake form, the evidence tab and the case-file chat/actions bar carry
 * demo wording (fictional payer, "fictional documents only" tick, persona
 * hints). In production none of it renders and the tick does not gate upload;
 * in demo it is unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ live: vi.fn(), optional: vi.fn(), request: vi.fn(), base64: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: mocks.live,
  useLiveSessionOptional: mocks.optional,
}));
vi.mock("@/lib/client/evidence-api", () => ({
  evidenceRequest: mocks.request,
  downloadEvidenceFile: vi.fn(),
  fileBase64: mocks.base64,
}));

import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";
import type { DeploymentMode } from "@/lib/config/deployment-mode";
import { EvidenceTab } from "@/components/jeeves/evidence-tab";
import { IntakeForm } from "@/components/jeeves/intake-form";
import { IntakeChat } from "@/components/jeeves/intake-chat";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DEMO_WORDING = /Meridian|fictional|synthetic|\bdemo\b|demonstration|\bpersonas?\b/i;
const requester = { token: "t", role: "requester", personaLabel: "Priya Raman" };
const evidenceState = { initiativeId: "i", cycleId: "c", canEdit: true, reviewerDomain: null, documents: [], requirements: [], draft: null, latest: null, history: [], usedBytes: 0 };

function inMode(mode: DeploymentMode, ui: React.ReactElement) {
  return render(<DeploymentModeProvider mode={mode}>{ui}</DeploymentModeProvider>);
}

describe("evidence tab by deployment mode", () => {
  function signedIn() {
    const live = { session: { token: "t" }, startDemo: vi.fn(), logout: vi.fn() };
    mocks.optional.mockReturnValue(live);
    mocks.base64.mockResolvedValue("cGRm");
    mocks.request.mockResolvedValue(evidenceState);
  }

  it("production: no demo wording and no fictional-document tick gating the upload", async () => {
    signedIn();
    const { container } = inMode("production", <EvidenceTab slug="x" />);
    fireEvent.change(await screen.findByLabelText("Choose document"), { target: { files: [new File(["pdf"], "a.pdf", { type: "application/pdf" })] } });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("button", { name: "Upload document" }) as HTMLButtonElement).disabled).toBe(false);
    expect(container.textContent).not.toMatch(DEMO_WORDING);
  });

  it("demo: the banner and the tick are unchanged", async () => {
    signedIn();
    inMode("demo", <EvidenceTab slug="x" />);
    fireEvent.change(await screen.findByLabelText("Choose document"), { target: { files: [new File(["pdf"], "a.pdf", { type: "application/pdf" })] } });
    expect(screen.getByText(/Fictional documents only/)).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload document" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("intake form by deployment mode", () => {
  it("production, requester session: no demo wording", () => {
    mocks.live.mockReturnValue({ session: requester, logout: vi.fn(), expired: null, startDemo: vi.fn(), startPublicSession: vi.fn(), pending: false });
    const { container } = inMode("production", <IntakeForm />);
    expect(container.textContent).not.toMatch(DEMO_WORDING);
  });

  it("production, signed out: no demo doors, no demo wording", () => {
    mocks.live.mockReturnValue({ session: null, logout: vi.fn(), expired: null, startDemo: vi.fn(), startPublicSession: vi.fn(), pending: false });
    const { container } = inMode("production", <IntakeForm />);
    expect(container.textContent).not.toMatch(DEMO_WORDING);
    expect(screen.queryByRole("button", { name: /Start the demo|real request/i })).toBeNull();
  });

  it("production, a non-requester role: no persona-picker hint", () => {
    mocks.live.mockReturnValue({ session: { token: "t", role: "approver", personaLabel: "A" }, logout: vi.fn(), expired: null, startDemo: vi.fn(), startPublicSession: vi.fn(), pending: false });
    const { container } = inMode("production", <IntakeForm />);
    expect(container.textContent).not.toMatch(/\bpersonas?\b/i);
  });

  it("the hosting option is the neutral value in every mode", () => {
    mocks.live.mockReturnValue({ session: requester, logout: vi.fn(), expired: null, startDemo: vi.fn(), startPublicSession: vi.fn(), pending: false });
    for (const mode of ["demo", "production"] as const) {
      const { container, unmount } = inMode(mode, <IntakeForm />);
      expect(container.innerHTML).not.toContain("Meridian infra");
      unmount();
    }
  });

  it("demo, signed out: the demo wording is unchanged", () => {
    mocks.live.mockReturnValue({ session: null, logout: vi.fn(), expired: null, startDemo: vi.fn(), startPublicSession: vi.fn(), pending: false });
    inMode("demo", <IntakeForm />);
    expect(screen.getByRole("button", { name: "Start the demo" })).toBeTruthy();
  });
});

describe("intake chat by deployment mode", () => {
  const props = {};
  it("production, public or non-requester session: no company name or persona hint", () => {
    for (const role of ["public", "approver"]) {
      mocks.live.mockReturnValue({ session: { token: "t", role, personaLabel: "A" }, logout: vi.fn() });
      const { container, unmount } = inMode("production", <IntakeChat {...props} />);
      expect(container.textContent).not.toMatch(/Meridian|\bpersonas?\b|\bdemo\b/i);
      unmount();
    }
  });
});
