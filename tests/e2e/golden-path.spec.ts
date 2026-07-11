import { test } from "@playwright/test";

// plan.md §8 test 12 — Playwright golden path (required): champion storyline
// steps 1->6 (intake -> triage -> human review/sign-off/conditional approval
// -> versioned effective controls -> synthetic eval-quality breach -> pause
// + reassessment -> audit query). Not implemented yet: the underlying pages
// and API routes this test would drive (intake form, triage, review, admin
// "Run monitor", audit query) don't exist yet per the phase plan (plan.md §9
// P0-P4). Implement this alongside those phases, not before.
test.skip(
  "champion storyline: intake -> triage -> review -> controls -> breach -> audit query",
  async () => {
    // Intentionally left unimplemented.
  },
);
