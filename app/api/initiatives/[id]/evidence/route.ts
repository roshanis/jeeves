import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { runMutationGuard, resolveSession, extractSessionToken } from '@/lib/services/route-guard';
import { getEvidence, uploadEvidence, saveEvidenceDraft, submitEvidence, assessEvidence } from '@/lib/services/evidence-service';
import { evidenceResponseError, privateHeaders, readEvidenceJson } from '@/lib/evidence/http';
import { EvidenceError } from '@/lib/evidence/files';
export const runtime='nodejs';
const id=z.string().min(1).max(150);
const entry=z.object({controlId:id,documentId:id,pageReference:z.string().max(120),note:z.string().max(2000)}).strict();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('upload'),requestId:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),fileName:z.string().min(1).max(180),mediaType:z.string().max(150),contentBase64:z.string().max(2796204),supersedesId:id.optional()}).strict(),
 z.object({action:z.literal('save_draft'),cycleId:id,expectedRevision:z.number().int().min(0),entries:z.array(entry).max(30)}).strict(),
 z.object({action:z.literal('submit'),packetId:id,expectedRevision:z.number().int().min(1)}).strict(),
 z.object({action:z.literal('assess'),packetId:id,controlId:id,decision:z.enum(['accepted','changes_requested']),reason:z.string().trim().min(1).max(2000)}).strict(),
]);
type Context={params:Promise<{id:string}>};
export async function GET(req:Request,context:Context):Promise<Response> {
 try {
  const viewer=await resolveSession(extractSessionToken(req));
  if(!viewer.actor)throw new EvidenceError(401,'Enter the demo passcode to view private evidence.');
  return Response.json(await getEvidence(getDb(),(await context.params).id,{actor:viewer.actor,workspaceId:viewer.workspaceId}),{headers:privateHeaders});
 }catch(error){return evidenceResponseError(error);}
}
export async function POST(req:Request,context:Context):Promise<Response> {
 try {
  const guard=await runMutationGuard(req,undefined,{requiresBudget:true,estimatedTokens:0});
  if(!guard.ok)return Response.json({error:guard.failure.message},{status:guard.failure.status,headers:privateHeaders});
  // JSON + same-origin checks also prevent cross-site cookie-authenticated form uploads.
  const origin=req.headers.get('origin');
  if(origin&&origin!==new URL(req.url).origin)throw new EvidenceError(403,'Cross-origin evidence mutations are not permitted.');
  const parsed=schema.safeParse(await readEvidenceJson(req));
  if(!parsed.success)throw new EvidenceError(400,'Invalid evidence request. Check the fields and file size.');
  const input=parsed.data,ref=(await context.params).id,db=getDb();
  let result:unknown;
  switch(input.action) {
   case 'upload':result=await uploadEvidence(db,ref,guard,input);break;
   case 'save_draft':result=await saveEvidenceDraft(db,ref,guard,input);break;
   case 'submit':result=await submitEvidence(db,ref,guard,input);break;
   case 'assess':await assessEvidence(db,ref,guard,input);result={recorded:true};break;
  }
  return Response.json(result,{headers:privateHeaders});
 }catch(error){return evidenceResponseError(error);}
}
