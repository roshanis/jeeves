"use client";

/**
 * "Run monitor" live action (ui-spec §7 item 4; demo-script step 5). Shared
 * by the Admin console (with the nowTs selector) and the initiative Operate
 * tab (plain button — the demo script clicks Run Monitor while looking at
 * the telemetry panel).
 *
 * Role gating deliberately matches the ROUTE's guard, not ui-spec §7's
 * admin-only prose: POST /api/monitor/run accepts ANY authenticated session
 * role (the server performs the pause/reassessment as the `system` actor
 * regardless), so this button passes no `requiresRole` — any live session
 * enables it; without one it renders the standard disabled-with-tooltip.
 *
 * nowTs handling: "Demo default" sends an EMPTY body and lets the server
 * apply its own canonical base+14d constant (DEFAULT_MONITOR_NOW_TS in
 * app/api/monitor/run/route.ts) — omitting the value client-side keeps the
 * two permanently in sync without duplicating the constant into the client
 * bundle (the route module can't be imported here: it would pull the
 * server-only DB graph in). "Custom" sends an explicit ISO timestamp.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  apiErrorToMessage,
  isApiError,
  runMonitor,
  type RunMonitorResult,
} from "@/lib/client/api";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import { DisableWithTooltip } from "./role-gate";

/**
 * Display-only hint mirroring the server default (seed-spec base date
 * 2026-07-01T00:00:00Z + 14d). Never sent on the wire — see header.
 */
export const DEMO_DEFAULT_NOW_LABEL = "2026-07-15T00:00:00Z (base+14d)";

const fieldClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function RunMonitorPanel({
  withSelector = false,
  onCompleted,
}: {
  withSelector?: boolean;
  onCompleted?: (result: RunMonitorResult) => void;
}) {
  const router = useRouter();
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const [mode, setMode] = React.useState<"default" | "custom">("default");
  const [customTs, setCustomTs] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<RunMonitorResult | null>(null);
  const errorCount = result?.errors?.length ?? 0;
  const hasErrors = errorCount > 0;

  const customMs = Date.parse(customTs);
  const customValid = mode !== "custom" || Number.isFinite(customMs);

  async function handleRun() {
    if (!session) return;
    if (!customValid) {
      toast.error("Enter a valid ISO-8601 timestamp (e.g. 2026-07-15T00:00:00Z).");
      return;
    }
    setPending(true);
    try {
      const runResult: RunMonitorResult = await runMonitor(
        session.token,
        mode === "custom" ? customMs : undefined,
      );
      setResult(runResult);
      const failureCount = runResult.errors?.length ?? 0;
      if (failureCount > 0) {
        // P1 fix (external-review): a run with per-candidate failures must
        // never read as a clean pass, even in the toast — some breaches may
        // have been genuinely DETECTED but not persisted.
        toast.error(
          `${failureCount} monitor candidate${failureCount === 1 ? "" : "s"} FAILED to record` +
            (runResult.incidentsCreated > 0
              ? ` (${runResult.incidentsCreated} other breach${
                  runResult.incidentsCreated === 1 ? "" : "es"
                } still recorded)`
              : "") +
            " — see the run summary below and server logs.",
        );
      } else if (runResult.incidentsCreated > 0) {
        const breach = runResult.breaches.find((b) => b.isNew);
        toast.success(
          `Breach detected${breach ? ` on ${breach.initiativeId}` : ""} — deployment paused, incident ${
            breach ? breach.incidentId : ""
          } opened, reassessment cycle created.`,
        );
      } else {
        // Idempotent re-run / clean bill of health (ui-spec §7 exact copy).
        toast.success("No new breaches detected.");
      }
      onCompleted?.(runResult);
      router.refresh();
    } catch (err) {
      toast.error(isApiError(err) ? apiErrorToMessage(err) : "Monitor run failed.");
      if (isApiError(err) && err.status === 401) live?.logout();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" data-slot="run-monitor-panel">
      {withSelector ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Evaluation timestamp</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "default" | "custom")}
              data-slot="monitor-nowts-mode"
              className={fieldClass}
            >
              <option value="default">Demo default — {DEMO_DEFAULT_NOW_LABEL}</option>
              <option value="custom">Custom ISO timestamp</option>
            </select>
          </label>
          {mode === "custom" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Custom timestamp (ISO-8601)</span>
              <input
                type="text"
                value={customTs}
                onChange={(e) => setCustomTs(e.target.value)}
                placeholder="2026-07-15T00:00:00Z"
                data-slot="monitor-nowts-input"
                className={fieldClass}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <DisableWithTooltip
        label="Run monitor"
        onAction={() => void handleRun()}
        pending={pending}
        pendingLabel="Running monitor…"
        data-slot="run-monitor"
      />

      {result ? (
        <div className="space-y-2">
          <p
            className={
              hasErrors
                ? "text-xs tabular-nums font-medium text-status-warning-fg"
                : "text-xs tabular-nums text-muted-foreground"
            }
            data-slot="monitor-result"
          >
            Evaluated {result.evaluated} · breaches {result.breaches.length} ·
            incidents created {result.incidentsCreated} · already known{" "}
            {result.alreadyKnown}
            {hasErrors
              ? ` · ${errorCount} candidate${errorCount === 1 ? "" : "s"} FAILED — not a clean run`
              : " — all candidates evaluated cleanly"}
          </p>
          {hasErrors ? (
            <div
              className="space-y-1 rounded-lg border border-status-warning-fg/20 bg-status-warning-bg px-3 py-2 text-xs text-status-warning-fg"
              data-slot="monitor-errors"
            >
              <p className="font-medium">
                {errorCount} candidate{errorCount === 1 ? "" : "s"} failed to
                record — a breach may have been detected but not persisted.
                Check server logs.
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {(result.errors ?? []).map((e, i) => (
                  <li key={`${e.deploymentId}-${i}`}>
                    {e.initiativeId} ({e.deploymentId}): {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
