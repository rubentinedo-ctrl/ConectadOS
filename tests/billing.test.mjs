import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {Store} from '../lib/server/store.mjs';import {assistantContext} from '../lib/server/assistant.mjs';import {billingReport,saveBillingEntry,archiveBillingEntry,billingAmount,billingDate} from '../lib/server/billing.mjs';import {saveProject,removeProject,organizationReport} from '../lib/server/organization.mjs';import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';import {saveConfig} from '../scripts/config.mjs';
const now=Date.parse('2026-10-11T15:23:00Z');
const entry=(extra={})=>({id:randomUUID(),revision:'',label:'Fixture VPS',provider:'Hostinger',currency:'USD',amount:'120',periodMonths:12,kind:'contract',source:'Fixture annual contract',observedDate:'2026-10-11',renewalDate:'2027-10-08',renewalMode:'automatic',projectId:null,...extra});
async function fixture(f){const root=await mkdtemp(path.join(tmpdir(),'conectados-billing-')),db=new Store(root);try{await f(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
const report=db=>billingReport(db,{now});const save=(db,e)=>saveBillingEntry(db,e,{now});
test('billing keeps original periods and currencies; documented and estimated projections remain separate and do not count one-off costs',()=>fixture(db=>{
 assert.equal(report(db).totals.length,0);assert.equal(report(db).activeCount,0);
 for(const e of [entry(),entry({amount:'0.30',periodMonths:1,kind:'invoice'}),entry({amount:'0.60',periodMonths:3,kind:'estimate'}),entry({amount:'36',periodMonths:36}),entry({amount:'25',currency:'EUR',periodMonths:1}),entry({amount:'999',periodMonths:0,renewalDate:'',renewalMode:'unknown'})])save(db,e);
 const r=report(db);assert.equal(r.activeCount,6);const usd=r.totals.find(t=>t.currency==='USD');assert.equal(usd.documentedMonthly,'11.3');assert.equal(usd.estimatedMonthly,'0.2');assert.equal(usd.recurringCount,4);assert.equal(r.totals.find(t=>t.currency==='EUR').documentedMonthly,'25');assert.equal(r.items.find(i=>i.amount==='120').periodMonths,12);assert.equal(r.coverage,'manual-register');assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,1);
}));
test('decimal arithmetic, valid dates and bounded fields reject malformed data without partially changing rows',()=>fixture(db=>{
 assert.equal(billingAmount('0.100000').amount,'0.1');assert.equal(billingAmount('999999999.999999').micros,999999999999999n);assert.equal(billingDate('2028-02-29'),Date.parse('2028-02-29T00:00:00Z'));
 for(const value of ['-1','1e3','NaN','01','1,20','1000000000','0.1234567',null,5])assert.throws(()=>billingAmount(value),{status:400});
 for(const value of ['2027-02-29','2026-04-31','2026-1-01','1999-12-31','2200-01-01'])assert.throws(()=>billingDate(value),{status:400});
 for(const extra of [{amount:'-1'},{currency:'ZZZ'},{provider:'shell'},{kind:'verified-api'},{periodMonths:2},{renewalMode:'paid'},{observedDate:'2026-10-12'},{source:''},{label:'bad\nlabel'},{source:'x'.repeat(241)},{periodMonths:0,renewalDate:'2027-01-01'},{projectId:randomUUID()}])assert.throws(()=>save(db,entry(extra)));
 for(const input of [undefined,null,[],5])assert.throws(()=>save(db,input),{status:400});assert.equal(report(db).items.length,0);
}));
test('creation retries are idempotent; optimistic revisions protect edits, archival and recovery',()=>fixture(db=>{
 const e=entry();save(db,e);save(db,e);assert.equal(report(db).items.length,1);const old=report(db).items[0];assert.throws(()=>save(db,{...e,amount:'240'}),{status:409});save(db,{...e,revision:old.revision,amount:'240'});const changed=report(db).items[0];assert.throws(()=>archiveBillingEntry(db,{id:e.id,revision:old.revision,archived:true}),{status:409});
 archiveBillingEntry(db,{id:e.id,revision:changed.revision,archived:true},{now});assert.equal(report(db).activeCount,0);assert.equal(report(db).totals.length,0);const archived=report(db).items[0];assert.throws(()=>save(db,{...e,revision:archived.revision}),{status:409});archiveBillingEntry(db,{id:e.id,revision:archived.revision,archived:false},{now});assert.equal(report(db).totals[0].documentedMonthly,'20');assert.equal(report(db).items[0].createdAt,old.createdAt);
}));
test('renewal dates and staleness are explicit in UTC, never advanced automatically or inferred from provider uptime',()=>fixture(db=>{
 for(const renewalDate of ['2026-10-10','2026-10-11','2026-11-10','2026-11-11',''])save(db,entry({renewalDate,observedDate:'2026-07-01'}));const r=report(db);assert.equal(r.pastDueCount,1);assert.equal(r.upcomingCount,2);assert.equal(r.unknownRenewalCount,1);assert.ok(r.items.every(i=>i.stale));assert.equal(r.totals[0].staleCount,5);const future=billingReport(db,{now:now+400*86400000});assert.equal(future.pastDueCount,4);assert.equal(future.items.find(i=>i.renewalDate==='2026-10-10').renewalDate,'2026-10-10');
}));
test('deleted projects retain their financial association and cannot silently become shared expenses',()=>fixture(db=>{
 const projectId=saveProject(db,{name:'Fixture billing project'}),e=entry({projectId});save(db,e);const p=organizationReport(db).projects[0];removeProject(db,p.id,p.revision);let r=report(db);assert.equal(r.items[0].projectId,projectId);assert.equal(r.items[0].projectMissing,true);assert.equal(r.items[0].projectName,null);save(db,{...e,revision:r.items[0].revision,amount:'144'});assert.throws(()=>save(db,entry({projectId})),{status:404});r=report(db);save(db,{...e,revision:r.items[0].revision,projectId:null});assert.equal(report(db).items[0].projectId,null);
}));
test('billing survives private backup and restoration without reviving sessions or external effects',()=>fixture(async(db,root)=>{
 await saveConfig(root,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:4200});save(db,entry({label:'PRIVATE_FIXTURE_COST'}));db.session();const before=report(db),copy=path.join(root,'copy'),target=path.join(root,'restored');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));const restored=new Store(target);try{assert.deepEqual(report(restored),before);assert.equal(restored.db.prepare('SELECT count(*) n FROM sessions').get().n,0)}finally{restored.close()}
}));
test('total entry limit includes archived data and rejection preserves the last successful record',()=>fixture(db=>{
 const e=entry();save(db,e);const row=db.db.prepare('SELECT * FROM billing_entries').get(),insert=db.db.prepare('INSERT INTO billing_entries VALUES(?,?,?,1,?,?)');db.db.exec('BEGIN');for(let i=0;i<499;i++)insert.run(randomUUID(),row.value,randomUUID(),now,now);db.db.exec('COMMIT');assert.throws(()=>save(db,entry()),{status:409});assert.equal(report(db).items.length,500);assert.equal(report(db).activeCount,1);assert.equal(report(db).totals[0].documentedMonthly,'10');
}));

test('assistant costs require a separate scope; summary omits individual sources, labels and project names',()=>fixture(db=>{
 save(db,entry({label:'PRIVATE_COST_LABEL',source:'PRIVATE_INVOICE_REFERENCE'}));db.saveCredential('Cloudflare','Fixture credential','BILLING_FIXTURE_SECRET');const all=assistantContext(db,{scope:'all',now});assert.equal(all.sources.some(s=>s.kind==='billing'||s.kind==='renewals'),false);const costs=assistantContext(db,{scope:'billing',now});assert.equal(costs.sources.length,2);assert.equal(costs.sources[0].documentedMonthly,'10');assert.equal(costs.sources[0].currency,'USD');for(const value of ['PRIVATE_COST_LABEL','PRIVATE_INVOICE_REFERENCE','BILLING_FIXTURE_SECRET'])assert.equal(JSON.stringify(costs).includes(value),false);assert.ok(costs.sources.every(s=>['billing','renewals'].includes(s.kind)));assert.match(costs.limits,/No mezclar monedas/);
}));

test('renewals without a known amount remain visible without inventing zero cost or a currency',()=>fixture(db=>{
 save(db,entry({amount:'',currency:'',renewalDate:'2026-10-30'}));const r=report(db);assert.equal(r.unknownAmountCount,1);assert.equal(r.upcomingCount,1);assert.equal(r.items[0].amount,null);assert.equal(r.items[0].currency,null);assert.deepEqual(r.totals,[]);const context=assistantContext(db,{scope:'billing',now});assert.equal(context.sources.length,1);assert.equal(context.sources[0].unknownAmountCount,1);assert.equal(context.sources.some(s=>s.kind==='billing'),false);
}));
