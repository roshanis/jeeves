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
import { desc, eq, like } from "drizzle-orm";
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

/**
 * Every initiative created through the public form, newest first.
 *
 * Matched on the workspace prefix rather than a flag column — the prefix is
 * assigned at session-mint time and nothing else can produce it, so there is
 * no way for a passcode session to forge its way into this list.
 */
export async function listPublicSubmissions(db: Db): Promise<PublicSubmissionRow[]> {
  const rows = await db
    .select()
    .from(initiatives)
    .where(like(initiatives.workspaceId, `${PUBLIC_WORKSPACE_PREFIX}%`))
    .orderBy(desc(initiatives.createdAt));

  return Promise.all(
    rows.map(async (row) => {
      const [intake] = await db
        .select()
        .from(intakeVersions)
        .where(eq(intakeVersions.initiativeId, row.id))
        .orderBy(desc(intakeVersions.version))
        .limit(1);
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
    }),
  );
}
