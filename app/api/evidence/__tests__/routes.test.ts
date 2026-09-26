// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({guard:vi.fn(),session:vi.fn(),state:vi.fn(),upload:vi.fn(),download:vi.fn()}));
vi.mock('@/lib/db/client',()=>({getDb:()=>({})}));
vi.mock('@/lib/services/route-guard',()=>({runMutationGuard:mocks.guard,resolveSession:mocks.session,extractSessionToken:()=>null}));
vi.mock('@/lib/services/evidence-service',()=>({getEvidence:mocks.state,uploadEvidence:mocks.upload,downloadEvidence:mocks.download,saveEvidenceDraft:vi.fn(),submitEvidence:vi.fn(),assessEvidence:vi.fn()}));
import { GET, POST } from '../../initiatives/[id]/evidence/route';
import { GET as download } from '../../initiatives/[id]/evidence/[documentId]/route';
const context={params:Promise.resolve({id:'initiative'})};
beforeEach(()=>{vi.clearAllMocks();mocks.guard.mockResolvedValue({ok:true,actor:{id:'priya-raman',role:'requester'},workspaceId:'w'});mocks.session.mockResolvedValue({actor:null,workspaceId:null});});
describe('private evidence HTTP boundary',()=>{
 it('rejects public list and download requests',async()=>{expect((await GET(new Request('http://localhost/api'),context)).status).toBe(401);expect((await download(new Request('http://localhost/api'),{params:Promise.resolve({id:'i',documentId:'d'})})).status).toBe(401);expect(mocks.download).not.toHaveBeenCalled();});
 it('authenticates before reading an upload body',async()=>{mocks.guard.mockResolvedValue({ok:false,failure:{status:401,message:'Missing session'}});const req=new Request('http://localhost/api',{method:'POST',body:'bad'});expect((await POST(req,context)).status).toBe(401);expect(req.bodyUsed).toBe(false);});
 it('caps actual streamed bytes even with no Content-Length',async()=>{const req=new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(2900001)});expect((await POST(req,context)).status).toBe(413);expect(mocks.upload).not.toHaveBeenCalled();});
 it('refuses form or malformed bodies and ignores client role claims',async()=>{expect((await POST(new Request('http://localhost/api',{method:'POST',body:'x'}),context)).status).toBe(415);expect((await POST(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),context)).status).toBe(400);});
 it('forces attachment download and no caching',async()=>{mocks.session.mockResolvedValue({actor:{id:'priya-raman',role:'requester'},workspaceId:'w'});mocks.download.mockResolvedValue({document:{fileName:'demo.pdf',mediaType:'application/pdf'},bytes:Buffer.from('pdf')});const response=await download(new Request('http://localhost/api'),{params:Promise.resolve({id:'i',documentId:'d'})});expect(response.headers.get('content-disposition')).toContain('attachment');expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');});
});
