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

type State =
  | { kind: "locked"; error: string | null }
  | { kind: "loading" }
  | { kind: "open"; rows: PublicSubmissionRow[] };

export function PublicIntakeQueue() {
  const [state, setState] = React.useState<State>({ kind: "locked", error: null });
  const [draft, setDraft] = React.useState("");

  const open = React.useCallback(async (token: string) => {
    setState({ kind: "loading" });
    try {
      const rows = await listPublicSubmissions(token);
      writeStoredToken(token);
      setState({ kind: "open", rows });
    } catch (err) {
      writeStoredToken(null);
      const message = !isApiError(err)
        ? "Could not load requests. Try again."
        : err.status === 404
          ? "The request queue is not switched on for this site (no OPERATOR_TOKEN is configured)."
          : err.status === 401
            ? "That token was not accepted."
            : apiErrorToMessage(err);
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
        if (!cancelled) setState({ kind: "open", rows });
      },
      () => {
        // A remembered token that no longer works is simply forgotten; the
        // operator sees the unlock form, which is where they would start.
        writeStoredToken(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function lock() {
    writeStoredToken(null);
    setDraft("");
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
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={lock}>
            <LogOut className="size-3.5" aria-hidden />
            Lock
          </Button>
        ) : null}
      </div>

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
        <ul className="divide-y">
          {state.rows.map((row) => (
            <li key={row.initiativeId} className="flex flex-col gap-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {LIFECYCLE_LABEL[row.state as LifecycleState] ?? row.state}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {row.title}
                </p>
                <span className="text-xs text-muted-foreground">
                  {row.createdAt.slice(0, 10)}
                </span>
              </div>
              {row.businessProblem ? (
                <p className="line-clamp-3 text-sm text-muted-foreground">{row.businessProblem}</p>
              ) : null}
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{row.requester}</span>
                {row.requesterEmail ? (
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
      )}
    </div>
  );
}
