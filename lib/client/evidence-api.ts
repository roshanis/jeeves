import type { EvidenceState } from '../evidence/types';
import { ApiError } from './api';
export async function evidenceRequest<T=EvidenceState>(slug:string,token:string,body?:unknown,signal?:AbortSignal):Promise<T> {
 const response=await fetch(`/api/initiatives/${encodeURIComponent(slug)}/evidence`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal});
 const data=await response.json();
 if(!response.ok)throw new ApiError(response.status,data.error??'Evidence request failed.');
 return data as T;
}
export async function downloadEvidenceFile(slug:string,token:string,documentId:string,fileName:string) {
 const response=await fetch(`/api/initiatives/${encodeURIComponent(slug)}/evidence/${encodeURIComponent(documentId)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
 if(!response.ok){const data=await response.json();throw new ApiError(response.status,data.error??'Download failed.');}
 const url=URL.createObjectURL(await response.blob());
 const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function fileBase64(file:File):Promise<string> {
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Could not read this file.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(file);});
}
