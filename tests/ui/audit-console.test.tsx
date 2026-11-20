import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { AuditConsole } from "@/components/jeeves/audit-console";
import { MockDataProvider } from "@/lib/data/mock-provider";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { renderWithProviders } from "./helpers";

async function loadResults(): Promise<Record<CannedAuditQueryId, AuditQueryRow[]>> {
  const provider = new MockDataProvider();
  const ids: CannedAuditQueryId[] = [
    "member-facing-phi",
    "approved-by-torres",
    "overdue-controls",
    "q01-control-changes",
  ];
  const entries = await Promise.all(
    ids.map(async (id) => [id, await provider.auditQuery(id)] as const),
  );
  return Object.fromEntries(entries) as Record<CannedAuditQueryId, AuditQueryRow[]>;
}

describe("AuditConsole", () => {
  it('clicking "member-facing-phi" renders exactly 4 result rows', async () => {
    const results = await loadResults();
    const { container } = renderWithProviders(<AuditConsole results={results} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Member-facing initiatives touching PHI" }),
    );

    const rows = container.querySelectorAll('[data-slot="audit-result-row"]');
    expect(rows).toHaveLength(4);
    for (const slug of [
      "prior-auth-summarizer",
      "social-sentiment-miner",
      "member-chat-copilot",
      "formulary-qa-bot",
    ]) {
      const linked = container.querySelector(`a[href="/initiatives/${slug}?tab=audit"]`);
      expect(linked, `evidence link for ${slug}`).not.toBeNull();
    }
  });

  it('the "q01-control-changes" query returns the single Ray Chen event', async () => {
    const results = await loadResults();
    const { container } = renderWithProviders(<AuditConsole results={results} />);

    fireEvent.click(
      screen.getByRole("button", { name: "What changed on Q-01 and who changed it" }),
    );

    const rows = container.querySelectorAll('[data-slot="audit-result-row"]');
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain("0.10 to 0.08");
    expect(container.textContent).toContain("Q2 quality initiative");
  });

  it('"overdue-controls" returns exactly the 3 overdue initiatives', async () => {
    const results = await loadResults();
    const { container } = renderWithProviders(<AuditConsole results={results} />);

    fireEvent.click(screen.getByRole("button", { name: "Overdue controls" }));

    const rows = container.querySelectorAll('[data-slot="audit-result-row"]');
    expect(rows).toHaveLength(3);
  });
});

describe("AuditConsole by deployment mode", () => {
  it("does not list the fictional-approver query in production", async () => {
    const results = await loadResults();
    const prod = renderWithProviders(<AuditConsole results={results} />, { mode: "production" });
    expect(screen.queryByRole("button", { name: /Angela Torres/ })).toBeNull();
    expect(prod.container.textContent).not.toMatch(/approved by Angela Torres|approver = Angela Torres/);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("lists it in demo", async () => {
    renderWithProviders(<AuditConsole results={await loadResults()} />, { mode: "demo" });
    expect(screen.getByRole("button", { name: "Everything approved by Angela Torres" })).toBeTruthy();
  });
});
