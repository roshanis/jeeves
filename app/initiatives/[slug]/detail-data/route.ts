/**
 * GET /initiatives/[slug]/detail-data — UI-owned read-only JSON view of
 * `InitiativeDetail` for the initiative detail page.
 *
 * Why this exists (workaround, documented in the task report): Next bundles
 * produce MULTIPLE server module graphs in one process (route handlers vs
 * page HTML vs RSC-navigation renders). `lib/db/client.ts#getDb()` memoizes
 * its PGlite handle per module instance, and PGlite loads a point-in-time
 * snapshot of ./.pglite lazily — so, when running on the local PGlite store
 * (no DATABASE_URL), a page-graph render can NOT see rows the /api/**
 * graph just wrote (a live-created initiative 404s on its own detail
 * page). Route handlers, however, all share one graph (verified: the
 * in-memory session map written by POST /api/session is read by every
 * other /api route). Serving the detail read-model from THIS route handler
 * and having the page fetch it over HTTP keeps the live demo's
 * read-your-writes coherent on PGlite. With a real DATABASE_URL (Neon's
 * stateless HTTP driver) the whole problem disappears and this hop is
 * merely redundant.
 *
 * This lives OUTSIDE app/api/** on purpose: it is not part of the backend
 * mutation contract (which is read-only for the UI task) — it is a
 * UI-internal data endpoint for one page.
 */
import { getAppProvider } from "@/app/_lib/data-provider";

export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const detail = await getAppProvider().getInitiativeDetail(slug);
  if (!detail) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(detail, { status: 200 });
}
