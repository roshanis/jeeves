/**
 * The public intake queue.
 *
 * Public submission would be pointless without this: every public session
 * gets its OWN workspace (that is what stops one visitor reaching another's
 * draft), and console reads are scoped to the viewer's workspace — so a
 * submission from a stranger would otherwise land in a room nobody on the
 * governance side can open.
 *
 * Who may read it is decided by the route (app/api/public-intake), which
 * requires the OPERATOR_TOKEN — not a persona role, since the passwordless
 * playground gives every persona to anyone. This service only answers "what
 * arrived"; it performs no authorization of its own.
 */
import { and, desc, eq, like, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { initiatives, intakeVersions } from "../db/schema";
import { PUBLIC_WORKSPACE_PREFIX } from "./route-guard";

export interface PublicSubmissionRow {
  initiativeId: string;
  slug: string;
  title: string;
  requester: string;
  /** Where to reply. Submission is blocked without a well-formed address
   *  (completeness rule BLK-03), so a submitted request always has one. */
  requesterEmail: string | null;
  businessProblem: string | null;
  state: string;
  submittedAt: string | null;
  createdAt: string;
}

/** How many of the newest requests the operator queue returns. The UI shows a
 *  "list is cut" note when it receives exactly this many (components/jeeves/public-intake-queue.tsx). */
export const PUBLIC_QUEUE_LIMIT = 200;

/**
 * The newest PUBLIC_QUEUE_LIMIT initiatives created through the public form,
 * newest first, in ONE query (latest intake version joined per row).
 *
 * Matched on the workspace prefix rather than a flag column — the prefix is
 * assigned at session-mint time and nothing else can produce it, so there is
 * no way for a persona session to forge its way into this list.
 */
export async function listPublicSubmissions(db: Db): Promise<PublicSubmissionRow[]> {
  const rows = await db
    .select({ row: initiatives, intake: intakeVersions })
    .from(initiatives)
    .leftJoin(
      intakeVersions,
      and(
        eq(intakeVersions.initiativeId, initiatives.id),
        eq(
          intakeVersions.version,
          sql`(select max(v.version) from ${intakeVersions} v where v.initiative_id = ${initiatives.id})`,
        ),
      ),
    )
    .where(like(initiatives.workspaceId, `${PUBLIC_WORKSPACE_PREFIX}%`))
    .orderBy(desc(initiatives.createdAt))
    .limit(PUBLIC_QUEUE_LIMIT);

  return rows.map(({ row, intake }) => {
    const basics = (intake?.fields as { basics?: { requesterEmail?: unknown; businessProblem?: unknown } } | undefined)
      ?.basics;
    return {
      initiativeId: row.id,
      slug: row.slug,
      title: row.title,
      requester: row.requester,
      requesterEmail: typeof basics?.requesterEmail === "string" ? basics.requesterEmail : null,
      businessProblem: typeof basics?.businessProblem === "string" ? basics.businessProblem : null,
      state: row.state,
      submittedAt: intake?.submitted ? row.updatedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
