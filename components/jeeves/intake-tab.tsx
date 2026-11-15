"use client";
// Intake tab (ui-spec §3.2): read-only rendering of the submitted
// IntakeVersion, or the "Draft — not yet submitted" state for the champion.
import type { AuditEventRow, InitiativeDetail } from "@/lib/data/dto";
import { latestQcReturn } from "@/lib/data/qc-return";
import { ADDITIONAL_FIELD_LABELS, fieldLabel } from "@/lib/intake/field-labels";
import { EMPTY_INTAKE_PAYLOAD } from "@/lib/intake/defaults";
import { splitMissing } from "@/lib/intake/split-missing";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GatedActionButton } from "./role-gate";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useLiveSessionOptional } from "@/lib/client/session-context";

const labelList = (keys: string[]) => keys.map(fieldLabel).join(", ");

/** Entries in form order (the order of EMPTY_INTAKE_PAYLOAD); jsonb storage does not keep key order. Unknown keys go last. */
function orderedEntries(value: object, template: unknown): [string, unknown][] {
  const order = template && typeof template === "object" ? Object.keys(template) : [];
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return Object.entries(value).sort(([a], [b]) => rank(a) - rank(b));
}

/** Live drafts use nested sections; older seeded examples use flat fields. */
function answerRows(fields: Record<string, unknown>): [string, string | boolean | null][] {
  const rows: [string, string | boolean | null][] = [];
  function visit(key: string, value: unknown, template?: unknown) {
    if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === "string")) rows.push([key, value.join("\n")]);
      else value.forEach((entry, index) => visit(`${key}.${index + 1}`, entry));
    } else if (value && typeof value === "object") {
      orderedEntries(value, template).forEach(([child, answer]) =>
        visit(`${key}.${child}`, answer, (template as Record<string, unknown> | undefined)?.[child]));
    } else {
      rows.push([key, typeof value === "boolean" || typeof value === "string" ? value : value == null ? null : String(value)]);
    }
  }
  orderedEntries(fields, EMPTY_INTAKE_PAYLOAD).forEach(([key, value]) =>
    visit(key, value, (EMPTY_INTAKE_PAYLOAD as unknown as Record<string, unknown>)[key]));
  if (fields.basics && typeof fields.basics === "object") {
    const present = new Set(rows.map(([key]) => key));
    for (const key of Object.keys(ADDITIONAL_FIELD_LABELS)) {
      if (!present.has(key)) rows.push([key, null]);
    }
  }
  return rows;
}

function renderValue(value: string | boolean | null, optional: boolean, flagged: boolean): React.ReactNode {
  if (optional && (value === null || (typeof value === "string" && value.trim() === ""))) {
    return <span className="text-muted-foreground">Not provided (optional)</span>;
  }
  if (value === null && !flagged) return <span className="text-muted-foreground">Not provided</span>;
  if (value === null) {
    return (
      <Badge variant="destructive" className="bg-status-critical-bg text-status-critical-fg">
        Missing
      </Badge>
    );
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return value;
}

export function IntakeTab({ intake, summary, events }: {
  intake: InitiativeDetail["intake"];
  events?: AuditEventRow[];
  summary?: InitiativeDetail["summary"] & { isSeeded?: boolean };
}) {
  const session = useLiveSessionOptional()?.session;
  if (!intake) {
    return <p className="text-sm text-muted-foreground">No intake record.</p>;
  }

  const { blocking, optional } = splitMissing(intake);
  const returned = intake.submitted ? undefined : latestQcReturn(events);
  return (
    <div className="space-y-4" data-slot="intake-tab">
      {returned ? (
        <Alert className="border-status-warning-fg/20 bg-status-warning-bg">
          <AlertTriangle className="size-4 text-status-warning-fg" aria-hidden />
          <AlertTitle className="text-status-warning-fg">Returned from QC — not yet resubmitted</AlertTitle>
          <AlertDescription>
            Returned by {returned.actor}: {returned.reason}
            {intake.missing.length > 0 ? <> Completeness check: missing {labelList(intake.missing)}.</> : null}
          </AlertDescription>
        </Alert>
      ) : !intake.submitted ? (
        <Alert className="border-status-warning-fg/20 bg-status-warning-bg">
          <AlertTriangle className="size-4 text-status-warning-fg" aria-hidden />
          <AlertTitle className="text-status-warning-fg">Draft — not yet submitted</AlertTitle>
          <AlertDescription>
            This intake is still in draft.
            {summary?.isSeeded ? " It is created live during the demo (champion storyline)." : null}
            {blocking.length > 0 ? (
              <>
                {" "}
                Completeness check: missing {labelList(blocking)} —
                intake cannot be submitted until complete.
              </>
            ) : null}
            {optional.length > 0 ? (
              <>
                {" "}
                Optional improvements ({labelList(optional)}) — this does not block submitting.
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="card-quiet overflow-hidden rounded-lg border">
        <Table containerLabel="Intake answers, scrollable horizontally">
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Answer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {answerRows(intake.fields).map(([key, value]) => (
              <TableRow key={key}>
                <TableCell className="whitespace-normal font-medium">
                  {fieldLabel(key)}
                </TableCell>
                <TableCell className="whitespace-pre-wrap">{key === "evidenceAttachments" && value === "" ? <span className="text-muted-foreground">None</span> : renderValue(value, key in ADDITIONAL_FIELD_LABELS, intake.missing.includes(key))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!intake.submitted ? (
        session?.role === "requester" && session.personaLabel === summary?.requester && summary?.isSeeded === false ? (
          <Link className={buttonVariants({ variant: "outline" })} href={`/initiatives/${summary.slug}/edit`}>Continue intake</Link>
        ) : (
          <GatedActionButton
            label={summary?.isSeeded ? "Example draft — read only" : "Continue intake"}
            variant="outline"
            disabledReason={summary?.isSeeded ? "This is a seeded example draft and cannot be edited" : "Only the requester who owns this draft can continue it"}
          />
        )
      ) : null}
    </div>
  );
}
