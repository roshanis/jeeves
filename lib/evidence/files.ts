import { createHash } from 'node:crypto';
import { MAX_FILE_BYTES } from './types';
export { MAX_FILE_BYTES } from './types';
export class EvidenceError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'EvidenceError'; }
}
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Format validation only. No parser, execution, extraction or malware verdict. */
export function validateDocument(fileName: string, mediaType: string, bytes: Buffer) {
  if (!fileName || fileName.length > 180 || /[\x00-\x1f\x7f/\\]/.test(fileName) || fileName.startsWith('.')) throw new EvidenceError(400, 'Use a plain filename of at most 180 characters.');
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new EvidenceError(413, 'Files must be between 1 byte and 2 MiB.');
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'pdf' && mediaType === 'application/pdf') {
    if (!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0,9).toString('ascii')) || !bytes.subarray(-1024).toString('ascii').includes('%%EOF')) throw new EvidenceError(400, 'The file is not a recognizable PDF.');
  } else if (ext === 'docx' && mediaType === DOCX) {
    // Inspect ZIP directory metadata without inflating or parsing document content.
    let end = -1;
    for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0 || bytes.readUInt16LE(end+4)!==0 || bytes.readUInt16LE(end+6)!==0 || end+22+bytes.readUInt16LE(end+20)!==bytes.length) throw new EvidenceError(400,'The file is not a supported DOCX archive.');
    const count=bytes.readUInt16LE(end+10), size=bytes.readUInt32LE(end+12), start=bytes.readUInt32LE(end+16);
    if(count<2 || count>500 || bytes.readUInt16LE(end+8)!==count || start+size!==end) throw new EvidenceError(400,'Unsupported DOCX directory.');
    let offset=start,total=0; const names=new Set<string>();
    for(let i=0;i<count;i++) {
      if(offset+46>end || bytes.readUInt32LE(offset)!==0x02014b50) throw new EvidenceError(400,'Invalid DOCX directory.');
      const flags=bytes.readUInt16LE(offset+8), method=bytes.readUInt16LE(offset+10), compressed=bytes.readUInt32LE(offset+20), expanded=bytes.readUInt32LE(offset+24), nameLength=bytes.readUInt16LE(offset+28), extra=bytes.readUInt16LE(offset+30), comment=bytes.readUInt16LE(offset+32), local=bytes.readUInt32LE(offset+42);
      const next=offset+46+nameLength+extra+comment;
      if(next>end || local+30>start || bytes.readUInt32LE(local)!==0x04034b50 || (flags&1) || ![0,8].includes(method)) throw new EvidenceError(400,'Encrypted or unsupported DOCX content.');
      const name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
      const localName=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28);
      if(local+30+localName+localExtra+compressed>start || name!==bytes.subarray(local+30,local+30+localName).toString('utf8') || names.has(name) || /(^\/|\.\.|\\|\x00|vbaProject|embeddings\/|\.exe$|\.bin$)/i.test(name)) throw new EvidenceError(400,'Unsupported DOCX entry.');
      names.add(name);total+=expanded;offset=next;
    }
    if(offset!==end || total>20*1024*1024 || !names.has('[Content_Types].xml') || !names.has('word/document.xml')) throw new EvidenceError(400,'The archive is not a supported DOCX document.');
  } else throw new EvidenceError(400,'Upload a PDF or DOCX with its matching file type.');
  return {fileName,mediaType,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),scanStatus:'not_scanned' as const};
}
