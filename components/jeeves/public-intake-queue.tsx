"use client";

// What the public has sent in.
//
// Every public session gets its own isolated workspace — that is what keeps
// one visitor out of another's draft — and the server-rendered console
// scopes reads by the workspace cookie, which carries no role. So public
// submissions are invisible to the console by construction, and without this
// panel the Program Office would have no way to know a request had arrived.
//
// Client-side on purpose: the viewer's ROLE is only knowable from the
// session token, and it is the role that decides who may see this. Rendering
// it server-side from the cookie would have shown every stranger's
// submission to every other stranger, the console being public too.
import * as React from "react";
import { Inbox } from "lucide-react";
import {
  apiErrorToMessage,
  isApiError,
  listPublicSubmissions,
  type PublicSubmissionRow,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import type { LifecycleState } from "@/lib/domain/types";
import { LIFECYCLE_LABEL } from "./lifecycle-badge";

const QUEUE_READER_ROLES = new Set(["program", "admin"]);

export function PublicIntakeQueue() {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const canRead = session ? QUEUE_READER_ROLES.has(session.role) : false;

  const [rows, setRows] = React.useState<PublicSubmissionRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const token = session?.token ?? null;
  React.useEffect(() => {
    // No setState on the way out: when the viewer cannot read the queue the
    // component renders nothing at all (below), so there are no stale rows to
    // clear — and clearing them here would be a synchronous setState in an
    // effect body, which cascades renders for no benefit.
    if (!token || !canRead) return;
    let cancelled = false;
    listPublicSubmissions(token)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(isApiError(err) ? apiErrorToMessage(err) : "Could not load public submissions.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, canRead]);

  // Not an empty panel for everyone else — the queue simply is not theirs.
  if (!canRead) return null;

  return (
    <div className="panel overflow-hidden" data-slot="public-intake-queue">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Inbox className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="kicker">Public submissions</span>
        {rows && rows.length > 0 ? (
          <span className="stat-value text-xs text-foreground">{rows.length}</span>
        ) : null}
      </div>

      {error ? (
        <p className="px-4 py-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : rows === null ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Nothing submitted through the public form yet. Requests that arrive
          here still need QC before any domain is asked to review them.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.initiativeId} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {LIFECYCLE_LABEL[row.state as LifecycleState] ?? row.state}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.requester} · received {row.createdAt.slice(0, 10)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
