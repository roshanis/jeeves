/**
 * The public intake queue.
 *
 * Public submission would be pointless without this: every public session
 * gets its OWN workspace (that is what stops one visitor reaching another's
 * draft), and console reads are scoped to the viewer's workspace — so a
 * submission from a stranger would otherwise land in a room nobody on the
 * governance side can open.
 *
 * Why a dedicated service rather than widening the workspace read filter:
 * the console renders server-side from the workspace COOKIE alone, which
 * carries no role. Widening the filter there would have shown every public
 * submission to every visitor, including other strangers — the console is
 * public too. The viewer's role is only knowable from the session token, so
 * the queue lives behind a route that reads it. Strangers stay isolated
 * from each other; passcode-holders see the queue.
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
      return {
        initiativeId: row.id,
        slug: row.slug,
        title: row.title,
        requester: row.requester,
        state: row.state,
        submittedAt: intake?.submitted ? row.updatedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
}
