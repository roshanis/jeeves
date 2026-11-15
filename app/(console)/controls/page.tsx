import Link from "next/link";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listExceptions, type ExceptionRow } from "@/lib/services/exception-service";
import { ControlCatalog } from "@/components/jeeves/control-catalog";
import { ExceptionsPanel } from "@/components/jeeves/exceptions-panel";
import { BASE_DATE_MS } from "@/lib/demo/reference-data";
import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "Control catalog",
  description:
    "Every governance control Meridian Health enforces, across all eight domains — policy source, status and evidence, read-only.",
};

// The demo timeline is frozen at 2026-07-01 and the monitor evaluates at base+14d
// (same constant as app/api/monitor/run/route.ts); evidence freshness uses that clock.
const DEMO_AS_OF_MS = BASE_DATE_MS + 14 * 24 * 60 * 60 * 1000;

// Control catalog (plan §6): the full ControlDefinition catalog across all 8
// governance domains plus the one live-enforced runtime control (Q-01),
// rendered as a read-only, evidence-linked reference — plus the M4
// control-exception workflow (approver-gated actions live in ExceptionsPanel).
export default async function ControlsPage() {
  const provider = getAppProvider();
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const controls = await provider.controlCatalog({ viewerWorkspaceId });
  const domainCount = new Set(
    controls.filter((c) => c.domain !== "runtime").map((c) => c.domain),
  ).size;

  // Exceptions live in the real DB (not the read-model provider). Guard the
  // read so a fresh/unseeded dev database never crashes the catalog page.
  let exceptions: ExceptionRow[] = [];
  let exceptionsLoadFailed = false;
  try {
    exceptions = await listExceptions(getDb(), undefined, { viewerWorkspaceId });
  } catch (err) {
    console.error("controls: could not load control exceptions", err);
    exceptions = [];
    exceptionsLoadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Control catalog</h1>
        <p className="text-sm text-muted-foreground">
          Every governance control Meridian enforces, across every domain —
          policy source, status, and evidence, read-only.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {controls.length} controls across {domainCount} domains + runtime.
        </p>
        <Link
          href="/frameworks"
          className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
        >
          Framework mappings (NIST AI RMF · EU AI Act) →
        </Link>
      </div>
      <ControlCatalog controls={controls} asOfMs={DEMO_AS_OF_MS} />
      <ExceptionsPanel exceptions={exceptions} loadFailed={exceptionsLoadFailed} />
    </div>
  );
}
