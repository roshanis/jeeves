import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/client/session-context", () => ({
  useLiveSession: () => ({ session: { token: "t", role: "requester", personaLabel: "P" }, logout: vi.fn() }),
}));

import { IntakeForm } from "@/components/jeeves/intake-form";

describe("IntakeForm server-capped fields", () => {
  afterEach(cleanup);

  it.each([
    ["Initiative title", 120],
    ["Sponsor organization", 120],
    ["Requester name", 120],
    ["Requester email", 200],
    ["Business problem", 2000],
    ["Who uses it", 200],
    ["Decision it informs", 300],
    ["Vendor name", 120],
    ["Expected benefits", 1000],
    ["Expected harms / risks", 1000],
    ["Rollout plan", 1000],
  ])("%s carries maxlength %i", (label, max) => {
    render(<IntakeForm />);
    expect(screen.getByLabelText(new RegExp("^" + label.replace(/[/]/g, "\\$&"))).getAttribute("maxlength")).toBe(String(max));
  });
});
