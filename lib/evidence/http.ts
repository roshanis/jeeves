import { EvidenceError } from './files';
export const MAX_UPLOAD_BODY = 2_900_000;
export const privateHeaders = { 'Cache-Control':'private, no-store', 'Vary':'Authorization, Cookie', 'X-Content-Type-Options':'nosniff' };
export async function readEvidenceJson(req:Request):Promise<unknown> {
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new EvidenceError(415,'Send evidence as application/json.');
  if(Number(req.headers.get('content-length'))>MAX_UPLOAD_BODY)throw new EvidenceError(413,'Upload request exceeds the size limit.');
  const reader=req.body?.getReader();if(!reader)throw new EvidenceError(400,'Missing request body.');
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_UPLOAD_BODY){await reader.cancel();throw new EvidenceError(413,'Upload request exceeds the size limit.');}chunks.push(value);} }
  finally {reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EvidenceError(400,'Invalid JSON body.');}
}
export function evidenceResponseError(error:unknown):Response {
  if(error instanceof EvidenceError)return Response.json({error:error.message},{status:error.status,headers:privateHeaders});
  // Do not expose database content, parameters or private file data in errors.
  return Response.json({error:'Evidence is temporarily unavailable. Please try again.'},{status:503,headers:privateHeaders});
}
