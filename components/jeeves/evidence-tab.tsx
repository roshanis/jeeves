'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLiveSessionOptional } from '@/lib/client/session-context';
import { evidenceRequest, downloadEvidenceFile, fileBase64 } from '@/lib/client/evidence-api';
import { ApiError } from '@/lib/client/api';
import { MAX_FILE_BYTES, type EvidenceDocument, type EvidenceEntry, type EvidencePacket, type EvidenceState } from '@/lib/evidence/types';

const inputClass='w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60';
const statusLabels={missing:'Missing',submitted:'Submitted',accepted:'Reviewer accepted',changes_requested:'Changes requested'};
function message(error:unknown) {
  if(error instanceof ApiError && error.status===401)return 'Your session expired. Start the demo again.';
  if(error instanceof ApiError && error.status===404)return 'Evidence uploads are available for initiatives created in your live demo workspace. Shared sample initiatives are read-only here.';
  return error instanceof Error?error.message:'Evidence could not be loaded. Please retry.';
}
export function EvidenceTab({slug}:{slug:string}) {
  const live=useLiveSessionOptional();
  return <section className="space-y-5" aria-label="Evidence" data-slot="evidence-tab">
    <div><h2 className="text-lg font-semibold">Evidence</h2><p className="mt-1 text-sm text-muted-foreground">Attach documents to the requirements they support. Reviewers assess each requirement separately.</p></div>
    <div className="rounded-lg border bg-muted/40 p-3 text-sm"><strong>Fictional documents only.</strong> PDF or DOCX, up to 2 MiB each. Files are <strong>not malware scanned</strong>. Upload only synthetic Meridian Health material. Documents are downloaded as attachments; Jeeves does not parse them or send them to AI.</div>
    {!live?.session?<div className="rounded-lg border p-5"><p className="text-sm">Start the demo to work with private evidence in your workspace.</p><Button className="mt-3" onClick={()=>live?.startDemo()}>Start demo</Button></div>:<EvidenceWorkspace key={`${slug}:${live.session.token}`} slug={slug} token={live.session.token}/>}
  </section>;
}
function EvidenceWorkspace({slug,token}:{slug:string;token:string}) {
  const router=useRouter();
  const [state,setState]=useState<EvidenceState|null>(null);
  const [entries,setEntries]=useState<EvidenceEntry[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [pendingSubmission,setPendingSubmission]=useState<{id:string;revision:number}|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [uploadRequestId,setUploadRequestId]=useState('');
  const [supersedesId,setSupersedesId]=useState('');
  const [fictional,setFictional]=useState(false);
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    evidenceRequest<EvidenceState>(slug,token,undefined,controller.signal).then(next=>{setState(next);setEntries(next.draft?.entries??next.latest?.entries??[]);setPendingSubmission(null);setError(null);}).catch(e=>{if(!controller.signal.aborted)setError(message(e));});
    return ()=>controller.abort();
  },[slug,token,retry]);
  async function refresh(preserveEdits=false) {
    const next=await evidenceRequest<EvidenceState>(slug,token);setState(next);
    if(!preserveEdits)setEntries(next.draft?.entries??next.latest?.entries??[]);
    router.refresh();
  }
  async function perform(action:()=>Promise<void>) {setBusy(true);setError(null);setNotice('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}}
  function chooseFile(selected:File|undefined) {
    if(!selected)return;
    if(selected.size>MAX_FILE_BYTES){setError('Choose a document of 2 MiB or less.');return;}
    setFile(selected);setUploadRequestId(crypto.randomUUID());setError(null);
  }
  function bind(controlId:string,changes:Partial<EvidenceEntry>) {
    setEntries(previous=>{const existing=previous.find(e=>e.controlId===controlId)??{controlId,documentId:'',pageReference:'',note:''};const next={...existing,...changes};return [...previous.filter(e=>e.controlId!==controlId),...(next.documentId?[next]:[])];});
  }
  async function save(submit:boolean) {
    if(!state?.cycleId)return;
    let packet=pendingSubmission;
    if(!packet){
      const draft=await evidenceRequest<EvidencePacket>(slug,token,{action:'save_draft',cycleId:state.cycleId,expectedRevision:state.draft?.revision??0,entries});
      setState({...state,draft});packet={id:draft.id,revision:draft.revision};
    }
    if(submit){
      // Retry this exact packet if submission or the following read loses its response.
      setPendingSubmission(packet);
      await evidenceRequest(slug,token,{action:'submit',packetId:packet.id,expectedRevision:packet.revision});
    }
    await refresh();setPendingSubmission(null);setNotice(submit?'Evidence submitted. Assigned reviewers can now assess it.':'Draft saved. It has not been submitted for review.');
  }
  async function upload() {
    if(!file)return;
    const doc=await evidenceRequest<EvidenceDocument>(slug,token,{action:'upload',requestId:uploadRequestId,fileName:file.name,mediaType:file.type||(file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),contentBase64:await fileBase64(file),...(supersedesId?{supersedesId}:{})});
    if(supersedesId)setEntries(previous=>previous.map(e=>e.documentId===supersedesId?{...e,documentId:doc.id}:e));
    await refresh(true);setFile(null);setUploadRequestId('');setSupersedesId('');setFictional(false);setNotice('Document saved privately. Link it to a requirement and submit it for review.');
  }
  return <div className="space-y-5">
    {error?<div role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p><Button variant="outline" className="mt-2" disabled={busy} onClick={()=>{setError(null);setRetry(n=>n+1);}}>Reload evidence</Button></div>:null}
    {notice?<p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">{notice}</p>:null}
    {pendingSubmission?<p className="rounded-md border border-amber-300 p-3 text-sm">Submission confirmation pending. Retry submission safely or reload evidence before editing.</p>:null}
    {!state&&!error?<p role="status">Loading evidence…</p>:null}
    {state?<>
      {state.canEdit?<fieldset disabled={busy||!!pendingSubmission} className="min-w-0 space-y-3 rounded-lg border p-4" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy&&!pendingSubmission)chooseFile(e.dataTransfer.files[0]);}}>
        <h3 className="font-medium flex items-center gap-2"><Upload className="size-4"/>Add a document</h3>
        <p className="text-sm text-muted-foreground">Drop a file here or choose one. Reuse it for several requirements below.</p>
        <label className="block text-sm" htmlFor="evidence-file">Choose document</label><input id="evidence-file" className={inputClass} type="file" accept=".pdf,.docx" disabled={busy} onChange={e=>chooseFile(e.target.files?.[0])}/>
        {file?<p className="text-sm">Selected: {file.name} ({Math.ceil(file.size/1024)} KiB)</p>:null}
        <label className="block text-sm" htmlFor="evidence-replaces">Document version</label><select id="evidence-replaces" className={inputClass} disabled={busy} value={supersedesId} onChange={e=>{setSupersedesId(e.target.value);setUploadRequestId(crypto.randomUUID());}}><option value="">New document</option>{state.documents.filter(d=>!state.documents.some(next=>next.supersedesId===d.id)).map(d=><option value={d.id} key={d.id}>New version of {d.fileName} (v{d.version})</option>)}</select>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={fictional} onChange={e=>setFictional(e.target.checked)} disabled={busy}/>This document is fictional and contains no real personal, health, or company data.</label>
        <Button disabled={!file||!fictional||busy} onClick={()=>void perform(upload)}>Upload document</Button><span className="ml-3 text-xs text-muted-foreground">{(state.usedBytes/1024/1024).toFixed(1)} / 20 MiB used</span>
      </fieldset>:null}
      {!state.cycleId?<p className="rounded-lg border p-4 text-sm">You can save documents now. Complete intake and run triage to see the applicable evidence requirements.</p>:<>
        <div><h3 className="font-medium">Required evidence</h3><p className="text-sm text-muted-foreground">Submitted files await reviewer assessment. Acceptance confirms evidence sufficiency; it does not approve the initiative.</p></div>
        {state.requirements.length===0?<p className="text-sm">No document requirements apply to this review cycle.</p>:null}
        {state.requirements.map(r=>{
          const entry=entries.find(e=>e.controlId===r.id);
          const draftDiffers=(entry?.documentId??'')!==(r.entry?.documentId??'')||(entry?.pageReference??'')!==(r.entry?.pageReference??'')||(entry?.note??'')!==(r.entry?.note??'');
          const submittedDoc=state.documents.find(d=>d.id===r.entry?.documentId);
          const canAssess=state.reviewerDomain===r.domain&&state.latest&&!r.signed&&r.assessment?.packetId!==state.latest.id;
          return <article key={r.id} className="space-y-3 rounded-lg border p-4" aria-label={`${r.id} ${r.name}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-medium"><span className="font-mono text-xs text-muted-foreground">{r.id}</span> {r.name}</h4><span className={`rounded-full border px-2 py-0.5 text-xs ${r.status==='changes_requested'?'text-destructive':''}`}>{statusLabels[r.status]}</span></div>
            {draftDiffers&&!pendingSubmission?<p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">Draft changes are not submitted. The review status refers to the last submitted document.</p>:null}
            <p className="text-sm">{r.description}</p>{r.policySource?<p className="text-xs text-muted-foreground">Required by {r.policySource}</p>:null}
            {r.assessment?<div className="rounded-md bg-muted/50 p-3 text-sm"><p>{r.assessment.reason}</p><p className="mt-1 text-xs text-muted-foreground">{r.assessment.reviewer} · {new Date(r.assessment.reviewedAt).toLocaleDateString()}{r.assessment.inherited?' · Carried forward from an unchanged submission':''}</p></div>:null}
            {submittedDoc?<div className="text-sm"><p>Submitted: {submittedDoc.fileName} · v{submittedDoc.version}{r.entry?.pageReference?` · Pages ${r.entry.pageReference}`:''}</p>{r.entry?.note?<p className="text-muted-foreground">{r.entry.note}</p>:null}<Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(()=>downloadEvidenceFile(slug,token,submittedDoc.id,submittedDoc.fileName))}><Download className="size-3"/>Download submitted document</Button></div>:null}
            {r.signed?<p className="text-xs text-muted-foreground">This domain is signed. Its evidence is preserved for this review cycle.</p>:null}
            {state.canEdit&&!r.signed?<fieldset disabled={busy||!!pendingSubmission} className="grid min-w-0 gap-3">
              <label className="text-sm">Document for {r.id}<select className={`${inputClass} mt-1`} value={entry?.documentId??''} disabled={busy} onChange={e=>bind(r.id,{documentId:e.target.value})}><option value="">Choose an uploaded document</option>{state.documents.map(d=><option value={d.id} key={d.id}>{d.fileName} · v{d.version}</option>)}</select></label>
              {entry?<><label className="text-sm">Relevant pages for {r.id} (optional)<input className={`${inputClass} mt-1`} maxLength={120} value={entry.pageReference} disabled={busy} onChange={e=>bind(r.id,{pageReference:e.target.value})}/></label><label className="text-sm">What this demonstrates for {r.id}<textarea className={`${inputClass} mt-1`} maxLength={2000} value={entry.note} disabled={busy} onChange={e=>bind(r.id,{note:e.target.value})}/></label></>:null}
            </fieldset>:null}
            {canAssess?<div className="space-y-2 border-t pt-3"><label className="text-sm">Reviewer reason for {r.id}<textarea className={`${inputClass} mt-1`} maxLength={2000} value={reasons[r.id]??''} disabled={busy} onChange={e=>setReasons({...reasons,[r.id]:e.target.value})}/></label><div className="flex flex-wrap gap-2">{(['accepted','changes_requested'] as const).map(decision=><Button key={decision} variant={decision==='accepted'?'default':'outline'} disabled={busy||!reasons[r.id]?.trim()||(decision==='accepted'&&!r.entry)} onClick={()=>void perform(async()=>{await evidenceRequest(slug,token,{action:'assess',packetId:state.latest!.id,controlId:r.id,decision,reason:reasons[r.id]});await refresh();setNotice('Reviewer assessment recorded.');})}>{decision==='accepted'?'Accept evidence':'Request changes'}</Button>)}</div></div>:null}
          </article>;
        })}
        {state.canEdit&&state.requirements.some(r=>!r.signed)?<div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy||!!pendingSubmission} onClick={()=>void perform(()=>save(false))}>Save evidence draft</Button><Button disabled={busy||entries.length===0} onClick={()=>void perform(()=>save(true))}>{pendingSubmission?'Retry submission':state.latest?'Submit revised evidence':'Submit evidence for review'}</Button><span className="text-xs text-muted-foreground">{entries.length} requirement(s) linked. {state.draft?'Saved draft available.':'Submission preserves an exact snapshot.'}</span></div>:null}
      </>}
      <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Document library and version history ({state.documents.length})</summary><div className="mt-3 space-y-3">{state.documents.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><div className="text-sm"><p className="flex items-center gap-2"><FileText className="size-4"/>{d.fileName} · v{d.version}</p><p className="text-xs text-muted-foreground">{Math.ceil(d.byteSize/1024)} KiB · {new Date(d.createdAt).toLocaleDateString()} · Not malware scanned</p><p className="max-w-lg break-all font-mono text-xs text-muted-foreground">SHA-256: {d.sha256}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>void perform(()=>downloadEvidenceFile(slug,token,d.id,d.fileName))}>Download {d.fileName} v{d.version}</Button></div>)}</div></details>
      <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Submission history ({state.history.length})</summary><div className="mt-3 space-y-3">{state.history.map(p=><div key={p.id} className="border-t pt-3 text-sm"><p>Submission v{p.version} · {p.submittedAt?new Date(p.submittedAt).toLocaleString():''}</p>{p.entries.map(e=><p key={e.controlId}>{e.controlId}: {state.documents.find(d=>d.id===e.documentId)?.fileName} · document v{state.documents.find(d=>d.id===e.documentId)?.version}{e.pageReference?` · Pages ${e.pageReference}`:''}</p>)}{p.assessments.map(a=><p key={a.id} className="text-muted-foreground">{a.controlId}: {statusLabels[a.decision]} — {a.reason}</p>)}</div>)}</div></details>
    </>:null}
  </div>;
}
