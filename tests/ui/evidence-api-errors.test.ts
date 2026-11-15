import { afterEach, expect, it, vi } from 'vitest';
import { evidenceRequest } from '@/lib/client/evidence-api';
afterEach(()=>vi.unstubAllGlobals());
it('reports a non-JSON error body as a request failure with the status',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>',{status:502})));
 await expect(evidenceRequest('demo','t')).rejects.toMatchObject({status:502,message:'request failed (502)'});
});
