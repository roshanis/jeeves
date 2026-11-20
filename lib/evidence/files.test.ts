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
describe('evidence filename characters', () => {
  it('rejects bidi overrides, invisible format characters, C1 controls and line separators', () => {
    for (const name of ['doc\u202Egpj.pdf', 'doc\u200Bx.pdf', 'doc\u2066x.pdf', 'ctl\u0085x.pdf', 'a\u2028b.pdf', 'a\u2029b.pdf'])
      expect(() => validateDocument(name, 'application/pdf', pdf), JSON.stringify(name)).toThrow(/plain filename/);
  });
  it('replaces a lone surrogate so the stored name equals what is echoed', () => {
    expect(validateDocument('lone\ud800.pdf', 'application/pdf', pdf).fileName).toBe('lone\ufffd.pdf');
  });
  it('stores the NFC form of the name', () => {
    expect(validateDocument('cafe\u0301.pdf', 'application/pdf', pdf).fileName).toBe('caf\u00e9.pdf');
  });
});
function docxZip(extra:string[]=[]) {
  const entries=['[Content_Types].xml','word/document.xml',...extra];
  const local:Buffer[]=[],central:Buffer[]=[];let position=0;
  for(const name of entries) {
    const filename=Buffer.from(name),content=Buffer.from('<document/>'),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt32LE(content.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt32LE(content.length,20);directory.writeUInt32LE(content.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(position,42);
    local.push(header,filename,content);central.push(directory,filename);position+=header.length+filename.length+content.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(position,16);
  return Buffer.concat([...local,...central,end]);
}
it('accepts a DOCX directory and rejects an inflated-size bomb declaration',()=>{
 const zip=docxZip();const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 expect(validateDocument('policy.docx',mime,zip).mediaType).toBe(mime);
 const end=zip.length-22,start=zip.readUInt32LE(end+16);zip.writeUInt32LE(30*1024*1024,start+24);
 expect(()=>validateDocument('policy.docx',mime,zip)).toThrow(/supported DOCX/);
});
it('explains why a DOCX with an embedded chart workbook or OLE object is refused',()=>{
 const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 for(const part of ['word/embeddings/Microsoft_Excel_Worksheet1.xlsx','word/embeddings/oleObject1.bin','word/vbaProject.bin'])
  expect(()=>validateDocument('policy.docx',mime,docxZip([part])),part).toThrow(/embedded objects and charts are not accepted.*export the document to PDF/i);
});
it('keeps the generic message for other unsupported DOCX entries',()=>{
 const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 expect(()=>validateDocument('policy.docx',mime,docxZip(['word/../evil.xml']))).toThrow('Unsupported DOCX entry.');
});
