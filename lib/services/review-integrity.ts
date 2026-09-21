import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../db/schema";
import { initiatives, reviewCycles } from "../db/schema";
import { mutationWorkspaceMismatch } from "./workspace-guard";

export type ReviewTx = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Kept independent of initiative-service so workflow persistence shares the same lock discipline. */
export class ReviewIntegrityError extends Error {
  constructor(readonly kind: "not_found" | "conflict", message: string) {
    super(message);
    this.name = "ReviewIntegrityError";
  }
}

/**
 * All writers of a review (human, agent, and initiative decision) serialize on
 * its owning initiative. The first cycle read only discovers that owner; review
 * and cycle eligibility must be read again after the lock has been acquired.
 * Omit workspace only for internal workflow calls; explicit null is checked.
 */
export async function lockCurrentReviewCycle(
  tx: ReviewTx,
  cycleId: string,
  sessionWorkspaceId?: string | null,
) {
  const [owner] = await tx.select({ initiativeId: reviewCycles.initiativeId })
    .from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  if (!owner) throw new ReviewIntegrityError("not_found", "Review cycle not found.");
  const [initiative] = await tx.select().from(initiatives)
    .where(eq(initiatives.id, owner.initiativeId)).for("update");
  if (!initiative || (sessionWorkspaceId !== undefined && mutationWorkspaceMismatch(initiative.workspaceId, sessionWorkspaceId))) {
    throw new ReviewIntegrityError("not_found", "Review cycle not found.");
  }
  const [cycle] = await tx.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  const [latest] = await tx.select({ id: reviewCycles.id }).from(reviewCycles)
    .where(eq(reviewCycles.initiativeId, initiative.id))
    .orderBy(desc(reviewCycles.openedAt), desc(reviewCycles.id)).limit(1);
  if (!cycle || cycle.initiativeId !== initiative.id || latest?.id !== cycleId || cycle.closedAt !== null ||
      !["in_review", "re_review"].includes(initiative.state)) {
    throw new ReviewIntegrityError("conflict", "This review cycle is closed or no longer current. Refresh before continuing.");
  }
  return { initiative, cycle };
}
