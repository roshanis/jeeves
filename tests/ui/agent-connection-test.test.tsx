import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ test: vi.fn() }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSessionOptional: () => ({ session: { token: "t" }, logout: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ testAgentConnection: mocks.test, isApiError: () => false, apiErrorToMessage: () => "" }));
import { AgentConnectionTest } from "@/components/jeeves/agent-connection-test";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("AgentConnectionTest announcements", () => {
  it("announces the result in a status region", async () => {
    mocks.test.mockResolvedValue({ reachable: true, configured: true, detail: "Connector reachable." });
    render(<AgentConnectionTest />);
    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));
    expect((await screen.findByRole("status")).textContent).toContain("Connector reachable.");
  });
  it("announces a failure as an alert", async () => {
    mocks.test.mockRejectedValue(new Error("boom"));
    render(<AgentConnectionTest />);
    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Connection test failed.");
  });
});
