import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import {
  RoleAwareInbox,
  type DomainReviewRow,
} from "@/components/jeeves/role-aware-inbox";
import { useRole } from "@/components/jeeves/role-context";

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
