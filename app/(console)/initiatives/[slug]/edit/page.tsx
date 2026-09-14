import { notFound } from "next/navigation";
import { getInitiativeDetailCoherent } from "@/app/_lib/data-provider";
import { IntakeDraftEditor } from "@/components/jeeves/intake-draft-editor";
import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "Continue intake",
  description:
    "Resume an in-progress AI initiative intake. Changes are saved as a new draft version on submit.",
};

export default async function EditInitiativeDraftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getInitiativeDetailCoherent(slug);
  if (!detail?.summary.initiativeId || detail.summary.state !== "intake_draft") notFound();
  return (
    <div className="flex flex-col gap-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Continue intake</h1><p className="text-sm text-muted-foreground">Changes are saved as a new draft version when you submit.</p></div>
      <IntakeDraftEditor initiativeId={detail.summary.initiativeId} />
    </div>
  );
}
