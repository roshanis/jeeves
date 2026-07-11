"use client";

// Audit query console (ui-spec §6): 4 canned-query chips over a shared
// results table. Queries are pre-computed server-side and passed in — the
// chips are pure client-side selection, keeping this component directly
// testable with fixture data. Every row deep-links into the initiative
// (EvidenceLink) — nothing in this table is a dead end.
import * as React from "react";
import type { AuditQueryRow, CannedAuditQueryId } from "@/lib/data/dto";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TierBadge } from "./tier-badge";
import { EvidenceLink } from "./evidence-link";

const QUERY_META: { id: CannedAuditQueryId; label: string; explanation: string }[] = [
  {
    id: "member-facing-phi",
    label: "Member-facing initiatives touching PHI",
    explanation: "Showing: initiatives where member-facing = Yes AND PHI = Yes",
  },
  {
    id: "approved-by-torres",
    label: "Everything approved by Angela Torres",
    explanation: "Showing: decisions where approver = Angela Torres",
  },
  {
    id: "overdue-controls",
    label: "Overdue controls",
    explanation: "Showing: initiatives with overdue controls, with remediation owners",
  },
  {
    id: "q01-control-changes",
    label: "What changed on Q-01 and who changed it",
    explanation: "Showing: control-change audit events for control Q-01",
  },
];

export function AuditConsole({
  results,
}: {
  results: Record<CannedAuditQueryId, AuditQueryRow[]>;
}) {
  const [activeId, setActiveId] = React.useState<CannedAuditQueryId | null>(null);
  const active = QUERY_META.find((q) => q.id === activeId) ?? null;
  const rows = activeId ? results[activeId] : [];

  return (
    <div className="flex flex-col gap-4" data-slot="audit-console">
      <div className="flex flex-wrap gap-2">
        {QUERY_META.map((query) => (
          <Button
            key={query.id}
            variant={query.id === activeId ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveId(query.id)}
            aria-pressed={query.id === activeId}
          >
            {query.label}
          </Button>
        ))}
      </div>

      {active ? (
        <p className="text-xs text-muted-foreground" data-slot="query-explanation">
          {active.explanation}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Run a canned query to see evidence-linked results.
        </p>
      )}

      {active ? (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No records match this query — try broadening filters.
              </p>
            ) : (
              <Table data-slot="audit-results">
                <TableHeader>
                  <TableRow>
                    <TableHead>Initiative / record</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Approver</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Event time</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.slug}-${i}`} data-slot="audit-result-row">
                      <TableCell className="whitespace-normal font-medium">
                        {row.title}
                      </TableCell>
                      <TableCell>
                        {row.tier ? <TierBadge tier={row.tier} /> : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.state}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.approver ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">
                        {row.detail}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.eventTs ? row.eventTs.slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell>
                        {row.slug ? (
                          <EvidenceLink slug={row.slug} tab="audit" className="text-xs">
                            Open audit trail
                          </EvidenceLink>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
