import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReviewSelection } from "@/components/jeeves/review-workbench";

const mocks = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/components/jeeves/review-workbench", () => ({
  ReviewWorkbench: ({ selection, onSelectionChange }: {
    selection: ReviewSelection | null;
    onSelectionChange: (selection: ReviewSelection | null) => void;
  }) => <>
    <output>{selection ? `${selection.slug}:${selection.domain}` : "Queue"}</output>
    <button onClick={() => onSelectionChange({ slug: "case two", domain: "legal" })}>Choose legal</button>
    <button onClick={() => onSelectionChange(null)}>Clear selection</button>
  </>,
}));
import { ReviewWorkbenchRoute } from "@/app/(console)/reviews/review-workbench-route";

beforeEach(() => { mocks.search = ""; mocks.push.mockReset(); });
afterEach(cleanup);

describe("review URL selection", () => {
  it("opens the exact shared selection and follows Back/Forward query changes", () => {
    mocks.search = "initiative=case%20one&domain=privacy-hipaa";
    const view = render(<ReviewWorkbenchRoute rows={[]} />);
    expect(screen.getByText("case one:privacy-hipaa")).toBeTruthy();
    mocks.search = "initiative=case-two&domain=legal";
    view.rerender(<ReviewWorkbenchRoute rows={[]} />);
    expect(screen.getByText("case-two:legal")).toBeTruthy();
    mocks.search = "initiative=case%20one&domain=privacy-hipaa";
    view.rerender(<ReviewWorkbenchRoute rows={[]} />);
    expect(screen.getByText("case one:privacy-hipaa")).toBeTruthy();
  });

  it("updates the address without losing unrelated query context", () => {
    mocks.search = "context=incident&initiative=case-one&domain=privacy-hipaa";
    render(<ReviewWorkbenchRoute rows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose legal" }));
    expect(mocks.push).toHaveBeenCalledWith("/reviews?context=incident&initiative=case+two&domain=legal", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/reviews?context=incident", { scroll: false });
  });

  it.each(["initiative=case&domain=invalid", "initiative=case", "domain=legal"])("keeps malformed selection %s on the queue", (query) => {
    mocks.search = query;
    render(<ReviewWorkbenchRoute rows={[]} />);
    expect(screen.getByText("Queue")).toBeTruthy();
  });
});
