"use client";

// Control catalog page body (plan §6 / ui-spec §9 house style): a
// governance-credible read of the full ControlDefinition catalog, grouped by
// domain (8 domains) plus a "Runtime" group for the one live-enforced
// control, Q-01 (seed-spec §3). Read-only — no mutation buttons anywhere,
// matching every other catalog/audit surface in the app.
//
// M4: full catalog fields (owner, cadence, enforcement mode, remediation
// owner, required evidence, evidence freshness) plus client-side domain +
// status filtering (chip pattern mirrors review-workbench.tsx).
import * as React from "react";
import type { Domain } from "@/lib/domain/types";
import type { ControlRow } from "@/lib/data/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DOMAIN_LABEL } from "./domain-labels";
import { ControlStatusChip } from "./controls-tab";
import { cn } from "@/lib/utils";

// Domain order per seed-spec §3 (Legal ... Data Governance), Runtime last —
// Runtime isn't one of the 8 governance domains, it's the one control with
// live enforcement teeth (Q-01), so it gets its own trailing group.
const DOMAIN_ORDER: (Domain | "runtime")[] = [
  "legal",
  "procurement",
  "tech-architecture",
  "responsible-ai",
  "security",
  "privacy-hipaa",
  "clinical-safety",
  "data-governance",
  "runtime",
];

const GROUP_LABEL: Record<Domain | "runtime", string> = {
  ...DOMAIN_LABEL,
  runtime: "Runtime",
};

const STATUS_ORDER: ControlRow["status"][] = [
  "met",
  "pending",
  "overdue",
  "breached",
  "exception_requested",
];

const STATUS_LABEL: Record<ControlRow["status"], string> = {
  met: "Met",
  pending: "Pending",
  overdue: "Overdue",
  breached: "Breached",
  exception_requested: "Exception pending",
};

const ENFORCEMENT_META: Record<
  NonNullable<ControlRow["enforcementMode"]>,
  { label: string; className: string }
> = {
  monitor: {
    label: "Monitor",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  gate: {
    label: "Gate",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  block: {
    label: "Block",
    className: "",
  },
};

function EnforcementModeBadge({
  mode,
}: {
  mode: ControlRow["enforcementMode"];
}) {
  if (!mode) return <span className="text-xs text-muted-foreground">—</span>;
  const meta = ENFORCEMENT_META[mode];
  if (mode === "block") {
    return (
      <Badge variant="destructive" data-slot="enforcement-mode" data-mode={mode}>
        {meta.label}
      </Badge>
    );
  }
  return (
    <span
      data-slot="enforcement-mode"
      data-mode={mode}
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-medium",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

// Evidence-freshness rule (kept deliberately simple for a demo catalog view):
// evidence older than 90 days is "stale", otherwise "fresh". No evidenceAt at
// all renders "—" (nothing to assess). This does not use cadence-per-control
// windows — a genuine implementation would compare against each control's own
// cadence, but a single flat threshold is transparent and easy to audit here.
const STALE_AFTER_DAYS = 90;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

type Freshness = "fresh" | "stale" | "unknown";

function evidenceFreshness(evidenceAt: string | null | undefined, nowMs: number): Freshness {
  if (!evidenceAt) return "unknown";
  const at = Date.parse(evidenceAt);
  if (Number.isNaN(at)) return "unknown";
  return nowMs - at > STALE_AFTER_MS ? "stale" : "fresh";
}

const FRESHNESS_META: Record<Freshness, { label: string; className: string }> = {
  fresh: {
    label: "Fresh",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  stale: {
    label: "Stale",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  unknown: {
    label: "—",
    className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function EvidenceFreshnessBadge({
  evidenceAt,
  nowMs,
}: {
  evidenceAt: string | null | undefined;
  nowMs: number;
}) {
  const freshness = evidenceFreshness(evidenceAt, nowMs);
  const meta = FRESHNESS_META[freshness];
  return (
    <span
      data-slot="evidence-freshness"
      data-freshness={freshness}
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-medium",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

// Cached client "now" — a single read per page load (no live ticking needed
// for a freshness badge), matching the hydration-safe pattern used elsewhere
// in the app (e.g. queue-age.tsx's useClientNow): useSyncExternalStore with a
// server snapshot of null (so SSR and the first client paint agree) and a
// cached client snapshot (so it doesn't setState-in-effect / re-render).
const SUBSCRIBE_NOOP = (): (() => void) => () => {};
let cachedNowMs: number | null = null;
function getClientNowMs(): number {
  if (cachedNowMs === null) cachedNowMs = Date.now();
  return cachedNowMs;
}
function getServerNowMs(): number | null {
  return null;
}
function useCatalogNow(): number | null {
  return React.useSyncExternalStore(SUBSCRIBE_NOOP, getClientNowMs, getServerNowMs);
}

function ControlRowCard({ control, nowMs }: { control: ControlRow; nowMs: number | null }) {
  return (
    <div
      data-slot="control-catalog-row"
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {control.id}
            </span>
            <span className="font-medium">{control.name}</span>
            <ControlStatusChip status={control.status} />
            <EnforcementModeBadge mode={control.enforcementMode} />
          </div>
          <p className="text-xs text-muted-foreground">
            Policy source: {control.policySource ?? "—"}
            {control.threshold !== null ? ` · Threshold: ${control.threshold}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Owner: {control.owner ?? "—"} · Cadence: {control.cadence ?? "—"} ·
            Remediation owner: {control.remediationOwner ?? "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 text-xs text-muted-foreground sm:items-end">
          <span className="max-w-64 truncate sm:text-right">
            {control.evidence ?? "No evidence on file"}
          </span>
          <span className="max-w-64 truncate sm:text-right">
            Required: {control.requiredEvidence ?? "—"}
          </span>
          {nowMs !== null ? (
            <EvidenceFreshnessBadge evidenceAt={control.evidenceAt} nowMs={nowMs} />
          ) : (
            <span className="inline-flex h-5 w-fit items-center rounded-full bg-zinc-100 px-2 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              —
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ControlCatalog({ controls }: { controls: ControlRow[] }) {
  const nowMs = useCatalogNow();
  const [domainFilter, setDomainFilter] = React.useState<Domain | "runtime" | "all">("all");
  const [statusFilter, setStatusFilter] = React.useState<ControlRow["status"] | "all">("all");

  const presentDomains = DOMAIN_ORDER.filter((d) =>
    controls.some((c) => c.domain === d),
  );
  const presentStatuses = STATUS_ORDER.filter((s) =>
    controls.some((c) => c.status === s),
  );

  const filtered = controls.filter((c) => {
    if (domainFilter !== "all" && c.domain !== domainFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  const byDomain = new Map<Domain | "runtime", ControlRow[]>();
  for (const group of DOMAIN_ORDER) byDomain.set(group, []);
  for (const control of filtered) {
    if (!byDomain.has(control.domain)) byDomain.set(control.domain, []);
    byDomain.get(control.domain)!.push(control);
  }

  return (
    <div data-slot="control-catalog" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3" data-slot="control-catalog-filters">
        <div className="flex flex-wrap items-center gap-1.5" data-slot="control-domain-filter">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Domain</span>
          <button
            type="button"
            onClick={() => setDomainFilter("all")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              domainFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            All domains
          </button>
          {presentDomains.map((domain) => (
            <button
              key={domain}
              type="button"
              onClick={() => setDomainFilter(domain)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                domainFilter === domain
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {GROUP_LABEL[domain]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-slot="control-status-filter">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Status</span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              statusFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            All statuses
          </button>
          {presentStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                statusFilter === status
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-full flex-col gap-6">
          {DOMAIN_ORDER.map((group) => {
            const rows = byDomain.get(group) ?? [];
            if (rows.length === 0) return null;
            return (
              <Card key={group} data-slot="control-catalog-group">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {GROUP_LABEL[group]}
                    <Badge variant="secondary">{rows.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {rows.map((control) => (
                    <ControlRowCard key={control.id} control={control} nowMs={nowMs} />
                  ))}
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No controls match the selected filters.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
