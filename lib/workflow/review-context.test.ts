// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, closeTestDb, type TestDb } from "../db/test-client";
import { controlDefinitions, evidenceAssessments, evidenceDocuments, evidencePackets, initiatives, intakeVersions, reviewCycles, riskAssessments } from "../db/schema";
import * as corpus from "../agents/policy-corpus";
import { AgentInitializationError } from "../agents/initialization-error";
import { loadReviewContext } from "./review-context";

let db: TestDb;
const at = new Date("2026-09-19T10:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(initiatives).values({ id: "i", slug: "grounding", title: "Fictional review", requester: "Demo", state: "in_review", createdAt: at, updatedAt: at });
  await db.insert(intakeVersions).values([
    { id: "iv1", initiativeId: "i", version: 1, submitted: true, fields: { useCase: "Pinned intake" }, createdAt: at },
    { id: "iv2", initiativeId: "i", version: 2, fields: { useCase: "New unreviewed intake" }, createdAt: at },
  ]);
  await db.insert(riskAssessments).values({ id: "risk", initiativeId: "i", version: 1, intakeVersionId: "iv1", tier: "high", flags: { phi: true, vendorHosted: false }, requiredDomains: ["privacy-hipaa"], createdAt: at });
  await db.insert(reviewCycles).values({ id: "cycle", initiativeId: "i", kind: "initial", riskAssessmentId: "risk", openedAt: at });
  await db.insert(controlDefinitions).values([
    { id: "H-01", domain: "privacy-hipaa", name: "Privacy assessment", applicability: "PHI=Y", policySource: "MP-H v3 §MP-H-2", owner: "Demo", requiredEvidence: "DPIA", cadence: "once", enforcementMode: "gate" },
    { id: "H-X", domain: "privacy-hipaa", name: "Vendor", applicability: "vendor=Y", owner: "Demo", requiredEvidence: "Vendor evidence", cadence: "once", enforcementMode: "gate" },
    { id: "L-01", domain: "legal", name: "Legal", applicability: "all", owner: "Demo", requiredEvidence: "Legal evidence", cadence: "once", enforcementMode: "gate" },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeTestDb(db);
});

async function submittedEvidence(includeAssessment = true) {
  await db.insert(evidenceDocuments).values([
    { id: "doc1", initiativeId: "i", requestId: "request1", fileName: "source.pdf", mediaType: "application/pdf", byteSize: 21, sha256: "hash-v1", content: Buffer.from("SECRET_DOCUMENT_BYTES"), version: 1, uploadedBy: "Demo", createdAt: at },
    { id: "doc2", initiativeId: "i", requestId: "request2", fileName: "replacement.pdf", mediaType: "application/pdf", byteSize: 17, sha256: "hash-v2", content: Buffer.from("UNSUBMITTED_BYTES"), version: 2, supersedesId: "doc1", uploadedBy: "Demo", createdAt: at },
  ]);
  await db.insert(evidencePackets).values([
    { id: "packet1", initiativeId: "i", cycleId: "cycle", version: 1, revision: 1, status: "submitted", entries: [{ controlId: "H-01", documentId: "doc1", pageReference: "p. 2", note: "Retention" }], submittedBy: "Demo", submittedAt: at, createdAt: at },
    { id: "packet2", initiativeId: "i", cycleId: "cycle", version: 2, revision: 1, status: "draft", entries: [{ controlId: "H-01", documentId: "doc2", pageReference: "p. 8", note: "Unsubmitted" }], createdAt: at },
  ]);
  if (includeAssessment) await db.insert(evidenceAssessments).values({ id: "assessment1", packetId: "packet1", controlId: "H-01", decision: "changes_requested", reason: "Need retention details", reviewer: "Demo reviewer", reviewedAt: at });
}

describe("review grounding", () => {
  it("pins intake to the cycle risk assessment and includes applicable catalog and full policy text", async () => {
    const context = await loadReviewContext(db, "cycle", "privacy-hipaa");
    expect(context.intake.intakeVersionId).toBe("iv1");
    expect(context.intake.answers).toEqual({ useCase: "Pinned intake" });
    const text = context.policyContext.join("\n");
    expect(text).toContain(corpus.readPolicyFileSafe("docs/policies/privacy-hipaa.md"));
    expect(text).toContain('"id":"H-01"');
    expect(text).not.toContain('"id":"H-X"');
    expect(text).not.toContain('"id":"L-01"');
    expect(context.metadata).toMatchObject({ intakeVersionId: "iv1", riskAssessmentId: "risk", evidenceStatus: "unknown-no-submitted-packet" });
    expect(context.metadata.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(context.metadata).not.toHaveProperty("model");
  });

  it("uses the submitted document version and assessment, with no private document bytes or draft entries", async () => {
    await submittedEvidence();
    const context = await loadReviewContext(db, "cycle", "privacy-hipaa");
    const text = context.policyContext.join("\n");
    expect(text).toContain('"documentId":"doc1"');
    expect(text).toContain('"sha256":"hash-v1"');
    expect(text).toContain("Need retention details");
    expect(text).not.toContain("doc2");
    expect(text).not.toContain("SECRET_DOCUMENT_BYTES");
    expect(text).not.toContain("UNSUBMITTED_BYTES");
    expect(context.metadata).toMatchObject({ evidencePacketId: "packet1", evidencePacketVersion: 1, evidencePacketRevision: 1 });
    expect(context.metadata.evidenceDocumentIds).toEqual(["doc1"]);
  });

  it("hashes actual input, policy, catalog and assessment content with deterministic ordering", async () => {
    await submittedEvidence(false);
    const first = await loadReviewContext(db, "cycle", "privacy-hipaa");
    const repeat = await loadReviewContext(db, "cycle", "privacy-hipaa");
    expect(repeat.metadata.contextHash).toBe(first.metadata.contextHash);
    await db.insert(evidenceAssessments).values({ id: "assessment1", packetId: "packet1", controlId: "H-01", decision: "changes_requested", reason: "Need retention details", reviewer: "Demo reviewer", reviewedAt: at });
    const changed = await loadReviewContext(db, "cycle", "privacy-hipaa");
    expect(changed.metadata.contextHash).not.toBe(first.metadata.contextHash);
    const original = corpus.readPolicyFileSafe("docs/policies/privacy-hipaa.md");
    vi.spyOn(corpus, "readPolicyFileSafe").mockReturnValue(`${original}\nPolicy clarification.`);
    const policyChanged = await loadReviewContext(db, "cycle", "privacy-hipaa");
    expect(policyChanged.metadata.contextHash).not.toBe(changed.metadata.contextHash);
    expect(policyChanged.metadata.policyHash).not.toBe(changed.metadata.policyHash);
  });

  it("fails before generation when the cycle or required policy cannot be read", async () => {
    await expect(loadReviewContext(db, "missing", "privacy-hipaa")).rejects.toThrow(/cycle/i);
    vi.spyOn(corpus, "readPolicyFileSafe").mockImplementation(() => { throw new Error("missing policy"); });
    await expect(loadReviewContext(db, "cycle", "privacy-hipaa")).rejects.toThrow(AgentInitializationError);
  });

  it("refuses an empty or truncated domain policy instead of claiming complete grounding", async () => {
    const read = vi.spyOn(corpus, "readPolicyFileSafe").mockReturnValue("");
    await expect(loadReviewContext(db, "cycle", "privacy-hipaa")).rejects.toMatchObject({ name: "AgentInitializationError", cause: expect.objectContaining({ message: expect.stringMatching(/empty/) }) });
    read.mockReturnValue("x".repeat(64 * 1024 + 1));
    await expect(loadReviewContext(db, "cycle", "privacy-hipaa")).rejects.toMatchObject({ name: "AgentInitializationError", cause: expect.objectContaining({ message: expect.stringMatching(/complete-read limit/) }) });
  });
});
