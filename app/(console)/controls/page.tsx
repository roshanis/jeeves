import Link from "next/link";
import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { runtimeDatabaseUrl } from "@/lib/db/runtime-config";
import { resolveDataProviderMode } from "@/lib/data/provider-mode";
import { logUnexpectedError } from "@/lib/http/log-error";
import { listExceptions, type ExceptionRow } from "@/lib/services/exception-service";
import { ControlCatalog } from "@/components/jeeves/control-catalog";
import { ExceptionsPanel } from "@/components/jeeves/exceptions-panel";
import { isDemoMode, isProductionMode } from "@/lib/config/deployment-mode";
import { BASE_DATE_MS } from "@/lib/demo/reference-data";
import type { Metadata } from "next";


// Mode-aware, so resolved per request: Meridian Health is the demo's fictional
// payer; a production install is someone else's.
export function generateMetadata(): Metadata {
  return {
    title: "Control catalog",
    description: isProductionMode()
      ? "Every governance control enforced, across all eight domains — policy source, status and evidence, read-only."
      : "Every governance control Meridian Health enforces, across all eight domains — policy source, status and evidence, read-only.",
  };
}

// The demo timeline is frozen at 2026-07-01 and the monitor evaluates at base+14d
// (same constant as app/api/monitor/run/route.ts); in the demo, evidence freshness
// uses that clock. A production install has real evidence dates and no frozen
// timeline, so there the catalog falls back to the browser's clock.
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
  // read so a fresh/unseeded dev database never crashes the catalog page, and
  // skip it in the read-only preview, which has no database to fail: there the
  // panel keeps its empty state instead of reporting a failed load.
  let exceptions: ExceptionRow[] = [];
  let exceptionsLoadFailed = false;
  const dbMode = resolveDataProviderMode(process.env.DATA_PROVIDER, !!runtimeDatabaseUrl()) === "db";
  if (dbMode) {
    try {
      exceptions = await listExceptions(getDb(), undefined, { viewerWorkspaceId });
    } catch (err) {
      logUnexpectedError("controls: could not load control exceptions", err);
      exceptions = [];
      exceptionsLoadFailed = true;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Control catalog</h1>
        <p className="text-sm text-muted-foreground">
          Every governance control {isProductionMode() ? "" : "Meridian "}enforces, across every domain —
          policy source, status, and evidence, read-only.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {controls.length} controls across {domainCount} domains + runtime.
        </p>
        {/* /frameworks is a marketing path: a production install answers it with an empty 404. */}
        {isDemoMode() ? (
          <Link
            href="/frameworks"
            className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
          >
            Framework mappings (NIST AI RMF · EU AI Act) →
          </Link>
        ) : null}
      </div>
      <ControlCatalog controls={controls} asOfMs={isProductionMode() ? undefined : DEMO_AS_OF_MS} />
      <ExceptionsPanel exceptions={exceptions} loadFailed={exceptionsLoadFailed} />
    </div>
  );
}
