import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { RoleProvider } from "@/components/jeeves/role-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DeploymentModeProvider } from "@/lib/client/deployment-mode-context";

const mocks = vi.hoisted(() => ({ session: vi.fn(), pause: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...(await original<typeof import("@/lib/client/api")>()),
  pauseDeployment: mocks.pause,
}));
import { DeploymentActionButton } from "@/components/jeeves/deployment-action-button";

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
    const view = renderWithProviders(<DeploymentActionButton title="Model" initiativeId="case" status="deployed" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A long reason typed before expiry" } });
    mocks.session.mockReturnValue({ session: null, logout: mocks.logout });
    view.rerender(
      <DeploymentModeProvider mode="demo"><RoleProvider><TooltipProvider><DeploymentActionButton title="Model" initiativeId="case" status="deployed" /></TooltipProvider></RoleProvider></DeploymentModeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pause deployment" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Session expired/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("A long reason typed before expiry");
    expect(mocks.pause).not.toHaveBeenCalled();
  });
});
