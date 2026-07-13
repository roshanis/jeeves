import { getAppProvider } from "@/app/_lib/data-provider";
import { getDb } from "@/lib/db/client";
import { listExceptions, type ExceptionRow } from "@/lib/services/exception-service";
import { ControlCatalog } from "@/components/jeeves/control-catalog";
import { ExceptionsPanel } from "@/components/jeeves/exceptions-panel";

// Control catalog (plan §6): the full ControlDefinition catalog across all 8
// governance domains plus the one live-enforced runtime control (Q-01),
// rendered as a read-only, evidence-linked reference — plus the M4
// control-exception workflow (approver-gated actions live in ExceptionsPanel).
export default async function ControlsPage() {
  const provider = getAppProvider();
  const controls = await provider.controlCatalog();
  const domainCount = new Set(
    controls.filter((c) => c.domain !== "runtime").map((c) => c.domain),
  ).size;

  // Exceptions live in the real DB (not the read-model provider). Guard the
  // read so a fresh/unseeded dev database never crashes the catalog page.
  let exceptions: ExceptionRow[] = [];
  try {
    exceptions = await listExceptions(getDb());
  } catch {
    exceptions = [];
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
      </div>
      <ControlCatalog controls={controls} />
      <ExceptionsPanel exceptions={exceptions} />
    </div>
  );
}
