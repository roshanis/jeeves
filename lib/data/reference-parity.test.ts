// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { seedDatabase } from "../../scripts/seed";
import { ACTOR_DIRECTORY, reviewerDomainFor } from "../services/actors";
import { LIVE_PERSONAS, domainForPersona } from "../client/personas";
import { DbDataProvider } from "./db-provider";
import { MockDataProvider } from "./mock-provider";
import type { ControlRow, InitiativeSummary } from "./dto";

vi.mock("../db/client", () => ({
  getDb: () => { throw new Error("Parity tests require the injected disposable database"); },
}));

const identityFacts = (row: InitiativeSummary) => ({
  slug: row.slug,
  title: row.title,
  flags: row.flags,
  tier: row.tier,
  requester: row.requester,
});
const controlFacts = (row: ControlRow) => ({
  id: row.id,
  name: row.name,
  domain: row.domain,
  policySource: row.policySource,
  owner: row.owner,
  cadence: row.cadence,
  enforcementMode: row.enforcementMode,
  requiredEvidence: row.requiredEvidence,
  threshold: row.threshold,
});

describe("seeded database and offline fixture reference facts", () => {
  let db: TestDb;
  let stored: DbDataProvider;
  const mock = new MockDataProvider();

  beforeAll(async () => {
    db = await createTestDb();
    await seedDatabase(db);
    stored = new DbDataProvider(db);
  });
  afterAll(async () => { await closeTestDb(db); });

  it("attributes all 12 initiatives to the same requester in both providers", async () => {
    const actual = (await mock.listInitiatives()).map(identityFacts).sort((a, b) => a.slug.localeCompare(b.slug));
    const expected = (await stored.listInitiatives()).map(identityFacts).sort((a, b) => a.slug.localeCompare(b.slug));
    expect(actual).toHaveLength(12);
    expect(actual).toEqual(expected);
  });

  it("shows the same policy definitions, cadence, enforcement, and ownership", async () => {
    const actual = (await mock.controlCatalog()).map(controlFacts).sort((a, b) => a.id.localeCompare(b.id));
    const expected = (await stored.controlCatalog()).map(controlFacts).sort((a, b) => a.id.localeCompare(b.id));
    expect(actual).toHaveLength(17);
    expect(actual).toEqual(expected);
  });

  it.each(["mock", "database"] as const)("attributes %s reviews only to the assigned domain reviewer", async (source) => {
    const details = await (source === "mock" ? mock : stored).listInitiativeDetails();
    for (const detail of details) {
      for (const review of detail.reviews) {
        if (!review.reviewer) continue;
        const actor = Object.values(ACTOR_DIRECTORY).find((entry) => entry.id === review.reviewer || entry.name === review.reviewer);
        expect(actor, `${detail.summary.slug}/${review.domain}: ${review.reviewer}`).toBeDefined();
        expect(actor!.role).toBe("reviewer");
        expect(reviewerDomainFor(actor!.id), `${detail.summary.slug}/${review.domain}`).toBe(review.domain);
      }
    }
  });

  it("uses the same per-review estimate even when several reviews have drafts", async () => {
    const details = await stored.listInitiativeDetails();
    expect(details.flatMap((detail) => detail.reviews).filter((review) => review.draftMd !== null).length).toBeGreaterThan(1);
    expect((await stored.outcomeMetrics()).reviewerHoursSavedPerReview).toBe(4);
    expect((await mock.outcomeMetrics()).reviewerHoursSavedPerReview).toBe(4);
  });

  it("keeps the picker aligned with server identity and domain assignments", () => {
    expect(LIVE_PERSONAS).toHaveLength(Object.keys(ACTOR_DIRECTORY).length);
    for (const persona of LIVE_PERSONAS) {
      const actor = Object.values(ACTOR_DIRECTORY).find((entry) => entry.id === persona.personaKey);
      expect(actor).toMatchObject({ name: persona.label, role: persona.role });
      expect(domainForPersona(persona.personaKey)).toBe(reviewerDomainFor(persona.personaKey));
    }
    expect(new Set(LIVE_PERSONAS.map((p) => domainForPersona(p.personaKey)).filter(Boolean)).size).toBe(8);
  });
});
