import { afterEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { InitiativeAgeCell, QueueAgeCell, QueueAgingBadge, useClientNow } from "@/components/jeeves/queue-age";

function Probe({ updatedAt, state = "in_review" }: { updatedAt: string; state?: "in_review" | "in_qc" }) {
  const nowMs = useClientNow();
  return <InitiativeAgeCell updatedAt={updatedAt} state={state} nowMs={nowMs} />;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("queue age clock", () => {
  it("advances while the page stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
    renderWithProviders(<Probe updatedAt="2026-11-01T11:55:00.000Z" />);
    const before = screen.getByText(/\d/).textContent;
    act(() => {
      vi.advanceTimersByTime(6 * 24 * 3600 * 1000);
    });
    const after = screen.getByText(/\d/).textContent;
    expect(after).not.toBe(before);
  });

  it("a consumer mounted later does not leave earlier ones on a stale 'now'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
    renderWithProviders(<div data-testid="a"><Probe updatedAt="2026-11-01T11:00:00.000Z" /></div>);
    const text = (id: string) => screen.getByTestId(id).textContent;
    const before = text("a");
    vi.setSystemTime(new Date("2026-11-01T14:00:00.000Z"));
    renderWithProviders(<div data-testid="b"><Probe updatedAt="2026-11-01T11:00:00.000Z" /></div>);
    expect(text("b")).not.toBe(before);
    expect(text("a")).toBe(text("b"));
  });

  it("tooltips use UTC timestamps and read '<State label> since <timestamp>'", () => {
    const now = Date.parse("2026-11-15T12:00:00.000Z");
    renderWithProviders(
      <>
        <InitiativeAgeCell updatedAt="2026-11-01T11:55:00.000Z" state="in_review" nowMs={now} />
        <QueueAgeCell createdAt="2026-11-01T11:55:00.000Z" status="pending" nowMs={now} />
      </>,
    );
    expect(screen.getByTitle("In Review since 2026-11-01 11:55 UTC")).toBeDefined();
    expect(screen.getByTitle("In queue since 2026-11-01 11:55 UTC")).toBeDefined();
  });

  it("tooltip shows the lifecycle label, not the raw state code", () => {
    renderWithProviders(<Probe updatedAt="2026-11-01T11:55:00.000Z" state="in_qc" />);
    const title = document.querySelector("[title]")?.getAttribute("title") ?? "";
    expect(title).not.toContain("in_qc");
  });

  it("exposes the SLA bucket as text, not only as colour", () => {
    const now = Date.parse("2026-11-15T12:00:00.000Z");
    const twelveDays = 12 * 24 * 3600 * 1000;
    const { container } = renderWithProviders(
      <>
        <QueueAgeCell createdAt={new Date(now - twelveDays).toISOString()} status="pending" nowMs={now} />
        <QueueAgingBadge ageMs={twelveDays} />
        <InitiativeAgeCell updatedAt={new Date(now - twelveDays).toISOString()} state="in_review" nowMs={now} />
      </>,
    );
    const hits = container.textContent!.match(/overdue/g) ?? [];
    expect(hits).toHaveLength(3);
  });
});
