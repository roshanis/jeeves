// Intake tab (ui-spec §3.2): read-only rendering of the submitted
// IntakeVersion, or the "Draft — not yet submitted" state for the champion.
import type { InitiativeDetail } from "@/lib/data/dto";
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
};

function renderValue(value: string | boolean | null): React.ReactNode {
  if (value === null) {
    return <Badge variant="destructive">Missing</Badge>;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return value;
}

export function IntakeTab({ intake }: { intake: InitiativeDetail["intake"] }) {
  if (!intake) {
    return <p className="text-sm text-muted-foreground">No intake record.</p>;
  }

  return (
    <div className="space-y-4" data-slot="intake-tab">
      {!intake.submitted ? (
        <Alert>
          <AlertTitle>Draft — not yet submitted</AlertTitle>
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Answer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(intake.fields).map(([key, value]) => (
            <TableRow key={key}>
              <TableCell className="whitespace-normal font-medium">
                {FIELD_LABEL[key] ?? key}
              </TableCell>
              <TableCell className="whitespace-normal">{renderValue(value)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {!intake.submitted ? (
        <GatedActionButton label="Continue intake" variant="outline" />
      ) : null}
    </div>
  );
}
