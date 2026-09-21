import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import type { DeploymentRow } from "@/lib/data/dto";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rollback: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: mocks.session }));
vi.mock("@/lib/client/api", async (original) => ({
  ...await original<typeof import("@/lib/client/api")>(),
  rollbackDeployment: mocks.rollback,
}));
import { DeploymentRecovery } from "@/components/jeeves/deployment-recovery";

const session = {
  token: "admin-token", workspaceId: "workspace", expiresAt: Date.now() + 60_000,
  personaKey: "ray-chen", personaLabel: "Ray Chen", role: "admin",
};
const deployments: DeploymentRow[] = [
  { id: "prior", version: "v1.9", status: "retired", at: "2026-06-01T00:00:00Z" },
  { id: "current", version: "v2.0", status: "deployed", at: "2026-09-01T00:00:00Z" },
];

function recovery(rows = deployments) {
  return <DeploymentRecovery initiativeId="case-id" initiativeTitle="Correspondence model" deployments={rows} />;
}
function rollbackButton() {
  return screen.getByRole("button", { name: "Roll back" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReturnValue({ session, logout: mocks.logout });
  mocks.rollback.mockResolvedValue({ fromVersion: "v2.0", toVersion: "v1.9" });
});

describe("persistent deployment recovery", () => {
  it.each(["admin", "approver"])("keeps rollback available to %s without any pending promotion candidate", (role) => {
    mocks.session.mockReturnValue({ session: { ...session, role }, logout: mocks.logout });
    renderWithProviders(recovery());
    expect(screen.getByText("v1.9")).toBeTruthy();
    expect(screen.getByText("v2.0")).toBeTruthy();
    expect(rollbackButton().disabled).toBe(false);
  });

  it.each(["public", "reviewer", "requester"])("keeps history readable and rollback disabled for %s", (role) => {
    mocks.session.mockReturnValue(role === "public" ? null : { session: { ...session, role } });
    renderWithProviders(recovery());
    expect(screen.getByText("Deployment history")).toBeTruthy();
    expect(rollbackButton().disabled).toBe(true);
    fireEvent.click(rollbackButton());
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("keeps shared examples readable but disables rollback for visitor admins", () => {
    renderWithProviders(<DeploymentRecovery initiativeId="shared-case" initiativeTitle="Shared example" deployments={deployments} isSeeded />);
    expect(screen.getByText("Deployment history")).toBeTruthy();
    expect(rollbackButton().disabled).toBe(true);
    expect(screen.getByText(/shared example.*read-only/i)).toBeTruthy();
    fireEvent.click(rollbackButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("requires an isolated workspace before enabling rollback", () => {
    mocks.session.mockReturnValue({ session: { ...session, workspaceId: null }, logout: mocks.logout });
    renderWithProviders(recovery());
    expect(rollbackButton().disabled).toBe(true);
    fireEvent.click(rollbackButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.rollback).not.toHaveBeenCalled();
  });

  it("requires a currently deployed version and an identified retired/paused target", () => {
    const view = renderWithProviders(recovery(deployments.map((row) => ({ ...row, status: "paused" }))));
    expect(rollbackButton().disabled).toBe(true);
    view.rerender(recovery([{ ...deployments[1] }]));
    expect(rollbackButton().disabled).toBe(true);
    view.rerender(recovery(deployments.map((row) => ({ version: row.version, status: row.status, at: row.at }))));
    expect(rollbackButton().disabled).toBe(true);
  });

  it("submits the chosen sibling and trimmed reason through the existing rollback API", async () => {
    renderWithProviders(recovery([
      ...deployments,
      { id: "paused", version: "v1.8", status: "paused", at: "2026-05-01T00:00:00Z" },
      { id: "candidate", version: "v2.1", status: "awaiting_promotion_signoff", at: "2026-09-10T00:00:00Z" },
    ]));
    fireEvent.click(rollbackButton());
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Roll back" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(within(dialog).queryByRole("option", { name: "v2.1" })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: "v2.0" })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Roll back to version (required)"), { target: { value: "paused" } });
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "  Regression in active version.  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.rollback).toHaveBeenCalledWith("admin-token", "case-id", "paused", "Regression in active version."));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });

  it("keeps rollback reachable after refreshed history has no candidates", async () => {
    const view = renderWithProviders(recovery());
    fireEvent.click(rollbackButton());
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Restore prior release." } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    view.rerender(recovery([
      { ...deployments[1], status: "retired" },
      { ...deployments[0], status: "deployed", at: "2026-09-19T00:00:00Z" },
    ]));
    expect(rollbackButton().disabled).toBe(false);
  });

  it("retains the dialog and reason when the server rejects rollback", async () => {
    mocks.rollback.mockRejectedValue(new Error("request failed"));
    renderWithProviders(recovery());
    fireEvent.click(rollbackButton());
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Restore prior release." } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Roll back" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("Restore prior release.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("discards an open confirmation when the authenticated session changes", () => {
    const view = renderWithProviders(recovery());
    fireEvent.click(rollbackButton());
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Old session reason." } });
    mocks.session.mockReturnValue({ session: { ...session, token: "new-token" }, logout: mocks.logout });
    view.rerender(recovery());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(rollbackButton());
    expect((screen.getByLabelText("Reason (required)") as HTMLTextAreaElement).value).toBe("");
    expect(mocks.rollback).not.toHaveBeenCalled();
  });
});
