import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { IntakeModeToggle } from "@/components/jeeves/intake-mode-toggle";
import { renderWithProviders } from "./helpers";
import { LiveSessionProvider } from "@/lib/client/session-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("IntakeModeToggle", () => {
  it("keeps structured draft answers when switching through chat", () => {
    renderWithProviders(<LiveSessionProvider><IntakeModeToggle /></LiveSessionProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use a sample initiative" }));
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("Prior-Auth Clinical Summarizer");
    fireEvent.click(screen.getByRole("tab", { name: "Chat with intake assistant" }));
    fireEvent.click(screen.getByRole("tab", { name: "Structured form" }));
    expect((screen.getByLabelText("Initiative title") as HTMLInputElement).value).toBe("Prior-Auth Clinical Summarizer");
  });
});
