"use client";

import * as React from "react";
import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

// Console error boundary. Must be a client component — Next.js passes it the
// thrown `error` and a `reset()` that re-renders the segment.
//
// Before this file existed a throw in any console server component fell
// through to Next's stock error screen, which in a production build says
// only "Application error: a client-side exception has occurred" with no way
// back into the app.
//
// What this deliberately does NOT do is print `error.message`. In a
// production build Next already replaces server-side messages with a digest
// to avoid leaking internals, but this console talks to Postgres and an LLM
// provider, and a message that escaped that filter could carry a connection
// string or key. The digest is what a developer actually needs to find the
// server log, so that is what is shown.
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface it in the browser console for anyone debugging a demo, without
    // putting it on screen.
    console.error("Console route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-16 text-center">
      <span
        className="grid size-12 place-items-center rounded-full bg-status-critical-bg text-status-critical-fg"
        aria-hidden
      >
        <AlertOctagon className="size-6" />
      </span>

      <div className="flex flex-col gap-2">
        <p className="kicker">Something went wrong</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          This screen didn&apos;t load
        </h1>
        <p className="text-sm text-muted-foreground">
          The error has been logged. Nothing you were looking at was changed —
          this console only writes when you explicitly act, and this failure
          happened while reading.
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/inbox"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          Back to Inbox
        </Link>
      </div>
    </div>
  );
}
