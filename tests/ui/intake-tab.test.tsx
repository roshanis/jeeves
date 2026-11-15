import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { IntakeTab } from "@/components/jeeves/intake-tab";
import { MockDataProvider } from "@/lib/data/mock-provider";
import { renderWithProviders } from "./helpers";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { EMPTY_INTAKE_PAYLOAD } from "@/lib/intake/defaults";

const draft = (fields: object, missing: string[]) => ({ version: 1, submitted: false, missing, fields }) as never;

describe("IntakeTab — champion initiative (#1 prior-auth-summarizer)", () => {
  it('shows the "Draft — not yet submitted" state', async () => {
    const detail = await new MockDataProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    expect(detail).not.toBeNull();

    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(screen.getByText("Draft — not yet submitted")).toBeDefined();
  });

  it("flags the missing data-retention answer (completeness gap)", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail(
      "prior-auth-summarizer",
    );
    renderWithProviders(<IntakeTab intake={detail!.intake} />);

    expect(detail!.intake?.missing).toContain("data.retentionIntent");
    expect(screen.getAllByText(/Data retention/).length).toBeGreaterThan(0);
    expect(screen.getByText("Missing")).toBeDefined();
  });

  it("shows why a QC-returned intake came back instead of the generic draft text", async () => {
    const detail = await new MockDataProvider().getInitiativeDetail("prior-auth-summarizer");
    const events = [
      { ts: "2026-09-07T12:00:00Z", actor: "maya-ortiz", actorRole: "program", action: "return_to_requester", detail: "Returned from QC to the requester: Data sources list is empty" },
    ];
    renderWithProviders(<IntakeTab intake={detail!.intake} events={events} />);
    expect(screen.getByText(/Returned from QC/)).toBeDefined();
    expect(screen.getByText(/Data sources list is empty/)).toBeDefined();
    expect(screen.getByText(/maya-ortiz/)).toBeDefined();
  });
});

describe("IntakeTab draft banner and answers", () => {
  it("does not say the intake cannot be submitted when only advisory gaps remain (ui-intake-F12)", () => {
    renderWithProviders(<IntakeTab intake={draft(CHAMPION_PREFILL_PAYLOAD, ["evidenceAttachments"])} summary={{ isSeeded: false } as never} />);
    expect(screen.queryByText(/cannot be submitted/)).toBeNull();
    expect(screen.queryByText(/champion storyline/)).toBeNull();
    expect(screen.getByText(/does not block submitting/)).toBeDefined();
  });

  it("says it cannot be submitted for a blocking gap, using labels (ui-intake-F12)", () => {
    renderWithProviders(<IntakeTab intake={draft(EMPTY_INTAKE_PAYLOAD, ["basics.title"])} />);
    expect(screen.getByText(/missing Title .*cannot be submitted/)).toBeDefined();
  });

  it("renders answers in form order, not stored key order (ui-intake-F13)", () => {
    const shuffled = { data: EMPTY_INTAKE_PAYLOAD.data, overlay: { individualImpact: true, careCoverageInfluence: false, vendorHosted: true, touchesPHI: true, memberFacing: false, humanInTheLoop: true }, basics: EMPTY_INTAKE_PAYLOAD.basics };
    renderWithProviders(<IntakeTab intake={draft(shuffled, [])} />);
    const labels = Array.from(document.querySelectorAll("tbody tr td:first-child")).map((c) => c.textContent ?? "");
    expect(labels[0]).toBe("Title");
    const nums = labels.filter((l) => /^\d\. /.test(l)).map((l) => l[0]);
    expect(nums).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("shows muted Not provided, not a red Missing badge, for a null field that is not a gap (ui-intake-F14)", () => {
    renderWithProviders(<IntakeTab intake={draft(CHAMPION_PREFILL_PAYLOAD, [])} />);
    expect(screen.queryByText("Missing")).toBeNull();
    expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
  });

  it("labels seeded field paths and evidence attachments (ui-intake-F25)", () => {
    const seeded = { overlay: { phi: true, humanInLoop: false }, data: { sourceSystems: ["EHR"] }, evidenceAttachments: [] };
    renderWithProviders(<IntakeTab intake={draft(seeded, [])} />);
    const labels = Array.from(document.querySelectorAll("tbody tr td:first-child")).map((c) => c.textContent ?? "");
    expect(labels.filter((l) => l.includes(".") && !/^\d\. /.test(l) && !/\?$/.test(l))).toEqual([]);
    expect(labels).not.toContain("evidenceAttachments");
  });
});
