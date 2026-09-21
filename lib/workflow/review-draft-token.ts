import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { reviewDecisions } from "../db/schema";

type ReviewSnapshot = Pick<typeof reviewDecisions.$inferSelect,
  "id" | "cycleId" | "domain" | "status" | "draftMd" | "citations" | "reviewer" | "signedAt" | "returnReason">;

/** Binds a browser signature to the exact decision content it displayed. */
export function reviewDraftToken(row: Omit<ReviewSnapshot, "signedAt"> & { signedAt: Date | string | null }): string {
  return createHash("sha256").update(JSON.stringify([
    row.id, row.cycleId, row.domain, row.status, row.draftMd, row.citations,
    row.reviewer, row.signedAt ? new Date(row.signedAt).toISOString() : null, row.returnReason,
  ])).digest("hex");
}

/** Final DB compare-and-set, including content changes that leave status unchanged. */
export function reviewSnapshotCondition(row: ReviewSnapshot) {
  return and(
    eq(reviewDecisions.id, row.id),
    eq(reviewDecisions.status, row.status),
    row.draftMd === null ? isNull(reviewDecisions.draftMd) : eq(reviewDecisions.draftMd, row.draftMd),
    sql`${reviewDecisions.citations} = ${JSON.stringify(row.citations)}::jsonb`,
    row.reviewer === null ? isNull(reviewDecisions.reviewer) : eq(reviewDecisions.reviewer, row.reviewer),
    row.signedAt === null ? isNull(reviewDecisions.signedAt) : eq(reviewDecisions.signedAt, row.signedAt),
    row.returnReason === null ? isNull(reviewDecisions.returnReason) : eq(reviewDecisions.returnReason, row.returnReason),
  );
}
