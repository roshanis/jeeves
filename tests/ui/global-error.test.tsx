import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import GlobalError from "@/app/global-error";

describe("app/global-error", () => {
  afterEach(cleanup);
  it("shows digest-only copy, never the error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("postgres://user:secret@host/db"), { digest: "abc123" });
    render(<GlobalError error={error} reset={() => {}} />);
    expect(screen.getByText(/abc123/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret");
  });

  it("Try again calls retry rather than reset when Next passes retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const reset = vi.fn();
    render(<GlobalError error={new Error("x")} reset={reset} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to reset when retry is absent", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<GlobalError error={new Error("x")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not claim nothing changed; points at the audit log", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GlobalError error={new Error("x")} reset={() => {}} />);
    expect(document.body.textContent).not.toMatch(/Nothing you were looking at was changed/);
    expect(document.body.textContent).toMatch(/audit log/i);
  });
});
