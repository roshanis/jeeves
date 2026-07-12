import { describe, expect, it, afterEach } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  REVIEW_AGENTS,
  GOVERNANCE_AGENTS,
  agentRuntimeStatus,
} from "./registry";
import { reviewerDomainFor, ACTOR_DIRECTORY, type PersonaKey } from "../services/actors";
import type { GovernanceDomain } from "./ports";

const ALL_DOMAINS: GovernanceDomain[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
];

const repoRoot = path.resolve(__dirname, "..", "..");

describe("governance agent registry", () => {
  it("has exactly one review agent per governance domain (all 8)", () => {
    const domains = REVIEW_AGENTS.map((a) => a.domain);
    expect(REVIEW_AGENTS).toHaveLength(8);
    expect(new Set(domains)).toEqual(new Set(ALL_DOMAINS));
    for (const a of REVIEW_AGENTS) {
      expect(a.kind).toBe("reviewer");
      expect(a.capability).toBe("draftReview");
      expect(a.policyId).toBeTruthy();
      expect(a.controlPrefix).toBeTruthy();
    }
  });

  it("binds each named-domain agent to the accountable reviewer from REVIEWER_DOMAIN", () => {
    // Expected inverse of the authoritative reviewer→domain assignment.
    const expected: Partial<Record<GovernanceDomain, PersonaKey>> = {};
    for (const personaKey of Object.keys(ACTOR_DIRECTORY) as PersonaKey[]) {
      const domain = reviewerDomainFor(personaKey);
      if (domain) expected[domain as GovernanceDomain] = personaKey;
    }
    for (const a of REVIEW_AGENTS) {
      const wantPersona = expected[a.domain!] ?? null;
      expect(a.accountablePersona).toBe(wantPersona);
      expect(a.accountablePersonaName).toBe(
        wantPersona ? ACTOR_DIRECTORY[wantPersona].name : null,
      );
    }
  });

  it("points every review agent at an existing on-disk instructions/track file", () => {
    for (const a of REVIEW_AGENTS) {
      expect(existsSync(path.join(repoRoot, a.instructionsPath))).toBe(true);
    }
  });

  it("gives every agent a unique id", () => {
    const ids = GOVERNANCE_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("agentRuntimeStatus", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("reports the deterministic mock adapter when no OPENAI_API_KEY is set", () => {
    delete process.env.OPENAI_API_KEY;
    const status = agentRuntimeStatus();
    expect(status.connected).toBe(false);
    expect(status.adapter).toBe("mock");
  });

  it("reports the OpenAI adapter when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const status = agentRuntimeStatus();
    expect(status.connected).toBe(true);
    expect(status.adapter).toBe("openai");
  });
});
