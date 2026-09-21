// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import * as schema from '../db/schema';
import { signReview } from '../services/initiative-service';
import { getEvidence } from '../services/evidence-service';
import { evidenceResponseError } from './http';
it('requires integrity migration before signing and preserves legacy no-packet behavior without evidence tables',async()=>{
 const client=new PGlite();const db=drizzle({client,schema});
 try{
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
  for(const entry of journal.entries.filter((e:{idx:number})=>e.idx<11)) await client.exec(await readFile(`drizzle/${entry.tag}.sql`,'utf8'));
  const now=new Date();
  await db.insert(schema.initiatives).values({id:'i',slug:'legacy',title:'Legacy',requester:'Priya Raman',workspaceId:'w',state:'in_review',createdAt:now,updatedAt:now});
  await db.insert(schema.intakeVersions).values({id:'iv',initiativeId:'i',version:1,fields:{},missing:[],createdAt:now});
  await db.insert(schema.riskAssessments).values({id:'risk',initiativeId:'i',intakeVersionId:'iv',version:1,tier:'high',flags:{},requiredDomains:['privacy-hipaa'],createdAt:now});
  await db.insert(schema.reviewCycles).values({id:'cycle',initiativeId:'i',riskAssessmentId:'risk',kind:'initial',openedAt:now});
  // The pre-integrity database does not have the new revision/source columns.
  await client.exec("INSERT INTO review_decisions(id, cycle_id, domain, status, draft_md, created_at) VALUES ('rd', 'cycle', 'privacy-hipaa', 'drafted', 'Legacy review', now())");
  const actor={id:'marcus-webb',role:'reviewer' as const};
  await expect(signReview(db, 'cycle', 'privacy-hipaa', actor, 'w', {
    expectedRevision: 0, expectedEvidencePacketId: null,
  })).rejects.toThrow();
  // Isolate missing evidence tables from the mandatory integrity schema upgrade.
  await client.exec(await readFile('drizzle/0012_review_integrity.sql', 'utf8'));
  const [review] = await db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.id, 'rd'));
  expect((await signReview(db, 'cycle', 'privacy-hipaa', actor, 'w', {
    expectedRevision: review.revision, expectedEvidencePacketId: null,
  })).status).toBe('signed');
  const resolve=vi.fn();
  await getEvidence(db,'i',{actor,workspaceId:'w'}).then(resolve,error=>expect(evidenceResponseError(error).status).toBe(503));
  expect(resolve).not.toHaveBeenCalled();
 }finally{await client.close();}
});
