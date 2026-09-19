import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({session:vi.fn(),request:vi.fn(),base64:vi.fn()}));
vi.mock('@/lib/client/session-context',()=>({useLiveSessionOptional:mocks.session}));
vi.mock('@/lib/client/evidence-api',()=>({evidenceRequest:mocks.request,downloadEvidenceFile:vi.fn(),fileBase64:mocks.base64}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
import { EvidenceTab } from '@/components/jeeves/evidence-tab';
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('evidence requester guidance',()=>{
 it('explains private evidence and offers unlock without showing upload controls to public visitors',()=>{mocks.session.mockReturnValue(null);render(<EvidenceTab slug="demo"/>);expect(screen.getByText(/fictional documents only/i)).toBeTruthy();expect(screen.queryByLabelText('Choose document')).toBeNull();});
 it('does not claim seeded metadata is an uploaded document',async()=>{mocks.session.mockReturnValue({session:{token:'token'},openUnlockPrompt:vi.fn()});mocks.request.mockRejectedValue(new Error('Evidence workspace not found.'));render(<EvidenceTab slug="demo"/>);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Accepted')).toBeNull();});
});

const evidenceState={initiativeId:'i',cycleId:'c',canEdit:true,reviewerDomain:null,documents:[],requirements:[],draft:null,latest:null,history:[],usedBytes:0};
it('keeps the same upload request ID after an uncertain response',async()=>{
 mocks.session.mockReturnValue({session:{token:'token'},openUnlockPrompt:vi.fn()});mocks.base64.mockResolvedValue('cGRm');
 mocks.request.mockImplementation((_slug,_token,body)=>body?Promise.reject(new Error('Connection lost')):Promise.resolve(evidenceState));
 render(<EvidenceTab slug="demo"/>);
 fireEvent.change(await screen.findByLabelText('Choose document'),{target:{files:[new File(['pdf'],'demo.pdf',{type:'application/pdf'})]}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'Upload document'}));
 await screen.findByText('Connection lost');
 fireEvent.click(screen.getByRole('button',{name:'Upload document'}));
 await waitFor(()=>expect(mocks.request.mock.calls.filter(call=>call[2]?.action==='upload')).toHaveLength(2));
 const calls=mocks.request.mock.calls.filter(call=>call[2]?.action==='upload');expect(calls[0][2].requestId).toBe(calls[1][2].requestId);
});
it('labels changed draft bindings separately from accepted submitted evidence',async()=>{
 mocks.session.mockReturnValue({session:{token:'token'},openUnlockPrompt:vi.fn()});
 mocks.request.mockResolvedValue({...evidenceState,draft:{id:'draft',revision:1,entries:[{controlId:'H-01',documentId:'new',pageReference:'',note:''}]},requirements:[{id:'H-01',name:'Retention',domain:'privacy-hipaa',description:'Policy',policySource:null,status:'accepted',entry:{controlId:'H-01',documentId:'old',pageReference:'',note:''},assessment:null,signed:false}]});
 render(<EvidenceTab slug="demo"/>);expect(await screen.findByText(/Draft changes are not submitted/)).toBeTruthy();
});

it.each(['submit response', 'refresh'])('retries the same packet after a lost %s without saving a duplicate draft',async(failure)=>{
 mocks.session.mockReturnValue({session:{token:'token'},openUnlockPrompt:vi.fn()});
 const entry={controlId:'H-01',documentId:'doc',pageReference:'',note:'Fictional policy'};
 const draft={id:'packet',revision:1,entries:[entry]};
 const initial={...evidenceState,draft,requirements:[{id:'H-01',name:'Retention',domain:'privacy-hipaa',description:'Policy',policySource:null,status:'missing',entry:null,assessment:null,signed:false}]};
 let submits=0;let reads=0;
 mocks.request.mockImplementation((_slug,_token,body)=>{
  if(body?.action==='save_draft')return Promise.resolve(draft);
  if(body?.action==='submit'){submits++;return failure==='submit response'&&submits===1?Promise.reject(new Error('Connection lost')):Promise.resolve({...draft,status:'submitted'});}
  reads++;
  if(failure==='refresh'&&reads===2)return Promise.reject(new Error('Connection lost'));
  return Promise.resolve(submits?{...initial,draft:null,latest:{...draft,status:'submitted'}}:initial);
 });
 render(<EvidenceTab slug="demo"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Submit evidence for review'}));
 await screen.findByText('Connection lost');
 expect((screen.getByRole('button',{name:'Save evidence draft'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Retry submission'}));
 await screen.findByText('Evidence submitted. Assigned reviewers can now assess it.');
 expect(mocks.request.mock.calls.filter(call=>call[2]?.action==='save_draft')).toHaveLength(1);
 const submitCalls=mocks.request.mock.calls.filter(call=>call[2]?.action==='submit');
 expect(submitCalls).toHaveLength(2);
 expect(submitCalls.map(call=>call[2])).toEqual([{action:'submit',packetId:'packet',expectedRevision:1},{action:'submit',packetId:'packet',expectedRevision:1}]);
});
