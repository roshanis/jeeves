"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle, BookOpen, CheckCircle2, Database, Download, FileText, LockKeyhole, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewRow } from "@/lib/data/dto";
import type { Domain } from "@/lib/domain/types";
import type { EvidenceRequirement, EvidenceState } from "@/lib/evidence/types";
import { isApiError } from "@/lib/client/api";
import { downloadEvidenceFile, evidenceRequest } from "@/lib/client/evidence-api";
import { domainForPersona } from "@/lib/client/personas";
import { useLiveSessionOptional, type LiveSession } from "@/lib/client/session-context";

const STATUS_LABEL = {
  missing: "Missing evidence",
  submitted: "Awaiting assessment",
  accepted: "Reviewer accepted",
  changes_requested: "Changes requested",
} as const;

type Source =
  | { id: string; kind: "requirement"; label: string; requirement: EvidenceRequirement }
  | { id: string; kind: "citation"; label: string }
  | { id: "arize" | "wandb"; kind: "connector"; label: string };

export interface EvidenceReviewContext {
  signingBlock: string | null;
  cycleId: string | null;
  cycleChanged: boolean;
}

interface Props {
  slug: string;
  domain: Domain;
  citations: string[];
  reviewStatus: ReviewRow["status"];
  reviewCycleId?: string;
  children: (context: EvidenceReviewContext) => React.ReactNode;
}

/** Private evidence is scoped to this selection AND the authenticated session.
 * A key change discards the previous response before the next effect runs. */
export function ReviewEvidenceWorkspace(props: Props) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  return <EvidenceWorkspace
    key={`${props.slug}:${props.domain}:${session?.token ?? "public"}:${props.reviewStatus}:${props.reviewCycleId ?? "legacy"}`}
    {...props}
    session={session}
    onExpired={() => live?.logout()}
    onUnlock={() => live?.startDemo()}
  />;
}

// This is explanatory UI, not authorization. The sign API rechecks packet,
// version, domain, evidence acceptance and any draft changes atomically.
function signatureBlock(state: EvidenceState, domain: Domain): string | null {
  if (!state.latest && !state.draft && state.history.length === 0) return null;
  const required = state.requirements.filter((r) => r.domain === domain);
  if (required.some((r) => !r.entry || r.status !== "accepted")) {
    return "Required evidence is missing or awaits reviewer acceptance.";
  }
  if (state.draft && required.some((r) => {
    const draft = state.draft!.entries.find((entry) => entry.controlId === r.id);
    return draft?.documentId !== r.entry?.documentId ||
      draft?.pageReference !== r.entry?.pageReference || draft?.note !== r.entry?.note;
  })) return "An evidence revision is still a draft. Submit and review it before signing.";
  return null;
}

function errorMessage(error: unknown): string {
  if (isApiError(error) && error.status === 404) {
    return "Shared examples do not have private evidence packets. Open a case in your live workspace to review submitted documents.";
  }
  if (isApiError(error) && error.status === 401) return "Your session expired. Start the demo again.";
  return error instanceof Error ? error.message : "Evidence could not be loaded.";
}

function EvidenceWorkspace({ slug, domain, citations, reviewStatus, reviewCycleId, session, onExpired, onUnlock, children }: Props & {
  session: LiveSession | null;
  onExpired: () => void;
  onUnlock: () => void;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<EvidenceState | null>(null);
  const [loading, setLoading] = React.useState(Boolean(session));
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const sourcePanelId = React.useId();

  // The wrapper remounts on slug/domain/token/status changes, including a
  // logout. Abort + active protect against clients that resolve after abort.
  React.useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let active = true;
    evidenceRequest(slug, session.token, undefined, controller.signal)
      .then((next) => { if (active) setState(next); })
      .catch((err: unknown) => { if (active) setError(errorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [slug, session, retry]);

  const cycleChanged = Boolean(reviewCycleId && state && state.cycleId !== reviewCycleId);
  const requirements = cycleChanged ? [] : state?.requirements.filter((r) => r.domain === domain) ?? [];
  const sources: Source[] = [
    ...requirements.map((requirement): Source => ({ id: `requirement:${requirement.id}`, kind: "requirement", label: requirement.name, requirement })),
    ...[...new Set(citations)].map((label): Source => ({ id: `citation:${label}`, kind: "citation", label })),
    { id: "arize", kind: "connector", label: "Arize evaluations" },
    { id: "wandb", kind: "connector", label: "W&B training provenance" },
  ];
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0];
  const evidenceHref = `/initiatives/${encodeURIComponent(slug)}?tab=evidence`;
  const signingBlock = loading || pending
    ? "Checking the submitted evidence…"
    : error ? "Evidence could not be checked. Refresh it before signing."
      : cycleChanged ? "A newer review cycle is available. Refresh this page before assessing evidence or signing."
      : state ? signatureBlock(state, domain) : null;

  function refresh() {
    setLoading(true);
    setError("");
    setNotice("");
    setRetry((value) => value + 1);
    router.refresh();
  }

  async function assess(requirement: EvidenceRequirement, decision: "accepted" | "changes_requested", reason: string) {
    if (!session || !state?.latest || pending || cycleChanged) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await evidenceRequest(slug, session.token, { action: "assess", packetId: state.latest.id, controlId: requirement.id, decision, reason: reason.trim() });
      const next = await evidenceRequest(slug, session.token);
      setState(next);
      setNotice("Evidence assessment recorded. Domain sign-off is a separate step.");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (isApiError(err) && err.status === 401) onExpired();
    } finally {
      setPending(false);
    }
  }

  async function download(documentId: string, fileName: string) {
    if (!session || pending) return;
    setPending(true);
    try {
      await downloadEvidenceFile(slug, session.token, documentId, fileName);
    } catch (err) {
      setError(errorMessage(err));
      if (isApiError(err) && err.status === 401) onExpired();
    } finally {
      setPending(false);
    }
  }

  return <div data-slot="evidence-review-workspace" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <LockKeyhole className="size-4 shrink-0 text-primary" aria-hidden />
        <span>{cycleChanged ? "Review refresh required" : state?.latest ? `Submitted packet · v${state.latest.version}` : "Evidence and policy references"}</span>
        {!cycleChanged && state?.latest?.submittedAt ? <span className="hidden text-xs text-muted-foreground sm:inline">{state.latest.submittedAt.slice(0, 10)}</span> : null}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <Link href={evidenceHref} className="font-medium text-primary underline-offset-4 hover:underline">Manage evidence &amp; history</Link>
        {session ? <Button variant="ghost" size="sm" onClick={refresh} disabled={loading || pending} aria-label="Refresh evidence"><RefreshCw className="size-3.5" aria-hidden />Refresh</Button> : null}
      </div>
    </div>
    {!session ? <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <p>Start the demo to view private submitted evidence. Policy references remain read-only.</p>
      <Button variant="outline" size="sm" onClick={onUnlock}>Start demo</Button>
    </div> : null}
    {error ? <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-center gap-3"><AlertCircle className="size-4 shrink-0" aria-hidden /><p className="min-w-0 flex-1">{error}</p><Button variant="outline" size="sm" onClick={refresh} disabled={loading || pending}>Retry evidence</Button></div>
      <p className="text-xs leading-relaxed"><Link href={`/initiatives/${encodeURIComponent(slug)}?tab=reviews`} className="font-medium underline underline-offset-4">Open initiative reviews</Link> to retry your domain review there. All evidence and sign-off requirements still apply.</p>
    </div> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.45fr)_minmax(0,1fr)]" data-slot="review-columns">
      <Card className="min-w-0 overflow-hidden bg-muted/20">
        <CardHeader className="border-b py-4"><CardTitle>Evidence sources</CardTitle><p className="text-xs text-muted-foreground">Requirements, references, and source availability</p></CardHeader>
        <CardContent className="space-y-4 px-3 pt-4">
          {loading ? <p role="status" className="px-2 text-sm text-muted-foreground">Loading submitted evidence…</p> : null}
          {!cycleChanged && state && !state.latest ? <p className="px-2 text-sm text-muted-foreground">No evidence submitted yet.</p> : null}
          <nav aria-label="Evidence sources for this review" className="flex flex-col gap-1">
            {sources.map((source) => {
              const active = selected?.id === source.id;
              const Icon = source.kind === "requirement" ? FileText : source.kind === "citation" ? BookOpen : source.id === "arize" ? Activity : Database;
              return <button type="button" key={source.id} aria-pressed={active} aria-controls={sourcePanelId} onClick={() => setSelectedId(source.id)} className={`flex min-w-0 gap-2.5 rounded-md border-l-2 px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary/10 text-foreground" : "border-transparent hover:bg-muted"}`}>
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 space-y-1"><span className="line-clamp-2 break-words font-medium" title={source.label}>{source.kind === "requirement" ? `${source.requirement.id} · ` : ""}{source.label}</span><span className="block text-xs text-muted-foreground">{source.kind === "requirement" ? STATUS_LABEL[source.requirement.status] : source.kind === "citation" ? "Policy citation" : "Not connected"}</span></span>
              </button>;
            })}
          </nav>
          <p className="border-t px-2 pt-3 text-xs leading-relaxed text-muted-foreground">Uploaded drafts are not submitted evidence. Each requirement is assessed separately.</p>
        </CardContent>
      </Card>
      <Card id={sourcePanelId} role="region" aria-label="Selected evidence source" className="min-w-0 overflow-hidden">
        {cycleChanged ? <>
          <CardHeader className="border-b py-4"><CardTitle>Source snapshot changed</CardTitle></CardHeader>
          <CardContent className="pt-6 text-sm leading-relaxed text-muted-foreground">Refresh to load the current review and its matching evidence. The newer sources are hidden until they match the review cycle.</CardContent>
        </> : selected?.kind === "requirement" && state ? <RequirementSource
          key={`${selected.id}:${state.latest?.id}:${selected.requirement.assessment?.id ?? "unassessed"}`}
          requirement={selected.requirement}
          state={state}
          canAssess={Boolean(!cycleChanged && session?.role === "reviewer" && domainForPersona(session.personaKey) === domain && state.reviewerDomain === domain && state.latest && !selected.requirement.signed && reviewStatus !== "signed" && selected.requirement.assessment?.packetId !== state.latest.id)}
          busy={pending || loading || Boolean(error)}
          onAssess={assess}
          onDownload={download}
          evidenceHref={evidenceHref}
        /> : selected?.kind === "citation" ? <>
          <CardHeader className="border-b py-4"><p className="kicker">Policy reference</p><CardTitle className="break-words leading-snug">{selected.label}</CardTitle></CardHeader>
          <CardContent className="space-y-5 pt-6 text-sm leading-relaxed">
            <BookOpen className="size-9 text-primary/70" aria-hidden />
            <p>This citation was supplied with the agent draft. Check the named policy and version before signing.</p>
            <p className="rounded-lg border bg-muted/30 p-4 text-muted-foreground">The policy text is not included in this evidence packet. A citation alone does not demonstrate that a requirement is satisfied.</p>
            <Link href={evidenceHref} className="font-medium text-primary hover:underline">View requirements and submitted evidence</Link>
          </CardContent>
        </> : <>
          <CardHeader className="border-b py-4"><p className="kicker">{selected?.label}</p><CardTitle className="leading-snug">{selected?.id === "arize" ? "Evaluation evidence is not connected" : "Training provenance is not connected"}</CardTitle></CardHeader>
          <CardContent className="space-y-5 pt-6 text-sm leading-relaxed">
            <span className="inline-flex rounded-full border bg-muted px-3 py-1 text-xs font-medium">Not connected</span>
            <p>{selected?.id === "arize" ? "No Arize evaluation results have been imported into this review packet. Synthetic monitoring charts are not candidate-specific evaluation evidence." : "No W&B dataset artifacts, training runs, or model lineage have been imported into this review packet."}</p>
            <p className="rounded-lg border bg-muted/30 p-4 text-muted-foreground">{selected?.id === "arize" ? "Evaluation evidence needs an exact model version, evaluation dataset, evaluator settings, and results." : "Training evidence needs an exact dataset version, training run, and output model. Lineage alone does not establish data-use rights."}</p>
            <Link href={evidenceHref} className="font-medium text-primary hover:underline">View evidence requirements</Link>
          </CardContent>
        </>}
      </Card>
      {children({ signingBlock, cycleId: cycleChanged ? null : state?.cycleId ?? null, cycleChanged })}
    </div>
    <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />Submitted documents and requirement assessments are versioned. Domain signatures and the accountable approver’s decision remain separate.</p>
  </div>;
}

function RequirementSource({ requirement, state, canAssess, busy, onAssess, onDownload, evidenceHref }: {
  requirement: EvidenceRequirement;
  state: EvidenceState;
  canAssess: boolean;
  busy: boolean;
  onAssess: (requirement: EvidenceRequirement, decision: "accepted" | "changes_requested", reason: string) => Promise<void>;
  onDownload: (id: string, name: string) => Promise<void>;
  evidenceHref: string;
}) {
  const [reason, setReason] = React.useState("");
  const reasonId = React.useId();
  // Deliberately use the submitted binding, never the newest uploaded file.
  const document = state.documents.find((doc) => doc.id === requirement.entry?.documentId);
  const accepted = requirement.status === "accepted";
  return <>
    <CardHeader className="border-b py-4">
      <p className="kicker">{requirement.id} · Submitted source</p>
      <CardTitle className="break-words leading-snug">{document?.fileName ?? requirement.name}</CardTitle>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {document ? <span>Document v{document.version} · {document.mediaType === "application/pdf" ? "PDF" : "DOCX"}</span> : null}
        <span className={accepted ? "text-primary" : ""}>{STATUS_LABEL[requirement.status]}</span>
      </div>
    </CardHeader>
    <CardContent className="space-y-5 pt-5 text-sm">
      <section className="space-y-2"><h3 className="font-medium">Requirement</h3><p className="leading-relaxed text-muted-foreground">{requirement.description}</p>{requirement.policySource ? <p className="break-words text-xs text-muted-foreground">Policy: {requirement.policySource}</p> : null}</section>
      {document && requirement.entry ? <>
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="mb-4 flex items-start justify-between gap-3"><FileText className="size-8 text-primary/70" aria-hidden /><span className="text-xs text-muted-foreground">Submitted document</span></div>
          <dl className="space-y-4">
            <div><dt className="text-xs font-medium text-muted-foreground">Page reference supplied by requester</dt><dd className="mt-1 break-words">{requirement.entry.pageReference || "No page reference supplied."}</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Requester-supplied context</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{requirement.entry.note || "No supporting note supplied."}</dd></div>
          </dl>
          <div className="mt-5 border-t pt-4"><Button variant="outline" disabled={busy} onClick={() => void onDownload(document.id, document.fileName)}><Download className="size-4" aria-hidden />Download submitted document</Button><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Preview unavailable. This file is not parsed, sent to AI, or malware scanned. Review fictional documents only.</p></div>
        </div>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Document identity</summary><dl className="mt-3 space-y-2"><div><dt>Uploaded</dt><dd>{document.createdAt.slice(0, 10)}</dd></div><div><dt>SHA-256</dt><dd className="break-all font-mono">{document.sha256}</dd></div></dl></details>
      </> : <div className="rounded-lg border border-dashed p-5 text-muted-foreground"><FileText className="mb-3 size-8" aria-hidden /><p>No submitted document is linked to this requirement.</p><Link href={evidenceHref} className="mt-3 inline-block font-medium text-primary hover:underline">Open initiative evidence</Link></div>}
      {requirement.assessment ? <section className="space-y-2 rounded-lg border p-4" aria-label="Recorded evidence assessment"><h3 className="flex items-center gap-2 font-medium">{accepted ? <CheckCircle2 className="size-4 text-primary" aria-hidden /> : <AlertCircle className="size-4 text-amber-600" aria-hidden />}{STATUS_LABEL[requirement.status]}</h3><p className="whitespace-pre-wrap break-words">{requirement.assessment.reason}</p><p className="text-xs text-muted-foreground">{requirement.assessment.reviewer} · {requirement.assessment.reviewedAt.slice(0, 10)}{requirement.assessment.inherited ? " · Carried forward from an unchanged submission" : ""}</p></section> : null}
      {canAssess ? <section className="space-y-3 border-t pt-4" aria-label="Assess selected evidence"><p className="text-xs leading-relaxed text-muted-foreground">Assess this requirement’s evidence before signing the domain review.</p><label htmlFor={reasonId} className="block text-sm font-medium">Evidence assessment reason</label><textarea id={reasonId} className="min-h-24 w-full rounded-md border bg-transparent p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} disabled={busy} /><div className="flex flex-wrap gap-2"><Button disabled={busy || !reason.trim() || !requirement.entry} onClick={() => void onAssess(requirement, "accepted", reason)}>Accept evidence</Button><Button variant="outline" disabled={busy || !reason.trim()} onClick={() => void onAssess(requirement, "changes_requested", reason)}>Request changes</Button></div></section> : null}
      {requirement.signed ? <p className="text-xs text-muted-foreground">This domain is signed. Its evidence is preserved for this review cycle.</p> : null}
    </CardContent>
  </>;
}
