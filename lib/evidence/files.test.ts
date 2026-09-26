// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateDocument, MAX_FILE_BYTES } from './files';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
describe('evidence document boundaries', () => {
  it('identifies a PDF and computes the digest from actual bytes', () => {
    const result = validateDocument('retention.pdf', 'application/pdf', pdf);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.byteSize).toBe(pdf.length);
    expect(result.scanStatus).toBe('not_scanned');
  });
  it('rejects spoofed, oversized, empty and path-like files', () => {
    for (const [name, type, data] of [
      ['policy.pdf', 'application/pdf', Buffer.from('<script>bad</script>')],
      ['../policy.pdf', 'application/pdf', pdf],
      ['policy.pdf', 'text/html', pdf],
      ['policy.pdf', 'application/pdf', Buffer.alloc(MAX_FILE_BYTES + 1)],
      ['policy.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK\x03\x04fake')],
    ] as const) expect(() => validateDocument(name, type, data)).toThrow();
  });
});
function docxZip() {
  const local:Buffer[]=[],central:Buffer[]=[];let position=0;
  for(const name of ['[Content_Types].xml','word/document.xml']) {
    const filename=Buffer.from(name),content=Buffer.from('<document/>'),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt32LE(content.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt32LE(content.length,20);directory.writeUInt32LE(content.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(position,42);
    local.push(header,filename,content);central.push(directory,filename);position+=header.length+filename.length+content.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(position,16);
  return Buffer.concat([...local,...central,end]);
}
it('accepts a DOCX directory and rejects an inflated-size bomb declaration',()=>{
 const zip=docxZip();const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 expect(validateDocument('policy.docx',mime,zip).mediaType).toBe(mime);
 const end=zip.length-22,start=zip.readUInt32LE(end+16);zip.writeUInt32LE(30*1024*1024,start+24);
 expect(()=>validateDocument('policy.docx',mime,zip)).toThrow(/supported DOCX/);
});
