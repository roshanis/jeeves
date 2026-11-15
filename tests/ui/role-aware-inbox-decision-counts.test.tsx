import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers";
import { RoleAwareInbox } from "@/components/jeeves/role-aware-inbox";
import { useRole } from "@/components/jeeves/role-context";

function Switch({ personaKey }: { personaKey: string }) {
  const { setPersonaKey } = useRole();
  return <button onClick={() => setPersonaKey(personaKey)}>switch-persona</button>;
}

const approval = (i: number) => ({
  dec: { type: "approved", at: `2026-01-0${i + 1}T00:00:00.000Z` } as never,
  title: `Init ${i}`,
  slug: `init-${i}`,
});

describe("Audit / Leadership decision band", () => {
  it("counts every decision in the portfolio, not just the six shown in the feed", () => {
    renderWithProviders(
      <>
        <Switch personaKey="angela-torres" />
        <RoleAwareInbox
          initiatives={[]}
          recentDecisions={[0, 1, 2, 3, 4, 5].map(approval)}
          decisionCounts={{ approved: 20, conditional: 5, rejected: 5, total: 30 }}
          alerts={[]}
          incidentCount={0}
          counts={{ inReview: 0, slaBreaches: 0, reassessing: 0, deployed: 0 }}
          domainReviews={[]}
          controls={[]}
          evalBreaches={[]}
        />
      </>,
    );
    fireEvent.click(screen.getByText("switch-persona"));
    const rejected = screen.getByText("Rejected", { selector: "*" });
    const segment = rejected.closest("div")!.parentElement!;
    expect(segment.textContent).toContain("5 of 30");
    expect(screen.getByText("20 of 30")).toBeTruthy();
  });
});
