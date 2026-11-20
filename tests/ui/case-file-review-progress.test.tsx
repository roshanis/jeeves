import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { MockDataProvider } from "@/lib/data/mock-provider";
import type { InitiativeDetail, InitiativeSummary } from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { InitiativeTable } from "@/components/jeeves/initiative-table";
import InitiativeDetailPage from "@/app/(console)/initiatives/[slug]/page";

const data = vi.hoisted(() => ({ detail: null as InitiativeDetail | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/initiatives/untriaged",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/app/_lib/data-provider", () => ({ getInitiativeDetailCoherent: async () => data.detail }));

beforeEach(async () => {
  const sample = await new MockDataProvider().getInitiativeDetail("member-chat-copilot");
  data.detail = {
    ...sample!,
    summary: { ...sample!.summary, state: "submitted", slug: "untriaged", domainsRequired: 0, domainsSigned: 0 },
    reviews: [], controls: [], events: [],
  };
});

describe("review progress before triage", () => {
  it("says 'Not triaged yet' in the case-file strip and Overview, not 'No required domains' or '0/0 signed'", async () => {
    renderWithProviders(await InitiativeDetailPage({ params: Promise.resolve({ slug: "untriaged" }), searchParams: Promise.resolve({}) }));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/No required domains|0\/0 signed/);
    expect(text).toMatch(/Not triaged yet/);
    fireEvent.click(screen.getByRole("tab", { name: /^Overview$/ }));
    expect(document.body.textContent).not.toMatch(/0\/0 signed/);
  });

  it("the table shows 'Not triaged yet' and sorts untriaged rows after signed ones", () => {
    const row = (slug: string, state: LifecycleState, req: number, signed: number): InitiativeSummary => ({
      ...data.detail!.summary, slug, title: slug, state, domainsRequired: req, domainsSigned: signed, domainsAbstained: 0,
    });
    renderWithProviders(<InitiativeTable initiatives={[row("untriaged-one", "intake_draft", 0, 0), row("signed-one", "approved", 4, 4)]} caption="t" />);
    expect(document.body.textContent).not.toMatch(/0\/0 signed/);
    expect(document.body.textContent).toMatch(/Not triaged yet/);
    fireEvent.click(screen.getByRole("button", { name: /Reviews/ }));
    const titles = screen.getAllByRole("link").map((a) => a.textContent);
    expect(titles).toEqual(["signed-one", "untriaged-one"]);
  });
});
