import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GlobalError from "@/app/global-error";

describe("app/global-error", () => {
  it("shows digest-only copy, never the error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("postgres://user:secret@host/db"), { digest: "abc123" });
    render(<GlobalError error={error} reset={() => {}} />);
    expect(screen.getByText(/abc123/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret");
  });
});
