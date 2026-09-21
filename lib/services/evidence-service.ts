import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { auditEvents, controlDefinitions, evidenceAssessments, evidenceDocuments, evidencePackets, initiatives, reviewCycles, reviewDecisions, riskAssessments } from '../db/schema';
import type { Actor, Domain, OverlayFlags, Tier } from '../domain/types';
import type { EvidenceAssessment, EvidenceDocument, EvidenceEntry, EvidencePacket, EvidenceState } from '../evidence/types';
import { MAX_FILE_BYTES, MAX_INITIATIVE_BYTES } from '../evidence/types';
import { EvidenceError, validateDocument } from '../evidence/files';
import { actorName, reviewerDomainFor } from './actors';
import { applicabilityApplies } from './applicability';
export { EvidenceError } from '../evidence/files';
export type EvidenceViewer = { actor: Actor; workspaceId: string | null };
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Reader = Pick<Db, 'select' | 'execute'>;
type PacketRow = typeof evidencePackets.$inferSelect;
type AssessmentRow = typeof evidenceAssessments.$inferSelect;
const documentColumns = {id:evidenceDocuments.id,fileName:evidenceDocuments.fileName,mediaType:evidenceDocuments.mediaType,byteSize:evidenceDocuments.byteSize,sha256:evidenceDocuments.sha256,scanStatus:evidenceDocuments.scanStatus,version:evidenceDocuments.version,supersedesId:evidenceDocuments.supersedesId,uploadedBy:evidenceDocuments.uploadedBy,createdAt:evidenceDocuments.createdAt};
const editableStates = new Set(['intake_draft','submitted','triaged','in_review','re_review']);
const packetDto=(p:PacketRow):EvidencePacket=>({...p,status:p.status as EvidencePacket['status'],submittedAt:p.submittedAt?.toISOString()??null});
const documentDto=(d:typeof evidenceDocuments.$inferSelect | Omit<typeof evidenceDocuments.$inferSelect,'content'|'initiativeId'|'requestId'>):EvidenceDocument=>({id:d.id,fileName:d.fileName,mediaType:d.mediaType,byteSize:d.byteSize,sha256:d.sha256,scanStatus:'not_scanned',version:d.version,supersedesId:d.supersedesId,uploadedBy:d.uploadedBy,createdAt:d.createdAt.toISOString()});
const sameEntry=(a:EvidenceEntry|undefined,b:EvidenceEntry|undefined)=>JSON.stringify(a??null)===JSON.stringify(b??null);
async function initiativeFor(db:Reader, ref:string, viewer:EvidenceViewer, lock=false) {
  const query=db.select().from(initiatives).where(or(eq(initiatives.id,ref),eq(initiatives.slug,ref))).limit(1);
  const [row]=await (lock?query.for('update'):query);
  if(!row || !viewer.workspaceId || row.workspaceId!==viewer.workspaceId) throw new EvidenceError(404,'Evidence workspace not found.');
  return row;
}
function requireOwner(row:typeof initiatives.$inferSelect, viewer:EvidenceViewer) {
  if(viewer.actor.role!=='requester'||row.requester!==actorName(viewer.actor.id)) throw new EvidenceError(403,'Only the initiative requester may submit evidence.');
  if(!editableStates.has(row.state)) throw new EvidenceError(409,'This initiative is closed to evidence edits.');
}
async function cycleContext(db:Reader, initiativeId:string) {
  const [cycle]=await db.select().from(reviewCycles).where(eq(reviewCycles.initiativeId,initiativeId)).orderBy(desc(reviewCycles.openedAt),desc(reviewCycles.id)).limit(1);
  if(!cycle) return {cycle:null,requirements:[],decisions:[]};
  const [risk]=await db.select().from(riskAssessments).where(eq(riskAssessments.id,cycle.riskAssessmentId));
  const catalog=await db.select().from(controlDefinitions);
  const requirements=catalog.filter(c=>c.domain!=='runtime' && risk.requiredDomains.includes(c.domain) && applicabilityApplies(c.applicability,risk.tier as Tier,risk.flags as unknown as OverlayFlags)).sort((a,b)=>a.id.localeCompare(b.id));
  const decisions=await db.select().from(reviewDecisions).where(eq(reviewDecisions.cycleId,cycle.id));
  return {cycle,requirements,decisions};
}
async function packetHistory(db:Reader, initiativeId:string, cycleId:string|null) {
  if(!cycleId) return {packets:[],assessments:[]};
  const packets=await db.select().from(evidencePackets).where(and(eq(evidencePackets.initiativeId,initiativeId),eq(evidencePackets.cycleId,cycleId))).orderBy(desc(evidencePackets.version));
  const assessments=packets.length?await db.select().from(evidenceAssessments).where(inArray(evidenceAssessments.packetId,packets.map(p=>p.id))):[];
  return {packets,assessments};
}
/** Carry forward only through an unbroken chain of identical requirement bindings. */
function assessmentFor(controlId:string, submitted:PacketRow[], assessments:AssessmentRow[]):EvidenceAssessment|null {
  const latest=submitted[0]; if(!latest) return null;
  const entry=latest.entries.find(e=>e.controlId===controlId);
  for(const packet of submitted) {
    if(!sameEntry(entry,packet.entries.find(e=>e.controlId===controlId))) break;
    const a=assessments.find(a=>a.packetId===packet.id&&a.controlId===controlId);
    if(a) return {...a,decision:a.decision as EvidenceAssessment['decision'],reviewedAt:a.reviewedAt.toISOString(),inherited:a.packetId!==latest.id};
  }
  return null;
}
async function audit(tx:Tx, initiativeId:string, viewer:EvidenceViewer, action:string, detail:string, metadata:Record<string,unknown>) {
  await tx.insert(auditEvents).values({id:`evt-${randomUUID()}`,initiativeId,ts:new Date(),actor:viewer.actor.id,actorRole:viewer.actor.role,action,detail,metadata});
}
export async function getEvidence(db:Reader, ref:string, viewer:EvidenceViewer):Promise<EvidenceState> {
  const initiative=await initiativeFor(db,ref,viewer);
  if(viewer.actor.role==='requester' && initiative.requester!==actorName(viewer.actor.id)) throw new EvidenceError(404,'Evidence workspace not found.');
  const [documents,context]=await Promise.all([db.select(documentColumns).from(evidenceDocuments).where(eq(evidenceDocuments.initiativeId,initiative.id)).orderBy(desc(evidenceDocuments.createdAt)),cycleContext(db,initiative.id)]);
  const {packets,assessments}=await packetHistory(db,initiative.id,context.cycle?.id??null);
  const submitted=packets.filter(p=>p.status==='submitted'),latest=submitted[0];
  return {initiativeId:initiative.id,cycleId:context.cycle?.id??null,canEdit:viewer.actor.role==='requester'&&initiative.requester===actorName(viewer.actor.id)&&editableStates.has(initiative.state)&&!context.cycle?.closedAt,reviewerDomain:viewer.actor.role==='reviewer'&&!context.cycle?.closedAt&&!context.decisions.some(d=>d.domain===reviewerDomainFor(viewer.actor.id)&&d.status==='abstained')?reviewerDomainFor(viewer.actor.id):null,
    documents:documents.map(documentDto),usedBytes:documents.reduce((n,d)=>n+d.byteSize,0),
    requirements:context.requirements.map(r=>{const entry=latest?.entries.find(e=>e.controlId===r.id)??null;const assessment=assessmentFor(r.id,submitted,assessments);return {id:r.id,name:r.name,domain:r.domain,description:r.requiredEvidence,policySource:r.policySource,entry,assessment,status:assessment?.decision??(entry?'submitted':'missing'),signed:context.decisions.some(d=>d.domain===r.domain&&d.status==='signed')};}),
    draft:packets.find(p=>p.status==='draft')?packetDto(packets.find(p=>p.status==='draft')!):null,latest:latest?packetDto(latest):null,
    history:submitted.map(p=>({...packetDto(p),assessments:assessments.filter(a=>a.packetId===p.id).map(a=>({...a,decision:a.decision as EvidenceAssessment['decision'],reviewedAt:a.reviewedAt.toISOString(),inherited:false}))}))};
}
export type UploadEvidenceInput={requestId:string;fileName:string;mediaType:string;contentBase64:string;supersedesId?:string};
export async function uploadEvidence(db:Db, ref:string, viewer:EvidenceViewer, input:UploadEvidenceInput):Promise<EvidenceDocument> {
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestId)||input.contentBase64.length>Math.ceil(MAX_FILE_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) throw new EvidenceError(400,'Invalid upload encoding or request ID.');
  const bytes=Buffer.from(input.contentBase64,'base64');
  const validated=validateDocument(input.fileName,input.mediaType,bytes);
  return db.transaction(async tx=>{
    const initiative=await initiativeFor(tx,ref,viewer,true);requireOwner(initiative,viewer);
    const docs=await tx.select(documentColumns).from(evidenceDocuments).where(eq(evidenceDocuments.initiativeId,initiative.id));
    const [existing]=await tx.select(documentColumns).from(evidenceDocuments).where(and(eq(evidenceDocuments.initiativeId,initiative.id),eq(evidenceDocuments.requestId,input.requestId)));
    if(existing) {
      if(existing.sha256!==validated.sha256||existing.fileName!==input.fileName||existing.supersedesId!==(input.supersedesId??null)) throw new EvidenceError(409,'Upload retry differs from the original request.');
      return documentDto(existing);
    }
    if(docs.length>=40||docs.reduce((n,d)=>n+d.byteSize,0)+bytes.length>MAX_INITIATIVE_BYTES) throw new EvidenceError(413,'This initiative has reached its evidence storage limit (20 MiB or 40 versions).');
    const prior=input.supersedesId?docs.find(d=>d.id===input.supersedesId):null;
    if(input.supersedesId&&!prior) throw new EvidenceError(404,'Previous document not found.');
    if(prior&&docs.some(d=>d.supersedesId===prior.id)) throw new EvidenceError(409,'This document already has a newer version.');
    const row={id:`doc-${randomUUID()}`,initiativeId:initiative.id,requestId:input.requestId,...validated,content:bytes,version:prior?prior.version+1:1,supersedesId:prior?.id??null,uploadedBy:viewer.actor.id,createdAt:new Date()};
    await tx.insert(evidenceDocuments).values(row);
    await audit(tx,initiative.id,viewer,'evidence_uploaded',`Uploaded ${row.fileName}, version ${row.version}.`,{documentId:row.id,sha256:row.sha256,version:row.version,supersedesId:row.supersedesId,scanStatus:row.scanStatus});
    return documentDto(row);
  });
}
function normalizeEntries(entries:EvidenceEntry[]):EvidenceEntry[] {
  if(entries.length>30||new Set(entries.map(e=>e.controlId)).size!==entries.length) throw new EvidenceError(400,'Choose at most one document per requirement (maximum 30 requirements).');
  return entries.map(e=>{if(!e.controlId||!e.documentId||e.pageReference.length>120||e.note.length>2000)throw new EvidenceError(400,'Invalid evidence binding.');return {controlId:e.controlId,documentId:e.documentId,pageReference:e.pageReference.trim(),note:e.note.trim()};}).sort((a,b)=>a.controlId.localeCompare(b.controlId));
}
async function validateBindings(tx:Tx, initiativeId:string, context:Awaited<ReturnType<typeof cycleContext>>, entries:EvidenceEntry[], previous:PacketRow|undefined) {
  const docs=await tx.select({id:evidenceDocuments.id}).from(evidenceDocuments).where(eq(evidenceDocuments.initiativeId,initiativeId));
  for(const e of entries) if(!context.requirements.some(r=>r.id===e.controlId)||!docs.some(d=>d.id===e.documentId)) throw new EvidenceError(400,'Choose documents and requirements from this initiative.');
  for(const r of context.requirements) if(context.decisions.some(d=>d.domain===r.domain&&d.status==='signed')&&!sameEntry(entries.find(e=>e.controlId===r.id),previous?.entries.find(e=>e.controlId===r.id))) throw new EvidenceError(409,'Evidence for a signed domain cannot change in this review cycle.');
}
export async function saveEvidenceDraft(db:Db,ref:string,viewer:EvidenceViewer,input:{cycleId:string;expectedRevision:number;entries:EvidenceEntry[]}):Promise<EvidencePacket> {
  const entries=normalizeEntries(input.entries);
  return db.transaction(async tx=>{
    const initiative=await initiativeFor(tx,ref,viewer,true);requireOwner(initiative,viewer);
    const context=await cycleContext(tx,initiative.id);
    if(!context.cycle||context.cycle.id!==input.cycleId||context.cycle.closedAt) throw new EvidenceError(409,'The review cycle changed. Refresh the evidence checklist.');
    const {packets}=await packetHistory(tx,initiative.id,input.cycleId);
    const draft=packets.find(p=>p.status==='draft'),previous=packets.find(p=>p.status==='submitted');
    if((draft?.revision??0)!==input.expectedRevision) throw new EvidenceError(409,'The evidence draft changed. Reload before saving.');
    await validateBindings(tx,initiative.id,context,entries,previous);
    let result:PacketRow;
    if(draft) {
      [result]=await tx.update(evidencePackets).set({entries,revision:draft.revision+1}).where(eq(evidencePackets.id,draft.id)).returning();
    } else {
      if(packets.length>=100)throw new EvidenceError(413,'This review cycle has reached its submission limit.');
      [result]=await tx.insert(evidencePackets).values({id:`packet-${randomUUID()}`,initiativeId:initiative.id,cycleId:input.cycleId,version:(packets[0]?.version??0)+1,revision:1,status:'draft',entries,createdAt:new Date()}).returning();
    }
    await audit(tx,initiative.id,viewer,'evidence_draft_saved',`Saved evidence draft v${result.version}.`,{packetId:result.id,revision:result.revision,documentIds:entries.map(e=>e.documentId)});
    return packetDto(result);
  });
}
export async function submitEvidence(db:Db,ref:string,viewer:EvidenceViewer,input:{packetId:string;expectedRevision:number}):Promise<EvidencePacket> {
  return db.transaction(async tx=>{
    const initiative=await initiativeFor(tx,ref,viewer,true);requireOwner(initiative,viewer);
    const [packet]=await tx.select().from(evidencePackets).where(and(eq(evidencePackets.id,input.packetId),eq(evidencePackets.initiativeId,initiative.id)));
    if(!packet)throw new EvidenceError(404,'Evidence draft not found.');
    if(packet.revision!==input.expectedRevision) throw new EvidenceError(409,'The evidence draft changed. Reload before submitting.');
    if(packet.status==='submitted')return packetDto(packet);
    const context=await cycleContext(tx,initiative.id);
    if(!context.cycle||context.cycle.id!==packet.cycleId||context.cycle.closedAt)throw new EvidenceError(409,'The review cycle changed.');
    const {packets}=await packetHistory(tx,initiative.id,packet.cycleId);
    await validateBindings(tx,initiative.id,context,packet.entries,packets.find(p=>p.status==='submitted'));
    if(!packet.entries.length)throw new EvidenceError(400,'Attach at least one document before submitting.');
    const [result]=await tx.update(evidencePackets).set({status:'submitted',submittedBy:viewer.actor.id,submittedAt:new Date()}).where(eq(evidencePackets.id,packet.id)).returning();
    await audit(tx,initiative.id,viewer,'evidence_submitted',`Submitted evidence packet v${packet.version}.`,{packetId:packet.id,cycleId:packet.cycleId,entries:packet.entries});
    return packetDto(result);
  });
}
export async function assessEvidence(db:Db,ref:string,viewer:EvidenceViewer,input:{packetId:string;controlId:string;decision:'accepted'|'changes_requested';reason:string}):Promise<void> {
  if(!['accepted','changes_requested'].includes(input.decision)||!input.reason.trim()||input.reason.length>2000)throw new EvidenceError(400,'Include a reviewer reason (1–2000 characters).');
  await db.transaction(async tx=>{
    const initiative=await initiativeFor(tx,ref,viewer,true);
    const context=await cycleContext(tx,initiative.id);
    const requirement=context.requirements.find(r=>r.id===input.controlId);
    if(viewer.actor.role!=='reviewer'||!requirement||reviewerDomainFor(viewer.actor.id)!==requirement.domain)throw new EvidenceError(403,'Only the assigned domain reviewer may assess this evidence.');
    if(context.decisions.some(d=>d.domain===requirement.domain&&d.status==='abstained'))throw new EvidenceError(409,'Resume this review before assessing evidence.');
    if(context.cycle?.closedAt||!editableStates.has(initiative.state)||context.decisions.some(d=>d.domain===requirement.domain&&d.status==='signed'))throw new EvidenceError(409,'This review is closed to evidence assessments.');
    const {packets,assessments}=await packetHistory(tx,initiative.id,context.cycle?.id??null);
    const latest=packets.find(p=>p.status==='submitted');
    if(!latest||latest.id!==input.packetId)throw new EvidenceError(409,'A newer submission is available. Reload before reviewing.');
    const existing=assessments.find(a=>a.packetId===input.packetId&&a.controlId===input.controlId);
    if(existing){if(existing.decision===input.decision&&existing.reason===input.reason.trim()&&existing.reviewer===viewer.actor.id)return;throw new EvidenceError(409,'This assessment is already recorded. Request a new submission to revise it.');}
    const entry=latest.entries.find(e=>e.controlId===input.controlId);
    if(!entry&&input.decision==='accepted')throw new EvidenceError(400,'Missing evidence cannot be accepted.');
    const id=`assessment-${randomUUID()}`;
    await tx.insert(evidenceAssessments).values({id,packetId:latest.id,controlId:input.controlId,decision:input.decision,reason:input.reason.trim(),reviewer:viewer.actor.id,reviewedAt:new Date()});
    await audit(tx,initiative.id,viewer,'evidence_assessed',`${input.controlId}: ${input.decision}. ${input.reason.trim()}`,{assessmentId:id,packetId:latest.id,controlId:input.controlId,documentId:entry?.documentId??null,decision:input.decision});
  });
}
export async function downloadEvidence(db:Db,ref:string,documentId:string,viewer:EvidenceViewer) {
  const initiative=await initiativeFor(db,ref,viewer);
  if(viewer.actor.role==='requester'&&initiative.requester!==actorName(viewer.actor.id))throw new EvidenceError(404,'Document not found.');
  const [doc]=await db.select().from(evidenceDocuments).where(and(eq(evidenceDocuments.id,documentId),eq(evidenceDocuments.initiativeId,initiative.id)));
  if(!doc)throw new EvidenceError(404,'Document not found.');
  return {document:documentDto(doc),bytes:Buffer.from(doc.content)};
}
/** Called inside the signReview transaction after locking the same initiative row. */
export async function evidenceForSignature(tx:Reader,initiativeId:string,cycleId:string,domain:Domain) {
  // Rolling deployments may run this application before additive migration 0011.
  // Only an absent table enables legacy behavior; all database errors propagate.
  const presence = await tx.execute(sql`SELECT to_regclass('public.evidence_packets')::text AS relation`);
  const rows = (Array.isArray(presence) ? presence : presence.rows) as {relation:string|null}[];
  if (rows[0]?.relation === null) return null;
  const {packets,assessments}=await packetHistory(tx,initiativeId,cycleId);
  if(!packets.length)return null; // Existing reviews retain their historical contract.
  const context=await cycleContext(tx,initiativeId);
  if(context.cycle?.id!==cycleId)throw new EvidenceError(409,'Evidence belongs to a newer review cycle.');
  const submitted=packets.filter(p=>p.status==='submitted');
  const required=context.requirements.filter(r=>r.domain===domain);
  const bindings=required.map(r=>({controlId:r.id,entry:submitted[0]?.entries.find(e=>e.controlId===r.id),assessment:assessmentFor(r.id,submitted,assessments)}));
  if(bindings.some(b=>!b.entry||b.assessment?.decision!=='accepted'))throw new EvidenceError(409,'Required evidence is missing or awaits reviewer acceptance. Open the Evidence tab.');
  const draft=packets.find(p=>p.status==='draft');
  if(draft&&bindings.some(b=>!sameEntry(b.entry,draft.entries.find(e=>e.controlId===b.controlId))))throw new EvidenceError(409,'An evidence revision is still a draft. Submit and review it before signing.');
  return {packetId:submitted[0]?.id??null,bindings:bindings.map(b=>({controlId:b.controlId,documentId:b.entry!.documentId,assessmentId:b.assessment!.id,assessmentPacketId:b.assessment!.packetId}))};
}
