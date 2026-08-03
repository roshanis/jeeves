import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import {
  RoleAwareInbox,
  type DomainReviewRow,
} from "@/components/jeeves/role-aware-inbox";
import { useRole } from "@/components/jeeves/role-context";
import type { InitiativeSummary } from "@/lib/data/dto";
import type { OverlayFlags } from "@/lib/domain/types";

const OLD = "2020-01-01T00:00:00.000Z"; // far past -> "overdue"

/** Flips the active persona so we can render a specific role's Inbox view. */
function PersonaHarness({ personaKey, children }: { personaKey: string; children: ReactNode }) {
  const { setPersonaKey } = useRole();
  return (
    <>
      <button onClick={() => setPersonaKey(personaKey)}>switch-persona</button>
      {children}
    </>
  );
}

const domainReviews: DomainReviewRow[] = [
  {
    slug: "prior-auth-summarizer",
    title: "Prior-Auth Summarizer",
    tier: "high",
    state: "in_review",
    reviews: [{ domain: "privacy-hipaa", status: "drafted", createdAt: OLD }],
  },
];

const baseProps = {
  initiatives: [],
  recentDecisions: [],
  alerts: [],
  incidentCount: 0,
  counts: { inReview: 0, slaBreaches: 0, reassessing: 0, deployed: 0 },
  domainReviews,
  controls: [],
  evalBreaches: [],
};

const NO_OP_FLAGS: OverlayFlags = {
  phi: false,
  memberFacing: false,
  careCoverageInfluence: false,
  vendorHosted: false,
  humanInLoop: true,
  individualImpact: false,
};

/** An initiative that is BOTH in the "needs attention" table (state
 * "in_review") and passed as an operational alert — the scenario where the
 * OperationalAlertsCard's de-dup drops every alert because the table already
 * shows it. */
function makeDedupedAlert(slug: string): InitiativeSummary {
  return {
    slug,
    title: `Deduped initiative ${slug}`,
    tier: "high",
    state: "in_review",
    flags: NO_OP_FLAGS,
    requester: "Priya Raman",
    accountableApprover: null,
    domainsRequired: 4,
    domainsSigned: 2,
    overdue: false,
    storyline: "in review",
  };
}

describe("Role-aware Inbox reviewer queue aging", () => {
  it("shows an Age column and a per-queue aging pill for the reviewer's domain queue", () => {
    renderWithProviders(
      // marcus-webb owns privacy-hipaa.
      <PersonaHarness personaKey="marcus-webb">
        <RoleAwareInbox {...baseProps} />
      </PersonaHarness>,
    );

    // Switch to the reviewer persona so the domain-scoped queue renders.
    fireEvent.click(screen.getByText("switch-persona"));

    // Age column header is present in the reviewer's queue table.
    expect(screen.getByText("Age")).toBeDefined();

    // The drafted (unsigned) review shows a per-row waiting-age badge...
    const ageCells = screen.getAllByTitle(/In queue since/);
    expect(ageCells).toHaveLength(1);
    expect(ageCells[0].textContent).toMatch(/\d+d/);

    // ...and the queue header shows the oldest-waiting aging pill.
    const oldest = screen.getAllByTitle("Oldest review waiting in this queue");
    expect(oldest.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Role-aware Inbox status band severity treatment", () => {
  it("marks a problem-valued segment severe and leaves a zero-valued one quiet", () => {
    // Default "program" role — no persona switch needed.
    renderWithProviders(
      <RoleAwareInbox
        {...baseProps}
        counts={{ inReview: 2, slaBreaches: 3, reassessing: 0, deployed: 5 }}
      />,
    );

    // "SLA breaches" is a warn-toned metric with a nonzero value: it must
    // carry the severity treatment.
    const slaSegment = screen.getByText("SLA breaches").closest('[data-slot="status-segment"]');
    expect(slaSegment).not.toBeNull();
    expect(slaSegment?.getAttribute("data-severity")).toBe("warn");

    // "Paused / reassessing" is an alert-toned metric but its value is 0 —
    // zero of a bad thing is good news, so it must stay visually quiet.
    const pausedSegment = screen
      .getByText("Paused / reassessing")
      .closest('[data-slot="status-segment"]');
    expect(pausedSegment).not.toBeNull();
    expect(pausedSegment?.getAttribute("data-severity")).toBe("none");
  });
});

describe("Role-aware Inbox operational alerts card — fully de-duped state", () => {
  it("replaces the lonely placeholder sentence with a mono readout pointing at the table, and never claims zero alerts", () => {
    const alert = makeDedupedAlert("acme-triage-bot");

    renderWithProviders(
      <RoleAwareInbox
        {...baseProps}
        initiatives={[alert]}
        alerts={[alert]}
      />,
    );

    // The old placeholder sentence must be gone.
    expect(screen.queryByText(/already listed in the table\.$/)).toBeNull();

    // The new summary carries the real count (1) and points at the table —
    // it must never read as "no alerts".
    const summary = document.querySelector('[data-slot="operational-alerts-summary"]');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toMatch(/1/);
    expect(summary?.textContent?.toLowerCase()).toMatch(/table/);
    expect(summary?.textContent?.toLowerCase()).not.toMatch(/no (active )?alerts/);
  });

  it("pluralizes correctly when more than one alert is fully de-duped", () => {
    const alertA = makeDedupedAlert("acme-triage-bot");
    const alertB = makeDedupedAlert("beta-claims-summarizer");

    renderWithProviders(
      <RoleAwareInbox
        {...baseProps}
        initiatives={[alertA, alertB]}
        alerts={[alertA, alertB]}
      />,
    );

    const summary = document.querySelector('[data-slot="operational-alerts-summary"]');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toMatch(/2/);
    expect(summary?.textContent).toMatch(/alerts in the table/);
  });
});

describe("Role-aware Inbox rail section headings", () => {
  it("renders the 'Operational alerts' and 'Recent decisions' rail titles as real (level 2) headings", () => {
    renderWithProviders(<RoleAwareInbox {...baseProps} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Operational alerts" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "Recent decisions" }),
    ).toBeDefined();

    // The page's primary heading must remain untouched by this change.
    expect(
      screen.getByRole("heading", { name: /what needs attention/i }),
    ).toBeDefined();
  });
});
