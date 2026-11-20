"use client";

// The operator's view of real inbound requests.
//
// Gated by the site's OPERATOR_TOKEN, entered here — deliberately not by the
// demo persona in the header. The passwordless playground gives any visitor
// any persona in one click, Program Office and Admin included, so a panel
// that trusted the persona would show every stranger's request (their name,
// their email, what they wrote) to every other stranger.
//
// The token is kept in sessionStorage for this tab only, so a refresh does
// not ask again but closing the tab forgets it. It is sent only to
// /api/public-intake, which checks it in constant time server-side.
import * as React from "react";
import { Inbox, LogOut, Mail } from "lucide-react";
import {
  apiErrorToMessage,
  isApiError,
  listPublicSubmissions,
  type PublicSubmissionRow,
} from "@/lib/client/api";
import type { LifecycleState } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { LIFECYCLE_LABEL } from "./lifecycle-badge";

const STORAGE_KEY = "jeeves_operator_token";
// Mirrors PUBLIC_QUEUE_LIMIT in lib/services/public-intake-service.ts (server-only module).
const QUEUE_LIMIT = 200;

function readStoredToken(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — the token simply lasts for this page view.
  }
}

// Only a rejected token is forgotten; a 429, a 500 or a network blip keeps it.
function tokenRejected(err: unknown): boolean {
  return isApiError(err) && (err.status === 401 || err.status === 404);
}

function errorMessage(err: unknown): string {
  return !isApiError(err)
    ? "Could not load requests. Try again."
    : err.status === 404
      ? "The request queue is not switched on for this site (no OPERATOR_TOKEN is configured)."
      : err.status === 401
        ? "That token was not accepted."
        : apiErrorToMessage(err);
}

// A mailto: link only for a plain address; anything carrying mail-URL
// parameters (? & % , ; # =) is shown as text so it cannot add cc/bcc/body.
const SAFE_MAILTO_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function RequestProblem({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <>
      <p
        data-slot="request-problem"
        className={`text-sm text-muted-foreground ${expanded ? "whitespace-pre-wrap" : "line-clamp-3"}`}
      >
        {text}
      </p>
      {text.length > 160 ? (
        <Button type="button" size="sm" variant="ghost" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show full request"}
        </Button>
      ) : null}
    </>
  );
}

type State =
  | { kind: "locked"; error: string | null }
  | { kind: "loading" }
  | { kind: "open"; rows: PublicSubmissionRow[] };

export function PublicIntakeQueue() {
  const [state, setState] = React.useState<State>({ kind: "locked", error: null });
  const [draft, setDraft] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const manualOpen = React.useRef(false);
  const tokenRef = React.useRef("");

  const open = React.useCallback(async (token: string) => {
    manualOpen.current = true;
    setRefreshError(null);
    setState({ kind: "loading" });
    try {
      const rows = await listPublicSubmissions(token);
      tokenRef.current = token;
      writeStoredToken(token);
      setState({ kind: "open", rows });
    } catch (err) {
      if (tokenRejected(err)) writeStoredToken(null);
      const message = errorMessage(err);
      setState({ kind: "locked", error: message });
    }
  }, []);

  // Resume with a token this tab remembered. State changes only from the
  // fetch's callbacks — never synchronously in the effect body, which would
  // cascade a render (react-hooks/set-state-in-effect). The form shows until
  // the rows arrive, the same as any first load.
  React.useEffect(() => {
    const remembered = readStoredToken();
    if (!remembered) return;
    let cancelled = false;
    listPublicSubmissions(remembered).then(
      (rows) => {
        if (!cancelled && !manualOpen.current) {
          tokenRef.current = remembered;
          setState({ kind: "open", rows });
        }
      },
      (err) => {
        // A remembered token the server rejects is forgotten; any other
        // failure keeps it and says what went wrong.
        if (tokenRejected(err)) writeStoredToken(null);
        if (!cancelled && !manualOpen.current && !(isApiError(err) && err.status === 401)) {
          setState({ kind: "locked", error: errorMessage(err) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Reloads the list in place with the token already accepted, so the queue
  // stays on screen instead of dropping back to the token form. A 429, a 5xx
  // or a network error keeps the rows and the token and says the refresh
  // failed; only a rejected token (401/404) drops to the form.
  async function refresh() {
    if (refreshing) return;
    // Lock may be pressed while this is in flight; a stale result must not
    // re-open the queue or resurrect an error after the token is gone.
    const token = tokenRef.current;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const rows = await listPublicSubmissions(token);
      if (tokenRef.current !== token) return;
      setState({ kind: "open", rows });
    } catch (err) {
      if (tokenRef.current !== token) return;
      if (tokenRejected(err)) {
        writeStoredToken(null);
        setState({ kind: "locked", error: errorMessage(err) });
      } else {
        setRefreshError(`Refresh failed — the list shown is the last one loaded. ${errorMessage(err)}`);
      }
    } finally {
      setRefreshing(false);
    }
  }

  function lock() {
    tokenRef.current = "";
    writeStoredToken(null);
    setDraft("");
    setRefreshError(null);
    setState({ kind: "locked", error: null });
  }

  return (
    <div className="panel overflow-hidden" data-slot="public-intake-queue">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Inbox className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="kicker">Real requests</span>
        {state.kind === "open" && state.rows.length > 0 ? (
          <span className="stat-value text-xs text-foreground">{state.rows.length}</span>
        ) : null}
        {state.kind === "open" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={refreshing}
            aria-busy={refreshing || undefined}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        ) : null}
        {state.kind === "open" ? (
          <Button type="button" size="sm" variant="ghost" onClick={lock}>
            <LogOut className="size-3.5" aria-hidden />
            Lock
          </Button>
        ) : null}
      </div>

      {state.kind === "open" && refreshError ? (
        <p className="border-b px-4 py-2 text-sm text-destructive" role="alert">
          {refreshError}
        </p>
      ) : null}

      {state.kind !== "open" ? (
        <form
          className="flex flex-col gap-2.5 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void open(draft.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Operator token</span>
            <input
              type="password"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              data-slot="operator-token-input"
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The site&apos;s <code className="font-mono">OPERATOR_TOKEN</code>. A
            demo persona does not open this queue — every persona is available
            to every visitor.
          </p>
          {state.kind === "locked" && state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={state.kind === "loading" || !draft.trim()}
            data-slot="operator-unlock"
          >
            {state.kind === "loading" ? "Checking…" : "Open queue"}
          </Button>
        </form>
      ) : state.rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No real requests yet. Submissions made through &ldquo;Send a real
          request&rdquo; appear here; playground role-play never does.
        </p>
      ) : (
        <>
        {state.rows.length >= QUEUE_LIMIT ? (
          <p className="border-b px-4 py-2 text-xs text-muted-foreground" role="status">
            Showing the newest {QUEUE_LIMIT} requests; older ones are not listed.
          </p>
        ) : null}
        <ul className="divide-y">
          {state.rows.map((row) => (
            <li key={row.initiativeId} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {LIFECYCLE_LABEL[row.state as LifecycleState] ?? row.state}
                </span>
                <p title={row.title} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {row.title}
                </p>
                <span className="text-xs text-muted-foreground">
                  {row.createdAt.slice(0, 10)}
                </span>
              </div>
              {row.businessProblem ? <RequestProblem text={row.businessProblem} /> : null}
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{row.requester}</span>
                {row.requesterEmail && !SAFE_MAILTO_RE.test(row.requesterEmail) ? (
                  <span>{row.requesterEmail}</span>
                ) : row.requesterEmail ? (
                  <a
                    href={`mailto:${row.requesterEmail}`}
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                  >
                    <Mail className="size-3" aria-hidden />
                    {row.requesterEmail}
                  </a>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
