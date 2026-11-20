import Link from "next/link";
import { Database } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DatabaseUnavailableReload } from "./database-unavailable-reload";

// Shown in place of a console page while the demo's database has not been
// verified (lib/http/database-gate.ts). Says what is true and names no host.
// A soft navigation onto a held instance still falls back to
// app/(console)/error.tsx.
export function DatabaseUnavailableNotice() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-16 text-center">
      <span
        className="grid size-12 place-items-center rounded-full bg-status-neutral-bg text-status-neutral-fg"
        aria-hidden
      >
        <Database className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="kicker">Demo storage</p>
        <h1 className="text-2xl font-semibold tracking-tight">Temporarily unavailable</h1>
        <p className="text-sm text-muted-foreground">
          The demo&apos;s database cannot be reached right now, so this screen
          cannot load. Nothing you did is lost. Please try again in a moment.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <DatabaseUnavailableReload />
        <Link href="/" className={buttonVariants({ size: "sm", variant: "outline" })}>
          Back to the home page
        </Link>
      </div>
    </div>
  );
}
