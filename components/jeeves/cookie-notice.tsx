"use client";

import * as React from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Cookie notice — informational, not a consent gate, and that distinction is
 * deliberate.
 *
 * This site sets exactly one cookie (`jeeves_workspace`): HttpOnly, signed,
 * and used only to keep your demo workspace separate from another visitor's.
 * Under GDPR/ePrivacy, strictly necessary cookies do not require consent, so
 * a blocking "Accept / Reject" gate here would be theatre — it would offer a
 * choice that changes nothing, and train people to dismiss a control that
 * elsewhere matters.
 *
 * So this tells you what is stored and gets out of the way. If third-party
 * analytics are ever added, this has to become a real consent gate with a
 * working reject path, and the analytics must not load until consent is
 * given. That is a deliberate future change, not a tweak to this file.
 */
const STORAGE_KEY = "jeeves_cookie_notice_ack";

/* -------------------------------------------------------------------------
 * Acknowledged-state store.
 *
 * useSyncExternalStore rather than useState + useEffect: whether the notice
 * has been dismissed is a value the SERVER cannot know, and reading it in an
 * effect means a synchronous setState on mount — a cascading render, and the
 * thing react-hooks/set-state-in-effect exists to stop. The server snapshot
 * is "acknowledged", so SSR emits nothing and the notice appears only for
 * browsers that have not dismissed it.
 * ---------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let cached: boolean | undefined;

function readAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage blocked (private window, blocked site data). Show the notice:
    // an un-dismissable notice is a worse outcome than showing it twice, but
    // hiding it because storage failed would be wrong too.
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  // Cached so the snapshot is referentially stable between renders —
  // re-reading storage on every render makes React loop.
  cached ??= readAcknowledged();
  return cached;
}

/** Server render: assume acknowledged, so no notice is in the HTML. */
function getServerSnapshot(): boolean {
  return true;
}

function acknowledge(): void {
  cached = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Nothing to do — it reappears next visit.
  }
  for (const listener of listeners) listener();
}

export function CookieNotice() {
  const acknowledged = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  function dismiss() {
    acknowledge();
  }

  if (acknowledged) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-3 print:hidden sm:p-4"
      role="region"
      aria-label="Cookie notice"
      data-slot="cookie-notice"
    >
      <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-lg">
        <Cookie className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-muted-foreground">
            This site sets one cookie, to keep your demo workspace separate
            from other visitors&rsquo;. No advertising, no tracking, no
            third-party analytics.{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4 hover:text-foreground"
            >
              What we store
            </Link>
            .
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={dismiss}
          data-slot="cookie-notice-dismiss"
          className="shrink-0"
        >
          <X className="size-4" aria-hidden />
          <span className="sr-only">Dismiss cookie notice</span>
        </Button>
      </div>
    </div>
  );
}
