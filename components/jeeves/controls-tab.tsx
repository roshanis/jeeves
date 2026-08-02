// Controls tab (ui-spec §3.5): EffectiveControl rows with status chips.
// "Exception pending" is a distinct state, not a violation — rendered as a
// status only in M1 (M4 adds the full exception workflow).
import type { ControlRow } from "@/lib/data/dto";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DOMAIN_LABEL } from "./domain-labels";
import { cn } from "@/lib/utils";

// Reserved status-family tokens (app/globals.css data-color contract):
// met=good, pending=neutral, overdue=warning, breached=critical.
// exception_requested rides the blue tier-medium slot — distinct from every
// good/warning/serious/critical reading so "pending exception" never reads
// as a violation.
const STATUS_META: Record<ControlRow["status"], { label: string; className: string }> = {
  met: {
    label: "Met",
    className: "bg-status-good-bg text-status-good-fg",
  },
  pending: {
    label: "Pending",
    className: "bg-status-neutral-bg text-status-neutral-fg",
  },
  overdue: {
    label: "Overdue",
    className: "bg-status-warning-bg text-status-warning-fg",
  },
  breached: {
    label: "Breached",
    className: "bg-status-critical-bg text-status-critical-fg",
  },
  exception_requested: {
    label: "Exception pending",
    className: "bg-tier-medium-bg text-tier-medium-fg",
  },
};

export function ControlStatusChip({ status }: { status: ControlRow["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span
      data-slot="control-status"
      data-status={status}
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-medium",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function ControlsTab({ controls }: { controls: ControlRow[] }) {
  if (controls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No effective controls yet — controls are generated at deployment.
      </p>
    );
  }

  return (
    <div className="panel card-quiet overflow-hidden">
      <Table data-slot="controls-tab">
        <TableHeader>
          <TableRow>
            <TableHead className="kicker">Control</TableHead>
            <TableHead className="kicker">Name</TableHead>
            <TableHead className="kicker">Domain</TableHead>
            <TableHead className="kicker">Status</TableHead>
            <TableHead className="kicker">Policy source</TableHead>
            <TableHead className="kicker">Threshold</TableHead>
            <TableHead className="kicker">Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {controls.map((control) => (
            <TableRow key={control.id}>
              <TableCell className="font-mono text-xs">{control.id}</TableCell>
              <TableCell className="whitespace-normal">{control.name}</TableCell>
              <TableCell>
                {control.domain === "runtime" ? "Runtime" : DOMAIN_LABEL[control.domain]}
              </TableCell>
              <TableCell>
                <ControlStatusChip status={control.status} />
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {control.policySource ?? "—"}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {control.threshold ?? "—"}
              </TableCell>
              <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                {control.evidence ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
