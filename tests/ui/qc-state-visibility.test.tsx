// An initiative in QC must stay visible where people act on it.
//
// `in_qc` sits between `submitted` and `triaged`. TypeScript forces every
// exhaustive Record<LifecycleState, …> to handle it, but hand-written state
// SETS get no such check — and two of them had `submitted` and `triaged` but
// not the state between. The Inbox dropped an initiative from its attention
// table exactly while the Program Office needed to pass or return it; and
// evidence was editable before QC and after it, but not during.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";
import type { InitiativeSummary } from "@/lib/data/dto";
import { EVIDENCE_EDITABLE_STATES } from "@/lib/services/evidence-service";

function initiative(slug: string, state: InitiativeSummary["state"]): InitiativeSummary {
  return {
    slug,
    title: slug,
    tier: "high",
    state,
    flags: {
      phi: false,
      memberFacing: false,
      careCoverageInfluence: false,
      vendorHosted: false,
      humanInLoop: true,
      individualImpact: false,
    },
    requester: "Priya Raman",
    accountableApprover: null,
    domainsRequired: 0,
    domainsSigned: 0,
    overdue: false,
    storyline: "in qc",
  };
}

const baseProps = {
  recentDecisions: [],
  alerts: [],
  incidentCount: 0,
  counts: { inReview: 0, slaBreaches: 0, reassessing: 0, deployed: 0 },
  domainReviews: [],
  controls: [],
  evalBreaches: [],
};

describe("in_qc visibility", () => {
  it("keeps an initiative in QC in the Inbox's attention table, beside its neighbours", () => {
    renderWithProviders(
      <RoleAwareInbox
        {...baseProps}
        initiatives={[
          initiative("before-qc", "submitted"),
          initiative("during-qc", "in_qc"),
          initiative("after-qc", "triaged"),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "before-qc" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "during-qc" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "after-qc" })).toBeTruthy();
  });

  it("lets a requester edit evidence during QC, as before and after it", () => {
    expect(EVIDENCE_EDITABLE_STATES.has("submitted")).toBe(true);
    expect(EVIDENCE_EDITABLE_STATES.has("in_qc")).toBe(true);
    expect(EVIDENCE_EDITABLE_STATES.has("triaged")).toBe(true);
  });
});
