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

const STATUS_META: Record<ControlRow["status"], { label: string; className: string }> = {
  met: {
    label: "Met",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  pending: {
    label: "Pending",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  overdue: {
    label: "Overdue",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  breached: {
    label: "Breached",
    className: "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100",
  },
  exception_requested: {
    label: "Exception pending",
    className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
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
    <Table data-slot="controls-tab">
      <TableHeader>
        <TableRow>
          <TableHead>Control</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Policy source</TableHead>
          <TableHead>Threshold</TableHead>
          <TableHead>Evidence</TableHead>
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
            <TableCell className="text-xs text-muted-foreground">
              {control.policySource ?? "—"}
            </TableCell>
            <TableCell className="tabular-nums">
              {control.threshold ?? "—"}
            </TableCell>
            <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
              {control.evidence ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
