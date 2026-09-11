import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AuditConsole } from "@/components/jeeves/audit-console";
import { getProvider } from "@/lib/data";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { renderWithProviders } from "./helpers";

/**
 * The audit page fetches all four canned query result sets server-side and
 * passes them in, but the console rendered nothing until a chip was clicked
 * — about 55% of a 1440x900 viewport was empty on arrival, over data that
 * was already in the page payload. Selecting a default costs no extra
 * fetching.
 */

const IDS: CannedAuditQueryId[] = [
  "member-facing-phi",
  "approved-by-torres",
  "overdue-controls",
  "q01-control-changes",
];

async function loadResults(): Promise<Record<CannedAuditQueryId, AuditQueryRow[]>> {
  const provider = getProvider();
  const entries = await Promise.all(
    IDS.map(async (id) => [id, await provider.auditQuery(id)] as const),
  );
  return Object.fromEntries(entries) as Record<CannedAuditQueryId, AuditQueryRow[]>;
}

function emptyResults(): Record<CannedAuditQueryId, AuditQueryRow[]> {
  return Object.fromEntries(IDS.map((id) => [id, []])) as unknown as Record<
    CannedAuditQueryId,
    AuditQueryRow[]
  >;
}

describe("AuditConsole — useful on arrival", () => {
  it("shows results without any interaction", async () => {
    const { container } = renderWithProviders(<AuditConsole results={await loadResults()} />);

    expect(
      container.querySelectorAll('[data-slot="audit-result-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("marks the defaulted chip as pressed so the selection is visible", async () => {
    renderWithProviders(<AuditConsole results={await loadResults()} />);

    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("no longer prompts the user to run a query before showing anything", async () => {
    renderWithProviders(<AuditConsole results={await loadResults()} />);

    expect(screen.queryByText(/run a canned query to see/i)).toBeNull();
    // The explanation line for the defaulted query stands in its place.
    expect(screen.getByText(/^Showing: /)).toBeDefined();
  });

  it("defaults to a query that actually has rows, not merely the first one", async () => {
    const results = await loadResults();
    // Blank out the first query; the default should move on rather than
    // landing the user on an empty table.
    const shuffled = { ...results, "member-facing-phi": [] };

    const { container } = renderWithProviders(<AuditConsole results={shuffled} />);

    expect(
      container.querySelectorAll('[data-slot="audit-result-row"]').length,
    ).toBeGreaterThan(0);
  });

  it("still renders a selection when every query is empty", () => {
    renderWithProviders(<AuditConsole results={emptyResults()} />);

    // An empty dataset is a legitimate state — show the query and its empty
    // result, not a prompt to click something.
    expect(screen.getByText(/no records match this query/i)).toBeDefined();
  });
});
