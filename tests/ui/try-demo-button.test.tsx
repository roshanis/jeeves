import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TryDemoButton } from "@/components/jeeves/try-demo-button";
const { login, push } = vi.hoisted(() => ({ login: vi.fn().mockResolvedValue(undefined), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/session-context", () => ({ useLiveSession: () => ({ login, liveModeAvailable: true, pending: false, startError: null }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Try the demo", () => {
  it("starts a session and opens the existing Meridian Health portfolio", async () => {
    const { getByRole } = render(<TryDemoButton />);
    fireEvent.click(getByRole("button", { name: "Try the demo" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/portfolio"));
    expect(login).toHaveBeenCalledWith("priya-raman");
  });
});
