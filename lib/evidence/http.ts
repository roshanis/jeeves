import { EvidenceError } from './files';
import { BodyReadError, hasNul, readBodyText } from '../http/read-json-body';
import { logUnexpectedError } from '../http/log-error';
export const MAX_UPLOAD_BODY = 2_900_000;
export const privateHeaders = { 'Cache-Control':'private, no-store', 'Vary':'Authorization, Cookie', 'X-Content-Type-Options':'nosniff' };
export async function readEvidenceJson(req:Request):Promise<unknown> {
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json') throw new EvidenceError(415,'Send evidence as application/json.');
  if(!req.body)throw new EvidenceError(400,'Missing request body.');
  let text:string;
  try{text=await readBodyText(req,MAX_UPLOAD_BODY);}catch(e){if(e instanceof BodyReadError)throw new EvidenceError(e.status,e.status===413?'Upload request exceeds the size limit.':'Upload request could not be read.');throw e;}
  let parsed:unknown;
  try{parsed=JSON.parse(text);}catch{throw new EvidenceError(400,'Invalid JSON body.');}
  if(hasNul(parsed))throw new EvidenceError(400,'Invalid JSON body.');
  return parsed;
}
export function evidenceResponseError(error:unknown):Response {
  if(error instanceof EvidenceError)return Response.json({error:error.message},{status:error.status,headers:privateHeaders});
  // Do not expose database content, parameters or private file data in errors.
  return Response.json({error:'Evidence is temporarily unavailable. Please try again.',requestId:logUnexpectedError('Evidence request failed',error)},{status:503,headers:privateHeaders});
}
