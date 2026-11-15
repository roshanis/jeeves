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
 it('does not claim seeded metadata is an uploaded document',async()=>{mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});mocks.request.mockRejectedValue(new Error('Evidence workspace not found.'));render(<EvidenceTab slug="demo"/>);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Accepted')).toBeNull();});
});

const evidenceState={initiativeId:'i',cycleId:'c',canEdit:true,reviewerDomain:null,documents:[],requirements:[],draft:null,latest:null,history:[],usedBytes:0};
it('keeps the same upload request ID after an uncertain response',async()=>{
 mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});mocks.base64.mockResolvedValue('cGRm');
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
 mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});
 mocks.request.mockResolvedValue({...evidenceState,draft:{id:'draft',revision:1,entries:[{controlId:'H-01',documentId:'new',pageReference:'',note:''}]},requirements:[{id:'H-01',name:'Retention',domain:'privacy-hipaa',description:'Policy',policySource:null,status:'accepted',entry:{controlId:'H-01',documentId:'old',pageReference:'',note:''},assessment:null,signed:false}]});
 render(<EvidenceTab slug="demo"/>);expect(await screen.findByText(/Draft changes are not submitted/)).toBeTruthy();
});

it.each(['submit response', 'refresh'])('retries the same packet after a lost %s without saving a duplicate draft',async(failure)=>{
 mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});
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

it('does not rebind a signed domain to a new document version on upload',async()=>{
 mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});mocks.base64.mockResolvedValue('cGRm');
 const docA={id:'A',fileName:'a.pdf',version:1,supersedesId:null,byteSize:1024,createdAt:'2026-01-01T00:00:00Z',sha256:'x'};
 const entries=[{controlId:'H-01',documentId:'A',pageReference:'',note:''},{controlId:'S-01',documentId:'A',pageReference:'',note:''}];
 const req=(id:string,domain:string,signed:boolean)=>({id,name:id,domain,description:'d',policySource:null,status:'accepted',entry:{controlId:id,documentId:'A',pageReference:'',note:''},assessment:null,signed});
 const initial={...evidenceState,documents:[docA],draft:{id:'draft',revision:1,entries},requirements:[req('H-01','privacy-hipaa',true),req('S-01','security',false)]};
 mocks.request.mockImplementation((_s,_t,body)=>{
  if(body?.action==='upload')return Promise.resolve({...docA,id:'B',version:2,supersedesId:'A'});
  if(body?.action==='save_draft')return Promise.resolve({id:'draft',revision:2,entries:body.entries});
  return Promise.resolve(initial);
 });
 render(<EvidenceTab slug="demo"/>);
 fireEvent.change(await screen.findByLabelText('Choose document'),{target:{files:[new File(['pdf'],'a2.pdf',{type:'application/pdf'})]}});
 fireEvent.change(screen.getByLabelText('Document version'),{target:{value:'A'}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'Upload document'}));
 await screen.findByText(/Document saved privately/);
 fireEvent.click(screen.getByRole('button',{name:'Save evidence draft'}));
 await waitFor(()=>expect(mocks.request.mock.calls.some(c=>c[2]?.action==='save_draft')).toBe(true));
 const saved=mocks.request.mock.calls.find(c=>c[2]?.action==='save_draft')![2].entries;
 expect(saved.find((e:{controlId:string})=>e.controlId==='H-01').documentId).toBe('A');
 expect(saved.find((e:{controlId:string})=>e.controlId==='S-01').documentId).toBe('B');
});

describe('evidence tab copy, file input and errors',()=>{
 it('says notes, page references and file names are included in AI review drafts',()=>{
  mocks.session.mockReturnValue(null);render(<EvidenceTab slug="demo"/>);
  expect(screen.queryByText(/send them to AI/i)).toBeNull();
  expect(screen.getByText(/page references and file names/i)).toBeTruthy();
 });
 it('replaces the file input after an upload and clears the selection after an oversize pick',async()=>{
  mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});mocks.base64.mockResolvedValue('cGRm');
  mocks.request.mockImplementation((_s,_t,body)=>body?.action==='upload'?Promise.resolve({id:'B',fileName:'a.pdf',version:1,supersedesId:null,byteSize:3,createdAt:'2026-01-01T00:00:00Z',sha256:'x'}):Promise.resolve(evidenceState));
  render(<EvidenceTab slug="demo"/>);
  const first=await screen.findByLabelText('Choose document');
  fireEvent.change(first,{target:{files:[new File(['pdf'],'a.pdf',{type:'application/pdf'})]}});
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Upload document'}));
  await screen.findByText(/Document saved privately/);
  expect(screen.getByLabelText('Choose document')).not.toBe(first);
  const second=screen.getByLabelText('Choose document');
  fireEvent.change(second,{target:{files:[new File(['pdf'],'b.pdf',{type:'application/pdf'})]}});
  expect(screen.getByText(/Selected: b.pdf/)).toBeTruthy();
  fireEvent.change(second,{target:{files:[new File([new Uint8Array(2*1024*1024+1)],'big.pdf',{type:'application/pdf'})]}});
  expect(screen.queryByText(/Selected:/)).toBeNull();
  expect(screen.getByLabelText('Choose document')).not.toBe(second);
 });
 it('signs the visitor out when the evidence API answers 401',async()=>{
  const logout=vi.fn();mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn(),logout});
  const {ApiError}=await import('@/lib/client/api');
  mocks.request.mockRejectedValue(new ApiError(401,'expired'));
  render(<EvidenceTab slug="demo"/>);
  await waitFor(()=>expect(logout).toHaveBeenCalled());
 });
 it('lifts the pending-submission lock when a submit is rejected with a 4xx',async()=>{
  mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});
  const {ApiError}=await import('@/lib/client/api');
  const entry={controlId:'H-01',documentId:'doc',pageReference:'',note:'n'};
  const draft={id:'packet',revision:1,entries:[entry]};
  const initial={...evidenceState,draft,requirements:[{id:'H-01',name:'Retention',domain:'privacy-hipaa',description:'Policy',policySource:null,status:'missing',entry:null,assessment:null,signed:false}]};
  mocks.request.mockImplementation((_s,_t,body)=>body?.action==='submit'?Promise.reject(new ApiError(409,'Evidence changed.')):Promise.resolve(initial));
  render(<EvidenceTab slug="demo"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Submit evidence for review'}));
  await screen.findByText('Evidence changed.');
  expect(screen.queryByText(/Submission confirmation pending/)).toBeNull();
 });
 it('keeps the page reference and note when the document choice is cleared and chosen again',async()=>{
  mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});
  const doc={id:'A',fileName:'a.pdf',version:1,supersedesId:null,byteSize:1024,createdAt:'2026-01-01T00:00:00Z',sha256:'x'};
  mocks.request.mockResolvedValue({...evidenceState,documents:[doc],draft:{id:'d',revision:1,entries:[{controlId:'H-01',documentId:'A',pageReference:'',note:'My explanation'}]},requirements:[{id:'H-01',name:'Retention',domain:'privacy-hipaa',description:'Policy',policySource:null,status:'missing',entry:null,assessment:null,signed:false}]});
  render(<EvidenceTab slug="demo"/>);
  const select=await screen.findByLabelText('Document for H-01');
  fireEvent.change(select,{target:{value:''}});
  expect(screen.queryByLabelText('What this demonstrates for H-01')).toBeNull();
  expect((screen.getByRole('button',{name:'Submit evidence for review'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Document for H-01'),{target:{value:'A'}});
  expect((screen.getByLabelText('What this demonstrates for H-01') as HTMLTextAreaElement).value).toBe('My explanation');
 });
});

it('shows the server message for a 404 on upload instead of the shared-sample text',async()=>{
 mocks.session.mockReturnValue({session:{token:'token'},startDemo:vi.fn()});mocks.base64.mockResolvedValue('cGRm');
 const {ApiError}=await import('@/lib/client/api');
 mocks.request.mockImplementation((_slug,_token,body)=>body?Promise.reject(new ApiError(404,'Previous document not found.')):Promise.resolve(evidenceState));
 render(<EvidenceTab slug="demo"/>);
 fireEvent.change(await screen.findByLabelText('Choose document'),{target:{files:[new File(['pdf'],'demo.pdf',{type:'application/pdf'})]}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'Upload document'}));
 expect(await screen.findByText('Previous document not found.')).toBeTruthy();
 expect(screen.queryByText(/Evidence uploads are available/)).toBeNull();
});
