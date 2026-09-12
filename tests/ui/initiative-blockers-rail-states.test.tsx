import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { InitiativeBlockersRail } from "@/components/jeeves/initiative-blockers-rail";
import type {
  ControlRow,
  InitiativeDetail,
  InitiativeSummary,
  ReviewRow,
} from "@/lib/data/dto";
import type { LifecycleState } from "@/lib/domain/types";
import { renderWithProviders } from "./helpers";

/**
 * Lifecycle-awareness tests for the blockers rail.
 *
 * The rail used to derive everything from `detail.reviews` and
 * `detail.controls` alone, so BOTH empty arrays collapsed to an all-clear.
 * But review rows only exist after
 * triage() writes them, and effective controls only exist after a decision
 * generates them — so an initiative still in intake, or one that was
 * rejected, has neither and was told it was in the clear. Measured against
 * the seeded dataset via the DB provider: prior-auth-summarizer (Critical,
 * intake_draft) and social-sentiment-miner (rejected) both rendered the
 * all-clear copy.
 *
 * These fixtures are hand-built rather than taken from getProvider(),
 * deliberately: the MOCK provider synthesizes pending reviews and controls
 * even for intake_draft, so it cannot reproduce the bug at all. That
 * divergence is why the existing rail test passed while the live app was
 * wrong.
 */

const ISO = "2026-07-01T00:00:00Z";

function summary(overrides: Partial<InitiativeSummary> = {}): InitiativeSummary {
  return {
    slug: "fixture-initiative",
    title: "Fixture Initiative",
    tier: "critical",
    state: "intake_draft",
    flags: {
      phi: true,
      memberFacing: true,
      careCoverageInfluence: true,
      vendorHosted: false,
      humanInLoop: false,
      individualImpact: true,
    },
    requester: "Priya Raman",
    accountableApprover: null,
    domainsRequired: 0,
    domainsSigned: 0,
    overdue: false,
    storyline: "",
    ...overrides,
  };
}

function detailFor(
  state: LifecycleState,
  overrides: Partial<InitiativeDetail> = {},
): InitiativeDetail {
  const base: InitiativeDetail = {
    summary: summary({ state }),
    intake: { version: 1, submitted: false, fields: {}, missing: [] },
    reviews: [],
    decisions: [],
    controls: [],
    telemetry: [],
    deployments: [],
    events: [],
  };
  // `state` always wins over an overridden summary — the whole point of these
  // fixtures is pinning the lifecycle state.
  return {
    ...base,
    ...overrides,
    summary: { ...(overrides.summary ?? base.summary), state },
  };
}

function review(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    domain: "legal",
    status: "pending",
    reviewer: null,
    createdAt: ISO,
    signedAt: null,
    draftMd: null,
    citations: [],
    ...overrides,
  };
}

function control(overrides: Partial<ControlRow> = {}): ControlRow {
  return {
    id: "H-01",
    name: "PHI minimization attested",
    domain: "privacy-hipaa",
    status: "met",
    policySource: "MP-H v3",
    threshold: null,
    evidence: "evidence://attestation",
    ...overrides,
  };
}

const ALL_CLEAR = /no blockers recorded in the current reviews and controls/i;
const EVIDENCE_ALL_CLEAR = /no missing evidence flagged in the current controls/i;

describe("InitiativeBlockersRail — never claims all-clear before anything is required", () => {
  it("does not claim reviews are signed for an initiative still in intake", () => {
    renderWithProviders(<InitiativeBlockersRail detail={detailFor("intake_draft")} />);

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.queryByText(EVIDENCE_ALL_CLEAR)).toBeNull();
    expect(screen.getByText(/not yet submitted/i)).toBeDefined();
  });

  it("says a submitted initiative is awaiting QC rather than clear", () => {
    renderWithProviders(<InitiativeBlockersRail detail={detailFor("submitted")} />);

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    // Not "awaiting triage": a submitted intake waits on a person now, and
    // saying so is the difference between a queue and a black hole.
    expect(screen.getByText(/awaiting qc/i)).toBeDefined();
  });

  it("says an in-QC initiative is being checked rather than clear", () => {
    renderWithProviders(<InitiativeBlockersRail detail={detailFor("in_qc")} />);

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.getByText(/in qc/i)).toBeDefined();
  });

  it("does not claim a rejected initiative is clear", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("rejected", {
          reviews: [review({ status: "signed", signedAt: ISO })],
        })}
      />,
    );

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.getByText(/rejected/i)).toBeDefined();
  });

  it("does not claim a retired initiative is clear", () => {
    renderWithProviders(<InitiativeBlockersRail detail={detailFor("retired")} />);

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.getByText(/retired/i)).toBeDefined();
  });

  it("does not claim evidence is on file before any control has been issued", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("approved", {
          reviews: [review({ status: "signed", signedAt: ISO })],
          summary: summary({ state: "approved", domainsRequired: 1, domainsSigned: 1 }),
        })}
      />,
    );

    expect(screen.queryByText(EVIDENCE_ALL_CLEAR)).toBeNull();
    expect(screen.getByText(/no controls issued yet/i)).toBeDefined();
  });
});

// The all-clear copy is deliberately hedged ("recorded in the current reviews
// and controls") rather than asserting every REQUIRED review is signed —
// PR #7's wording, kept in the merge because this branch never compares the
// rows it sees against summary.domainsRequired.
describe("InitiativeBlockersRail — still reports a genuine all-clear", () => {
  it("reports no open blockers for a deployed initiative whose reviews and controls are satisfied", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("deployed", {
          reviews: [review({ status: "signed", signedAt: ISO })],
          controls: [control({ status: "met" })],
          deployments: [{ version: "v1.0", status: "deployed", at: ISO }],
          summary: summary({ state: "deployed", domainsRequired: 1, domainsSigned: 1 }),
        })}
      />,
    );

    expect(screen.getByText(ALL_CLEAR)).toBeDefined();
    expect(screen.getByText(EVIDENCE_ALL_CLEAR)).toBeDefined();
  });
});

describe("InitiativeBlockersRail — existing blocker behaviour is preserved", () => {
  it("still surfaces a pending review as a blocker", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("in_review", { reviews: [review({ status: "pending" })] })}
      />,
    );

    expect(screen.getByText("Review pending: Legal")).toBeDefined();
  });

  it("still surfaces a breached control as a blocker", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("deployed", {
          reviews: [review({ status: "signed", signedAt: ISO })],
          controls: [control({ id: "Q-01", status: "breached" })],
          deployments: [{ version: "v1.0", status: "deployed", at: ISO }],
        })}
      />,
    );

    expect(screen.getByText("Control Q-01: breached")).toBeDefined();
  });

  it("still surfaces a paused deployment as a blocker", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("paused", {
          reviews: [review({ status: "signed", signedAt: ISO })],
          controls: [control({ status: "met" })],
        })}
      />,
    );

    // PR #7 reworded this: a pause is not necessarily an eval-quality breach,
    // so the blocker points at the reason actually recorded rather than
    // asserting a cause.
    expect(
      screen.getByText("Deployment paused — review the recorded reason in Audit"),
    ).toBeDefined();
  });

  it("still lists outstanding evidence when controls exist but lack it", () => {
    renderWithProviders(
      <InitiativeBlockersRail
        detail={detailFor("deployed", {
          reviews: [review({ status: "signed", signedAt: ISO })],
          controls: [control({ id: "H-01", status: "pending", evidence: null })],
          deployments: [{ version: "v1.0", status: "deployed", at: ISO }],
        })}
      />,
    );

    expect(screen.queryByText(EVIDENCE_ALL_CLEAR)).toBeNull();
    expect(screen.getByText("H-01")).toBeDefined();
  });
});
