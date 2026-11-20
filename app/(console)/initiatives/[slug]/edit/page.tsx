import { notFound } from "next/navigation";
import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";
import { IntakeDraftEditor } from "@/components/jeeves/intake-draft-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { latestQcReturn } from "@/lib/data/qc-return";
import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "Continue intake",
  description:
    "Resume an in-progress AI initiative intake. Save draft keeps your changes as a new draft version. Submit intake sends it for review.",
};

export default async function EditInitiativeDraftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getInitiativeDetailCoherent(slug);
  if (!detail?.summary.initiativeId || detail.summary.state !== "intake_draft") notFound();
  const returned = latestQcReturn(detail.events);
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Continue intake</h1><p className="text-sm text-muted-foreground">Save draft keeps your changes as a new draft version. Submit intake sends it for review.</p></div>
      {returned ? (
        <Alert><AlertTitle>Returned from QC</AlertTitle><AlertDescription>Returned by {returned.actor}: {returned.reason}</AlertDescription></Alert>
      ) : null}
      <IntakeDraftEditor initiativeId={detail.summary.initiativeId} />
    </div>
  );
}
