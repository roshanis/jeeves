// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile } from 'node:fs/promises';
import * as schema from '../db/schema';
import { signReview } from '../services/initiative-service';
import { getEvidence } from '../services/evidence-service';
import { evidenceResponseError } from './http';
it('preserves legacy signature before migration and fails closed for evidence access',async()=>{
 const client=new PGlite();const db=drizzle({client,schema});
 try{
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
  for(const entry of journal.entries.filter((e:{idx:number})=>e.idx<11)) await client.exec(await readFile(`drizzle/${entry.tag}.sql`,'utf8'));
  const now=new Date();
  await db.insert(schema.initiatives).values({id:'i',slug:'legacy',title:'Legacy',requester:'Priya Raman',workspaceId:'w',state:'in_review',createdAt:now,updatedAt:now});
  await db.insert(schema.intakeVersions).values({id:'iv',initiativeId:'i',version:1,fields:{},missing:[],createdAt:now});
  await db.insert(schema.riskAssessments).values({id:'risk',initiativeId:'i',intakeVersionId:'iv',version:1,tier:'high',flags:{},requiredDomains:['privacy-hipaa'],createdAt:now});
  await db.insert(schema.reviewCycles).values({id:'cycle',initiativeId:'i',riskAssessmentId:'risk',kind:'initial',openedAt:now});
  await db.insert(schema.reviewDecisions).values({id:'rd',cycleId:'cycle',domain:'privacy-hipaa',status:'drafted',draftMd:'Legacy review',createdAt:now});
  const actor={id:'marcus-webb',role:'reviewer' as const};
  expect((await signReview(db,'cycle','privacy-hipaa',actor,'w')).status).toBe('signed');
  const resolve=vi.fn();
  await getEvidence(db,'i',{actor,workspaceId:'w'}).then(resolve,error=>expect(evidenceResponseError(error).status).toBe(503));
  expect(resolve).not.toHaveBeenCalled();
 }finally{await client.close();}
});
