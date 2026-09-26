"use client";
// Intake tab (ui-spec §3.2): read-only rendering of the submitted
// IntakeVersion, or the "Draft — not yet submitted" state for the champion.
import type { InitiativeDetail } from "@/lib/data/dto";
import { ADDITIONAL_INTAKE_QUESTIONS } from "@/lib/intake/additional-questions";
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

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  phi: "1. Does it access PHI?",
  memberFacing: "2. Do members interact with or receive its output directly?",
  careCoverageInfluence: "3. Does it influence care or coverage decisions?",
  vendorHosted: "4. Is the model vendor-hosted?",
  humanInLoop: "5. Does a qualified human review each output before it takes effect?",
  individualImpact: "6. Does it affect individuals' opportunities, rights, or services?",
  "data.retentionIntent": "Data retention",
  "basics.title": "Title",
  "basics.sponsorOrg": "Sponsor organization",
  "basics.requesterName": "Requester name",
  "basics.requesterEmail": "Requester email",
  "basics.businessProblem": "Business problem",
  "useCase.primaryUsers": "Who uses it",
  "useCase.decisionInformed": "Decision it informs",
  "useCase.expectedVolume": "Expected volume",
  "data.dataSources": "Data sources",
  "data.phiCategories": "PHI categories touched",
  "data.phiCategoriesOtherText": "Other PHI category",
  "data.retentionIntentNote": "Retention note",
  "data.trainingVsInference": "Training vs. inference use",
  "modelVendor.buildOrBuy": "Build or buy",
  "modelVendor.vendorName": "Vendor name",
  "modelVendor.hosting": "Hosting",
  "modelVendor.modelType": "Model type",
  "populationImpact.affectedPopulations": "Affected populations",
  "populationImpact.expectedBenefits": "Expected benefits",
  "populationImpact.expectedHarms": "Expected harms / risks",
  "deployment.integrationPoints": "Integration points",
  "deployment.rolloutPlan": "Rollout plan",
  "overlay.touchesPHI": "1. Does it access PHI?",
  "overlay.memberFacing": "2. Do members interact with or receive its output directly?",
  "overlay.careCoverageInfluence": "3. Does it influence care or coverage decisions?",
  "overlay.vendorHosted": "4. Is the model vendor-hosted?",
  "overlay.humanInTheLoop": "5. Does a qualified human review each output before it takes effect?",
  "overlay.individualImpact": "6. Does it affect individuals' opportunities, rights, or services (members, providers, or employees)?",
};

const ADDITIONAL_FIELD_LABELS = Object.fromEntries(
  Object.entries(ADDITIONAL_INTAKE_QUESTIONS).flatMap(([section, questions]) =>
    questions.map(({ key, question }) => [`${section}.${key}`, question]),
  ),
);

/** Live drafts use nested sections; older seeded examples use flat fields. */
function answerRows(fields: Record<string, unknown>): [string, string | boolean | null][] {
  const rows: [string, string | boolean | null][] = [];
  function visit(key: string, value: unknown) {
    if (Array.isArray(value)) {
      if (value.every((entry) => typeof entry === "string")) rows.push([key, value.join("\n")]);
      else value.forEach((entry, index) => visit(`${key}.${index + 1}`, entry));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([child, answer]) => visit(`${key}.${child}`, answer));
    } else {
      rows.push([key, typeof value === "boolean" || typeof value === "string" ? value : value == null ? null : String(value)]);
    }
  }
  Object.entries(fields).forEach(([key, value]) => visit(key, value));
  if (fields.basics && typeof fields.basics === "object") {
    const present = new Set(rows.map(([key]) => key));
    for (const key of Object.keys(ADDITIONAL_FIELD_LABELS)) {
      if (!present.has(key)) rows.push([key, null]);
    }
  }
  return rows;
}

function renderValue(value: string | boolean | null, optional: boolean): React.ReactNode {
  if (optional && (value === null || (typeof value === "string" && value.trim() === ""))) {
    return <span className="text-muted-foreground">Not provided (optional)</span>;
  }
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

export function IntakeTab({ intake, summary }: {
  intake: InitiativeDetail["intake"];
  summary?: InitiativeDetail["summary"] & { isSeeded?: boolean };
}) {
  const session = useLiveSessionOptional()?.session;
  if (!intake) {
    return <p className="text-sm text-muted-foreground">No intake record.</p>;
  }

  return (
    <div className="space-y-4" data-slot="intake-tab">
      {!intake.submitted ? (
        <Alert className="border-status-warning-fg/20 bg-status-warning-bg">
          <AlertTriangle className="size-4 text-status-warning-fg" aria-hidden />
          <AlertTitle className="text-status-warning-fg">Draft — not yet submitted</AlertTitle>
          <AlertDescription>
            This intake is still in draft. It is created live during the demo
            (champion storyline).
            {intake.missing.length > 0 ? (
              <>
                {" "}
                Completeness check: missing {intake.missing.join(", ")} —
                intake cannot be submitted until complete.
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
                  {ADDITIONAL_FIELD_LABELS[key] ?? FIELD_LABEL[key] ?? key}
                </TableCell>
                <TableCell className="whitespace-pre-wrap">{renderValue(value, key in ADDITIONAL_FIELD_LABELS)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!intake.submitted ? (
        session?.role === "requester" && session.personaLabel === summary?.requester && summary?.isSeeded === false ? (
          <Link className={buttonVariants({ variant: "outline" })} href={`/initiatives/${summary.slug}/edit`}>Continue intake</Link>
        ) : (
          <GatedActionButton label={summary?.isSeeded ? "Example draft — read only" : "Continue intake"} variant="outline" />
        )
      ) : null}
    </div>
  );
}
