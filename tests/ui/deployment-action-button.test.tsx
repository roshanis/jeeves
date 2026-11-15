import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { RoleProvider } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";

const mocks = vi.hoisted(() => ({ session: vi.fn(), pause: vi.fn(), resume: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...(await original<typeof import("@/lib/client/api")>()),
  pauseDeployment: mocks.pause,
  resumeDeployment: mocks.resume,
}));
import { DeploymentActionButton, REASSESSMENT_RESUME_REASON } from "@/components/jeeves/deployment-action-button";

const session = {
  token: "admin-token", workspaceId: "workspace", expiresAt: Date.now() + 60_000,
  personaKey: "ray-chen", personaLabel: "Ray Chen", role: "admin",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ session, logout: mocks.logout });
});

describe("DeploymentActionButton", () => {
  it("says the session expired, and keeps the typed reason, when Confirm is pressed after expiry", () => {
    const view = renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="deployed" lifecycleState="deployed" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A long reason typed before expiry" } });
    mocks.session.mockReturnValue({ session: null, logout: mocks.logout });
    view.rerender(
      <DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><DeploymentActionButton title="Model" initiativeId="case" status="deployed" lifecycleState="deployed" /></TooltipProvider></RoleProvider></DeploymentModeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause deployment" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Session expired/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A long reason typed before expiry");
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  it("disables Resume with its reason while the reassessment is open, and never calls the API", () => {
    renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="paused" lifecycleState="re_review" />);
    const button = screen.getByRole("button", { name: "Resume" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("data-live-action")).toBeNull();
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe(REASSESSMENT_RESUME_REASON);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it.each(["approver", "requester"] as const)("tells a %s the reassessment reason, not the role reason, while it is open", (role) => {
    mocks.session.mockReturnValue({ session: { ...session, role }, logout: mocks.logout });
    renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="paused" lifecycleState="re_review" />);
    const button = screen.getByRole("button", { name: "Resume" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe(REASSESSMENT_RESUME_REASON);
  });

  it("keeps Resume admin-only on a manually paused deployment", () => {
    mocks.session.mockReturnValue({ session: { ...session, role: "approver" }, logout: mocks.logout });
    renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="paused" lifecycleState="paused" />);
    const button = screen.getByRole("button", { name: "Resume" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("data-live-action")).toBeNull();
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toMatch(/^Requires the admin role/);
  });

  it("keeps the public session text while a reassessment is open", () => {
    mocks.session.mockReturnValue({ session: { ...session, role: "public" }, logout: mocks.logout });
    renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="paused" lifecycleState="re_review" />);
    const button = screen.getByRole("button", { name: "Resume" });
    expect(document.getElementById(button.getAttribute("aria-describedby")!)!.textContent).toBe("Not available for a real request");
  });

  it.each(["paused", "approved"] as const)("keeps Resume live for a %s initiative", (lifecycleState) => {
    renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="paused" lifecycleState={lifecycleState} />);
    const button = screen.getByRole("button", { name: "Resume" });
    expect(button.getAttribute("data-live-action")).toBe("true");
    fireEvent.click(button);
    expect(screen.getByRole("dialog").textContent).not.toContain("re_review");
  });
});
