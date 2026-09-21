// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, closeTestDb, type TestDb } from '../db/test-client';
import { initiatives, controlDefinitions, intakeVersions, riskAssessments, reviewCycles, reviewDecisions, auditEvents, evidenceDocuments, evidencePackets } from '../db/schema';
import { getEvidence, uploadEvidence, saveEvidenceDraft, submitEvidence, assessEvidence, downloadEvidence } from './evidence-service';
import { signReview, abstainReview, resumeReview } from './initiative-service';
const owner = { actor: { id: 'priya-raman', role: 'requester' as const }, workspaceId: 'workspace-a' };
const reviewer = { actor: { id: 'marcus-webb', role: 'reviewer' as const }, workspaceId: 'workspace-a' };
const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  const now = new Date();
  await db.insert(initiatives).values({id:'i',slug:'evidence-case',title:'Evidence case',requester:'Priya Raman',workspaceId:'workspace-a',state:'in_review',tier:'high',createdAt:now,updatedAt:now});
  await db.insert(intakeVersions).values({id:'intake',initiativeId:'i',version:1,submitted:true,fields:{},missing:[],createdAt:now});
  await db.insert(riskAssessments).values({id:'risk',initiativeId:'i',version:1,intakeVersionId:'intake',tier:'high',flags:{phi:true,memberFacing:false,careCoverageInfluence:false,vendorHosted:true,humanInLoop:true,individualImpact:false},requiredDomains:['privacy-hipaa'],createdAt:now});
  await db.insert(reviewCycles).values({id:'cycle',initiativeId:'i',riskAssessmentId:'risk',kind:'initial',openedAt:now});
  await db.insert(reviewDecisions).values({id:'review',cycleId:'cycle',domain:'privacy-hipaa',status:'drafted',draftMd:'Review draft',createdAt:now});
  for (const id of ['H-01','H-02']) await db.insert(controlDefinitions).values({id,domain:'privacy-hipaa',name:id,applicability:'all',owner:'Privacy',requiredEvidence:'Retention policy',cadence:'Annual',enforcementMode:'gate'});
});
afterEach(async()=>{await closeTestDb(db);});
const upload = (requestId='upload-request-00001', supersedesId?:string) => uploadEvidence(db,'i',owner,{requestId,fileName:'retention.pdf',mediaType:'application/pdf',contentBase64:bytes.toString('base64'),supersedesId});
async function packet(documentId:string, includeAll=true) {
  const state = await getEvidence(db,'i',owner);
  return saveEvidenceDraft(db,'i',owner,{cycleId:'cycle',expectedRevision:state.draft?.revision ?? 0,entries:(includeAll?['H-01','H-02']:['H-01']).map(controlId=>({controlId,documentId,pageReference:'1',note:'Retention policy evidence'}))});
}
/** Simulate the review/evidence state observed by the client before a normal signature. */
async function signLoadedEvidenceReview() {
  const [review] = await db.select().from(reviewDecisions).where(eq(reviewDecisions.id, 'review'));
  const evidence = await getEvidence(db, 'i', reviewer);
  return signReview(db, 'cycle', 'privacy-hipaa', reviewer.actor, 'workspace-a', {
    expectedRevision: review.revision,
    expectedEvidencePacketId: evidence.latest?.id ?? null,
  });
}
describe('versioned evidence workflow',()=>{
  it('uploads, submits, returns, revises, accepts and preserves both histories',async()=>{
    const first=await upload();
    expect((await upload()).id).toBe(first.id);
    const draft=await packet(first.id);
    const submitted=await submitEvidence(db,'i',owner,{packetId:draft.id,expectedRevision:draft.revision});
    expect((await getEvidence(db,'i',owner)).requirements[0].status).toBe('submitted');
    await assessEvidence(db,'i',reviewer,{packetId:submitted.id,controlId:'H-01',decision:'changes_requested',reason:'Add the retention duration.'});
    await expect(signLoadedEvidenceReview()).rejects.toThrow(/evidence/i);
    const second=await upload('upload-request-00002',first.id);
    expect(second.version).toBe(2);
    const revised=await packet(second.id);
    const resubmitted=await submitEvidence(db,'i',owner,{packetId:revised.id,expectedRevision:revised.revision});
    for(const controlId of ['H-01','H-02']) await assessEvidence(db,'i',reviewer,{packetId:resubmitted.id,controlId,decision:'accepted',reason:'Duration and scope are documented.'});
    const state=await getEvidence(db,'i',owner);
    expect(state.documents).toHaveLength(2);
    expect(state.history).toHaveLength(2);
    expect(state.requirements.every(r=>r.status==='accepted')).toBe(true);
    await signLoadedEvidenceReview();
    expect((await downloadEvidence(db,'i',first.id,owner)).bytes).toEqual(bytes);
    expect((await db.select().from(auditEvents)).some(e=>e.action==='evidence_assessed')).toBe(true);
    await expect(db.update(evidenceDocuments).set({fileName:'overwritten.pdf'}).where(eq(evidenceDocuments.id,first.id))).rejects.toMatchObject({cause:{message:expect.stringMatching(/immutable/i)}});
    await expect(db.update(evidencePackets).set({entries:[]}).where(eq(evidencePackets.id,submitted.id))).rejects.toMatchObject({cause:{message:expect.stringMatching(/immutable/i)}});
  });
  it('denies foreign workspaces, other requesters, admin acceptance, and shared seed writes',async()=>{
    const file=await upload();
    await expect(getEvidence(db,'i',{...owner,workspaceId:'foreign'})).rejects.toMatchObject({status:404});
    await expect(downloadEvidence(db,'i',file.id,{...owner,workspaceId:'foreign'})).rejects.toMatchObject({status:404});
    await expect(uploadEvidence(db,'i',{actor:{id:'dan-kowalski',role:'requester'},workspaceId:'workspace-a'},{requestId:'other-requester-00001',fileName:'x.pdf',mediaType:'application/pdf',contentBase64:bytes.toString('base64')})).rejects.toMatchObject({status:403});
    const draft=await packet(file.id); const submitted=await submitEvidence(db,'i',owner,{packetId:draft.id,expectedRevision:draft.revision});
    await expect(assessEvidence(db,'i',{actor:{id:'ray-chen',role:'admin'},workspaceId:'workspace-a'},{packetId:submitted.id,controlId:'H-01',decision:'accepted',reason:'Looks good'})).rejects.toMatchObject({status:403});
    await db.update(initiatives).set({workspaceId:null}).where(eq(initiatives.id,'i'));
    await expect(upload()).rejects.toMatchObject({status:404});
  });
  it('rejects stale drafts, missing required evidence, and changes after domain signature',async()=>{
    const file=await upload(); const draft=await packet(file.id,false);
    await expect(saveEvidenceDraft(db,'i',owner,{cycleId:'cycle',expectedRevision:0,entries:[]})).rejects.toMatchObject({status:409});
    const submitted=await submitEvidence(db,'i',owner,{packetId:draft.id,expectedRevision:draft.revision});
    await assessEvidence(db,'i',reviewer,{packetId:submitted.id,controlId:'H-01',decision:'accepted',reason:'Accepted.'});
    await expect(signLoadedEvidenceReview()).rejects.toThrow(/evidence/i);
    const revised=await packet(file.id); const second=await submitEvidence(db,'i',owner,{packetId:revised.id,expectedRevision:revised.revision});
    expect((await getEvidence(db,'i',owner)).requirements.find(r=>r.id==='H-01')?.assessment?.inherited).toBe(true);
    await assessEvidence(db,'i',reviewer,{packetId:second.id,controlId:'H-02',decision:'accepted',reason:'Accepted.'});
    await signLoadedEvidenceReview();
    await expect(saveEvidenceDraft(db,'i',owner,{cycleId:'cycle',expectedRevision:0,entries:[]})).rejects.toMatchObject({status:409});
  });
});

it('accepts a 2 MiB document without exhausting the encoding validator',async()=>{
 const large=Buffer.alloc(2*1024*1024,32);large.write('%PDF-1.4\n');large.write('%%EOF',large.length-5);
 const result=await uploadEvidence(db,'i',owner,{requestId:'maximum-upload-00001',fileName:'large.pdf',mediaType:'application/pdf',contentBase64:large.toString('base64')});
 expect(result.byteSize).toBe(large.length);
});
it('does not allow a foreign-domain reviewer or stale packet to assess evidence',async()=>{
 const file=await upload();const draft=await packet(file.id);const first=await submitEvidence(db,'i',owner,{packetId:draft.id,expectedRevision:draft.revision});
 await expect(assessEvidence(db,'i',{actor:{id:'james-liu',role:'reviewer'},workspaceId:'workspace-a'},{packetId:first.id,controlId:'H-01',decision:'accepted',reason:'Not my domain'})).rejects.toMatchObject({status:403});
 const next=await packet(file.id);await submitEvidence(db,'i',owner,{packetId:next.id,expectedRevision:next.revision});
 await expect(assessEvidence(db,'i',reviewer,{packetId:first.id,controlId:'H-01',decision:'accepted',reason:'Stale'})).rejects.toMatchObject({status:409});
});

it('blocks evidence assessment while abstained and restores it after explicit resume',async()=>{
 const file=await upload();const draft=await packet(file.id);const submitted=await submitEvidence(db,'i',owner,{packetId:draft.id,expectedRevision:draft.revision});
 await abstainReview(db,'cycle','privacy-hipaa',reviewer.actor,'workspace-a','Conflict of interest',0);
 expect((await getEvidence(db,'i',reviewer)).reviewerDomain).toBeNull();
 for(const decision of ['accepted','changes_requested'] as const) await expect(assessEvidence(db,'i',reviewer,{packetId:submitted.id,controlId:'H-01',decision,reason:'Attempt'})).rejects.toMatchObject({status:409,message:expect.stringMatching(/resume/i)});
 expect((await db.select().from(auditEvents)).filter(e=>e.action==='evidence_assessed')).toHaveLength(0);
 expect((await getEvidence(db,'i',reviewer)).requirements[0].assessment).toBeNull();
 await resumeReview(db,'cycle','privacy-hipaa',reviewer.actor,'workspace-a',1);
 expect((await getEvidence(db,'i',reviewer)).reviewerDomain).toBe('privacy-hipaa');
 await assessEvidence(db,'i',reviewer,{packetId:submitted.id,controlId:'H-01',decision:'accepted',reason:'Independent review completed'});
 expect((await getEvidence(db,'i',reviewer)).requirements[0].status).toBe('accepted');
});
