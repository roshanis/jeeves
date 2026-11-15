import { describe, expect, it } from "vitest";
import { AuditTab } from "@/components/jeeves/audit-tab";
import { DecisionsTab } from "@/components/jeeves/decisions-tab";
import { AuditConsole } from "@/components/jeeves/audit-console";
import { renderWithProviders } from "./helpers";

describe("audit timestamps", () => {
  it("audit timeline shows time of day with UTC in a <time dateTime>", () => {
    const { container } = renderWithProviders(
      <AuditTab events={[{ ts: "2026-09-07T19:05:00.000Z", action: "approve", actor: "A B", actorRole: "approver", detail: "d" } as never]} />,
    );
    const t = container.querySelector("time");
    expect(t?.getAttribute("datetime")).toBe("2026-09-07T19:05:00.000Z");
    expect(t?.textContent).toBe("2026-09-07 19:05 UTC");
  });

  it("audit console event time shows time of day with UTC", () => {
    const results = { "member-facing-phi": [{ slug: "x", title: "X", tier: null, state: "deployed", approver: null, detail: "d", eventTs: "2026-09-07T19:05:00.000Z" }], "approved-by-torres": [], "overdue-controls": [], "q01-control-changes": [] };
    const { container } = renderWithProviders(<AuditConsole results={results} />);
    expect(container.querySelector("time")?.textContent).toBe("2026-09-07 19:05 UTC");
  });

  it("decision date shows time of day with UTC", () => {
    const { container } = renderWithProviders(
      <DecisionsTab slug="x" decisions={[{ type: "approved", approver: "A B", at: "2026-09-07T19:05:00.000Z", conditions: [], citations: [] }]} />,
    );
    expect(container.querySelector("time")?.textContent).toBe("2026-09-07 19:05 UTC");
  });
});
