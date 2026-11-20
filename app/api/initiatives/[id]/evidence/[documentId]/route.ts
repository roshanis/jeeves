import { getDb } from '@/lib/db/client';
import { requireViewerForRequest } from '@/lib/services/require-viewer';
import { downloadEvidence } from '@/lib/services/evidence-service';
import { evidenceResponseError, privateHeaders } from '@/lib/evidence/http';
import { isRouteId } from '@/lib/http/route-id';
import { EvidenceError } from '@/lib/evidence/files';
import { databaseNotReady } from "@/lib/http/database-gate";
export const runtime='nodejs';
export async function GET(req:Request,context:{params:Promise<{id:string;documentId:string}>}):Promise<Response> {
  const unavailable = databaseNotReady();
  if (unavailable) return unavailable;
 try{
  const gate=await requireViewerForRequest(req);
  if(!gate.ok)return gate.response;
  const viewer=gate.viewer;
  if(!viewer.actor)throw new EvidenceError(401,'Start the demo to download evidence.');
  const {id,documentId}=await context.params;
  if(!isRouteId(id)||!isRouteId(documentId))throw new EvidenceError(404,'Evidence not found.');
  const {document,bytes}=await downloadEvidence(getDb(),id,documentId,{actor:viewer.actor,workspaceId:viewer.workspaceId});
  return new Response(new Uint8Array(bytes),{headers:{...privateHeaders,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="evidence.${document.mediaType==='application/pdf'?'pdf':'docx'}"; filename*=UTF-8''${encodeURIComponent(document.fileName).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`,'Content-Length':String(bytes.length),'Content-Security-Policy':"sandbox; default-src 'none'"}});
 }catch(error){return evidenceResponseError(error);}
}
