// @vitest-environment node
import { describe, expect, it } from "vitest";
import { currentControlRevisions } from "./current-revisions";

describe("currentControlRevisions", () => {
  it("keeps the newest revision separately for every deployment and control", () => {
    const rows = [
      { id: "q-old", deploymentId: "dep-a", controlId: "Q-01", version: 1, status: "breached" },
      { id: "q-other", deploymentId: "dep-b", controlId: "Q-01", version: 1, status: "overdue" },
      { id: "q-current", deploymentId: "dep-a", controlId: "Q-01", version: 2, status: "met" },
      { id: "c-current", deploymentId: "dep-a", controlId: "C-01", version: 1, status: "pending" },
    ];
    const original = rows.slice();
    const expected = [rows[3], rows[2], rows[1]];

    expect(currentControlRevisions(rows)).toEqual(expected);
    expect(currentControlRevisions(rows.slice().reverse())).toEqual(expected);
    expect(rows).toEqual(original);
    expect(rows[0].status).toBe("breached"); // History is retained, not rewritten.
  });

  it("breaks equal-version ties by greatest ID independently of input order", () => {
    const a = { id: "ec-a", deploymentId: "dep", controlId: "Q-01", version: 2 };
    const z = { id: "ec-z", deploymentId: "dep", controlId: "Q-01", version: 2 };
    expect(currentControlRevisions([a, z])).toEqual([z]);
    expect(currentControlRevisions([z, a])).toEqual([z]);
  });

  it("returns no current revisions for an empty history", () => {
    expect(currentControlRevisions([])).toEqual([]);
  });
});
