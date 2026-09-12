import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { getProvider } from "@/lib/data";
import type { InitiativeDetail } from "@/lib/data/dto";
import InitiativeDetailPage from "@/app/(console)/initiatives/[slug]/page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), query: "" }));
const data = vi.hoisted(() => ({ detail: null as InitiativeDetail | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/initiatives/manual-pause",
  useSearchParams: () => new URLSearchParams(navigation.query),
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/app/_lib/data-provider", () => ({
  getInitiativeDetailCoherent: async () => data.detail,
}));

beforeEach(async () => {
  navigation.push.mockReset();
  navigation.query = "";
  const sample = await getProvider().getInitiativeDetail("member-chat-copilot");
  data.detail = {
    ...sample!,
    summary: { ...sample!.summary, state: "paused", slug: "manual-pause" },
    controls: [],
    events: [{ ts: "2026-09-07T12:00:00Z", actor: "ray-chen", actorRole: "admin", action: "pause", detail: "Paused for planned maintenance." }],
  };
});

async function renderPage(tab?: string) {
  renderWithProviders(await InitiativeDetailPage({
    params: Promise.resolve({ slug: "manual-pause" }), searchParams: Promise.resolve({ tab }),
  }));
}

describe("case-file navigation and pause evidence", () => {
  it("shows the recorded manual pause reason without inventing a breach or open cycle", async () => {
    await renderPage();
    const alert = document.querySelector('[data-slot="incident-banner"]')!;
    expect(alert.textContent).toContain("Paused for planned maintenance.");
    expect(alert.textContent).not.toMatch(/eval-quality breach|cycle is open/i);
    expect(document.querySelector('[data-slot="blockers-rail"]')!.textContent).not.toMatch(/eval-quality breach/i);
  });

  it("updates the URL when a tab is selected and preserves unrelated parameters", async () => {
    navigation.query = "source=inbox";
    await renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /^Audit$/ }));
    expect(navigation.push).toHaveBeenCalledWith("/initiatives/manual-pause?source=inbox&tab=audit", { scroll: false });
  });

  it("opens legacy operate links on Evals", async () => {
    navigation.query = "tab=operate";
    await renderPage("operate");
    expect(screen.getByRole("tab", { name: "Evals" }).getAttribute("aria-selected")).toBe("true");
  });
});
