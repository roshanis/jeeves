/**
 * The gate every READ goes through: who may see data, and which workspace's
 * rows they see.
 *
 * It is the read-side counterpart of `runMutationGuard`
 * (lib/services/route-guard.ts). Mutations have always needed a session; reads
 * were open, because the public demo shows seeded data to anyone. That is a
 * demo property. A production install has no anonymous view at all.
 *
 *  - DEMO: unchanged. Reads stay open to anonymous visitors and are scoped by
 *    the viewer's own live session (bearer or `jeeves_session` cookie), else by
 *    the signed `jeeves_workspace` cookie, else to the seeded-only view
 *    (`workspaceId: null`, never "all workspaces").
 *
 *  - PRODUCTION: a read needs a valid session, resolved by `resolveSession`
 *    (the same resolver the mutation guard uses), and its workspace is the
 *    session's. The `jeeves_workspace` cookie is never read: it is a demo
 *    read-scoping hint, and trusting it would hand out workspaces. Until
 *    single sign-on lands production has no session type, so `resolveSession`
 *    answers nothing and every request is unauthenticated. No session means
 *    401 for an API and a redirect to /sign-in for a page.
 *
 *  - BOTH: a server that failed its boot checks (lib/config/boot-state.ts)
 *    serves nothing: 503 for an API, an error for a page.
 *
 * Two entry points, because the failure has two shapes. Server components call
 * `requireViewer()` and are redirected. Route handlers call
 * `requireViewerForRequest(req)` and return the response it hands back. Both
 * resolve through one function, so they cannot disagree about who is signed in.
 *
 * proxy.ts is not the access control and does not need to be: the check sits
 * next to the data, where it cannot be skipped by a route the proxy matcher
 * forgot. The proxy only gives a signed-out production page request the right
 * HTTP status (307, not a streamed 200 meta-refresh) and merely checks that a
 * credential is present (lib/config/production-routes.ts).
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { bootFailure } from "../config/boot-state";
import { isProductionMode } from "../config/deployment-mode";
import { SIGN_IN_PATH } from "../config/production-routes";
import type { Actor } from "../domain/types";
import { resolveWorkspaceCookieSecret, verifyWorkspaceCookie } from "../security/workspace-cookie";
import { extractSessionToken, resolveSession } from "./route-guard";

/** Where an unauthenticated page request is sent. */
export { SIGN_IN_PATH };

/** Demo read-scoping hint set by POST /api/session. Read in demo only. */
export const WORKSPACE_COOKIE_NAME = "jeeves_workspace";

export interface Viewer {
  /**
   * The signed-in actor. Null only in demo, for a visitor who has no live
   * session and is reading the seeded-only view. Always set in production.
   */
  actor: Actor | null;
  /**
   * The workspace reads are scoped to. Null means the seeded-only view, which
   * exists in demo only; a production viewer always has a workspace.
   */
  workspaceId: string | null;
}

export type ViewerGate = { ok: true; viewer: Viewer } | { ok: false; response: Response };

/**
 * Thrown by code that needs a viewer from a request which has none (see
 * `resolveViewerWorkspaceId`). Route handlers use the gate and answer 401, so
 * reaching this means a read path skipped the gate: it fails closed as a 500.
 */
export class ViewerRequiredError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(status === 503 ? "service unavailable" : "authentication required");
    this.name = "ViewerRequiredError";
    this.status = status;
  }
}

/**
 * Thrown to a page when the server failed to boot. A page cannot set a status
 * code, so this renders the error boundary; /api/health carries the 503 the
 * load balancer acts on. The message never carries the boot-failure reason.
 */
export class ViewerUnavailableError extends Error {
  constructor() {
    super("service unavailable");
    this.name = "ViewerUnavailableError";
  }
}

/* ------------------------------ demo resolution ------------------------------ */

/** Mirrors app/api/session/route.ts's own cookie reader: route handlers get a
 * raw Request, so there is no next/headers here. */
function extractWorkspaceCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${WORKSPACE_COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(WORKSPACE_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
}

/**
 * Demo viewer for a request. Never throws and never rejects anyone: every
 * failure mode (no token, expired or unknown token, missing, tampered or
 * unsigned cookie, no cookie secret) degrades to the seeded-only view, matching
 * `verifyWorkspaceCookie`'s own "never trust, never error" contract.
 *
 * Precedence:
 *   1. A present AND valid session token -> that session's bound workspace,
 *      even when the session itself carries a null workspace (a session, once
 *      valid, is authoritative over a cookie hint).
 *   2. Otherwise a present AND signature-verified `jeeves_workspace` cookie.
 *   3. Otherwise null: seeded rows only.
 */
async function demoViewerForRequest(req: Request): Promise<Viewer> {
  // resolveSession(null) answers "no session" without touching the database.
  const { actor, workspaceId } = await resolveSession(extractSessionToken(req));
  if (actor) return { actor, workspaceId };
  const raw = extractWorkspaceCookie(req);
  return { actor: null, workspaceId: verifyWorkspaceCookie(raw, resolveWorkspaceCookieSecret()) };
}

/* ---------------------------- production resolution --------------------------- */

/**
 * Production viewer for a request: a valid session with a workspace, or null.
 * The workspace cookie is deliberately not consulted. A `public` role is
 * refused as well, as defence in depth: production never issues one (the
 * public door is a 404 there), so a row that claims it is not a real sign-in.
 */
async function productionViewerForRequest(req: Request): Promise<Viewer | null> {
  const { actor, workspaceId } = await resolveSession(extractSessionToken(req));
  if (!actor || !workspaceId || actor.role === "public") return null;
  return { actor, workspaceId };
}

/* ------------------------------- route handlers ------------------------------- */

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The viewer for a route handler, or the response to return instead.
 *
 *   const gate = await requireViewerForRequest(req);
 *   if (!gate.ok) return gate.response;
 *   const { viewer } = gate;
 *
 * Call it before touching the database. The responses carry no data and no
 * detail about why (a boot-failure reason stays in the server log), and are
 * `no-store` so a CDN never keeps one.
 */
export async function requireViewerForRequest(req: Request): Promise<ViewerGate> {
  if (bootFailure() !== null) {
    return { ok: false, response: Response.json({ error: "service unavailable" }, { status: 503, headers: NO_STORE }) };
  }
  if (!isProductionMode()) return { ok: true, viewer: await demoViewerForRequest(req) };

  const viewer = await productionViewerForRequest(req);
  if (!viewer) {
    return {
      ok: false,
      response: Response.json({ error: "invalid or missing session" }, { status: 401, headers: NO_STORE }),
    };
  }
  return { ok: true, viewer };
}

/* ----------------------------------- pages ----------------------------------- */

/**
 * The viewer for a server component, or a redirect to /sign-in (production,
 * no session).
 *
 * Memoized per render pass (React `cache`), so a page, its layout slots and
 * the data helpers below it share one lookup instead of one each. Both
 * branches read request data (`cookies()` or `headers()`), which also keeps
 * every page that calls this rendered per request, never prerendered at build
 * time with whichever mode the build happened to run in.
 */
export const requireViewer = cache(async (): Promise<Viewer> => {
  if (bootFailure() !== null) throw new ViewerUnavailableError();

  if (!isProductionMode()) {
    const raw = (await cookies()).get(WORKSPACE_COOKIE_NAME)?.value ?? null;
    return { actor: null, workspaceId: verifyWorkspaceCookie(raw, resolveWorkspaceCookieSecret()) };
  }

  // The session resolver is request-shaped; the incoming headers are all it reads.
  const viewer = await productionViewerForRequest(
    new Request("http://viewer.invalid/", { headers: new Headers(await headers()) }),
  );
  if (!viewer) redirect(SIGN_IN_PATH);
  return viewer;
});
