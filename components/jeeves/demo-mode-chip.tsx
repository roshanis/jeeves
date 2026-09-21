"use client";

import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveSession } from "@/lib/client/session-context";

/** A visitor can start playing immediately; persona choice lives in the header. */
export function DemoModeChip() {
  const { session, logout, pending, startError, startDemo } = useLiveSession();
  return (
    <div className="flex flex-col items-start gap-1" data-slot="demo-mode-chip">
      {session ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            <span className="hidden lg:inline">Live demo (session workspace)</span>
            <span className="lg:hidden">Playing</span>
          </span>
          <Button type="button" variant="ghost" size="sm" data-slot="live-reset" onClick={logout}>
            Exit demo
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={startDemo} disabled={pending}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {pending ? "Starting…" : "Start demo"}
        </Button>
      )}
      {startError ? <p role="alert" className="max-w-64 text-xs text-destructive">{startError}</p> : null}
    </div>
  );
}
