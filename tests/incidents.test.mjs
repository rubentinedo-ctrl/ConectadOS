import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {saveBillingEntry,archiveBillingEntry,billingReport} from '../lib/server/billing.mjs';
import {Store} from '../lib/server/store.mjs';
import {reconcileIncidents,incidentReport,acknowledgeIncident,configureIncidentTracking} from '../lib/server/incidents.mjs';
import {saveConfig} from '../scripts/config.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-incidents-'));const db=new Store(root);try{await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
function reading(db,status='exited:unhealthy',now=Date.now(),extra={}){db.saveCoolifySnapshot('https://panel.example',{source:'https://panel.example',checkedAt:now,expiresAt:now+300000,coverage:'Isolated incident fixture',resources:[{id:'fixture-app',name:'Fixture app',type:'application',status}],...extra})}
function prepare(db){db.configureCoolify('https://panel.example','TEST-ONLY-INCIDENT-TOKEN');db.configureCollector(true);db.collectorHeartbeat();reading(db)}
const recognize=(db,id)=>acknowledgeIncident(db,id,{revision:incidentReport(db).items.find(i=>i.id===id)?.revision});
const appIncident=db=>incidentReport(db).items.find(i=>i.payload.findingId==='Coolify:fixture-app');
test('Zero-deployment classification archives a warning as reclassified, never repaired; a later failed deployment opens a new incident',async()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const original=appIncident(db);
 function history(count){const now=Date.now();reading(db,'exited:unhealthy',now,{applicationDeployments:[{applicationId:'fixture-app',count,source:'https://panel.example/api/v1/deployments/applications/fixture-app?skip=0&take=1',checkedAt:now,expiresAt:now+300000,error:null}]})}
 history(0);reconcileIncidents(db);const classified=incidentReport(db).items.find(i=>i.id===original.id);assert.equal(classified.state,'reclassified');assert.equal(incidentReport(db).counts.open,0);assert.equal(incidentReport(db).counts.resolved,0);assert.equal(incidentReport(db).counts.reclassified,1);assert.equal(classified.events[0].event,'reclassified');assert.match(classified.closeReason,/No se ejecutó una reparación/);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM audit WHERE event='incident_resolved'").get().n,0);
 history(1);reconcileIncidents(db);const active=incidentReport(db).items.find(i=>i.state==='open'&&i.payload.resourceId==='fixture-app');assert.ok(active);assert.notEqual(active.id,original.id);assert.equal(incidentReport(db).items.find(i=>i.id===original.id).state,'reclassified');
}));
function probeResult(db,id,kind='response',certificateExpiresAt=Date.now()+90*86400000){const p=db.webProbes().find(p=>p.id===id),now=Date.now();db.saveWebProbeResult(id,p.revision,{source:p.url,method:'HEAD',checkedAt:now,expiresAt:now+300000,kind,httpStatus:kind==='unreachable'?null:kind==='http-error'?503:200,durationMs:12,certificateExpiresAt})}

test('incidents deduplicate readings, preserve acknowledgment, reopen changed warnings and retain separate episodes',async()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const first=appIncident(db);assert.equal(first.state,'open');assert.equal(first.events.length,1);
 const other=new Store(db.root);try{reconcileIncidents(other);assert.equal(appIncident(other).id,first.id);recognize(other,first.id);recognize(db,first.id);assert.equal(appIncident(db).events.length,2)}finally{other.close()}
 reading(db);reconcileIncidents(db);assert.equal(appIncident(db).state,'acknowledged');assert.equal(appIncident(db).events.length,2);
 reading(db,'degraded:unhealthy');reconcileIncidents(db);assert.throws(()=>acknowledgeIncident(db,first.id,{revision:first.revision}),{status:409});assert.equal(appIncident(db).state,'open');assert.equal(appIncident(db).acknowledgedAt,null);assert.equal(appIncident(db).events[0].event,'changed');
 reading(db,'running:healthy');reconcileIncidents(db);assert.equal(appIncident(db).state,'resolved');assert.match(appIncident(db).closeReason,/No acredita/);assert.throws(()=>recognize(db,first.id),{status:409});
 reading(db);reconcileIncidents(db);const all=incidentReport(db).items.filter(i=>i.payload.findingId==='Coolify:fixture-app');assert.equal(all.length,2);assert.notEqual(all[0].id,all[1].id);assert.equal(all[0].state,'open');
}));
test('stale evidence, permission failure and old component detail cannot close a warning',async()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const id=appIncident(db).id;
 reading(db,'running:healthy',Date.now()-400000);reconcileIncidents(db);assert.equal(appIncident(db).state,'open');
 reading(db,'running:healthy');db.failCoolify('https://panel.example','Permission failure fixture');reconcileIncidents(db);assert.equal(appIncident(db).state,'open');
 reading(db,'running:healthy');reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===id).state,'resolved');
 const detail={serviceId:'fixture-app',components:[{id:'db',type:'database',name:'DB fixture',status:'exited:unhealthy',excludedFromStatus:false}],checkedAt:Date.now(),expiresAt:Date.now()+900000,error:null};
 reading(db,'running:healthy',Date.now(),{serviceDetails:[detail]});reconcileIncidents(db);const component=incidentReport(db).items.find(i=>i.payload.findingId==='components-attention:fixture-app');assert.equal(component.state,'open');
 reading(db,'running:healthy',Date.now(),{serviceDetails:[{...detail,components:[],error:'Fixture failure'}]});reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===component.id).state,'open');
 reading(db,'running:healthy',Date.now(),{serviceDetails:[{...detail,components:[],checkedAt:Date.now()}]});reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===component.id).state,'resolved');
}));
test('pause and inventory removal end monitoring without claiming recovery, and resumed warnings open new episodes',async()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const first=appIncident(db);configureIncidentTracking(db,false);reconcileIncidents(db);assert.equal(appIncident(db).state,'monitoring-ended');assert.equal(incidentReport(db).tracking,false);
 configureIncidentTracking(db,true);reconcileIncidents(db);const resumed=appIncident(db);assert.notEqual(resumed.id,first.id);assert.equal(resumed.state,'open');
 reading(db,'running:healthy',Date.now(),{resources:[]});reconcileIncidents(db);const removed=incidentReport(db).items.find(i=>i.id===resumed.id);assert.equal(removed.state,'monitoring-ended');assert.match(removed.closeReason,/ya no figura/);
 reading(db);reconcileIncidents(db);db.configureCollector(false);reconcileIncidents(db);assert.equal(incidentReport(db).counts.open,0);assert.equal(incidentReport(db).observing,false);
}));
test('connection token and scope changes hide previous incidents and reject acknowledgment from another connection',async()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const old=appIncident(db);db.configureCoolify('https://panel.example','DIFFERENT-TEST-TOKEN');reconcileIncidents(db);assert.equal(incidentReport(db).items.some(i=>i.id===old.id),false);assert.throws(()=>recognize(db,old.id),{status:404});
 db.configureProvider('Vercel','personal','TEST-ONLY-VERCEL-TOKEN');const snap={source:'https://api.vercel.com',checkedAt:Date.now(),expiresAt:Date.now()+300000,resources:[{id:'deployment',name:'Deployment fixture',status:'deployment:ERROR',type:'application'}]};db.saveProviderSnapshot('Vercel','personal',snap,db.credentialIdentity('Vercel'));reconcileIncidents(db);const vercel=incidentReport(db).items.find(i=>i.payload.provider==='Vercel');
 db.configureProvider('Vercel','team_fixture');reconcileIncidents(db);assert.equal(incidentReport(db).items.some(i=>i.id===vercel.id),false);assert.throws(()=>recognize(db,vercel.id),{status:404});
 const serialized=JSON.stringify(incidentReport(db));assert.equal(serialized.includes('DIFFERENT-TEST-TOKEN'),false);assert.equal(serialized.includes('incident_key'),false);assert.equal(serialized.includes('signature'),false);
}));
test('web warnings require fresh response and certificate evidence and do not resolve when paused or removed',async()=>sandbox(async db=>{
 db.configureCollector(true);db.collectorHeartbeat();const id=db.configureWebProbe({label:'Fixture site',url:'https://web.example',enabled:true});probeResult(db,id,'response',Date.now()+86400000);reconcileIncidents(db);const cert=incidentReport(db).items.find(i=>i.payload.findingId.endsWith(':certificate'));
 probeResult(db,id,'unreachable',null);reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===cert.id).state,'open');
 probeResult(db,id,'response',null);reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===cert.id).state,'open');
 probeResult(db,id);reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===cert.id).state,'resolved');
 probeResult(db,id,'http-error');reconcileIncidents(db);const fault=incidentReport(db).items.find(i=>i.payload.findingId.endsWith(':response')&&i.state==='open');db.configureWebProbe({id,label:'Fixture site',url:'https://web.example',enabled:false});reconcileIncidents(db);assert.equal(incidentReport(db).items.find(i=>i.id===fault.id).state,'monitoring-ended');
 db.removeWebProbe(id);reconcileIncidents(db);assert.equal(incidentReport(db).items.some(i=>i.payload.probeId===id),false);assert.throws(()=>recognize(db,fault.id),{status:404});
}));
test('incident history, acknowledgments and tracking survive independent restoration without copied sessions or pulse',async()=>sandbox(async(db,root)=>{
 await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:4200,mode:'demo'});prepare(db);reconcileIncidents(db);recognize(db,appIncident(db).id);const before=incidentReport(db).items.filter(i=>i.payload.provider==='Coolify');
 const copy=path.join(root,'snapshot'),target=path.join(root,'restored');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));const restored=new Store(target);try{assert.deepEqual(incidentReport(restored).items.filter(i=>i.payload.provider==='Coolify'),before);assert.equal(incidentReport(restored).tracking,true);assert.equal(restored.collectorStatus().heartbeat,null);assert.equal(restored.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0)}finally{restored.close()}
 configureIncidentTracking(db,false);reconcileIncidents(db);await snapshot(root,path.join(root,'silenced-copy'));await restoreToNewDirectory(path.join(root,'silenced-copy'),path.join(root,'silenced-restored'),path.join(root,'.keys/vault.key'));const silenced=new Store(path.join(root,'silenced-restored'));try{assert.equal(incidentReport(silenced).tracking,false)}finally{silenced.close()}
}));
test('history age and counts are bounded while current warnings and each separate view remain accessible',async()=>sandbox(async db=>{
 prepare(db);reading(db,'exited:unhealthy',Date.now(),{resources:Array.from({length:206},(_,i)=>({id:i?'fixture-'+i:'fixture-app',name:'Fixture '+i,type:'application',status:'exited:unhealthy'}))});reconcileIncidents(db);const active=db.db.prepare("SELECT * FROM incidents WHERE payload LIKE '%Coolify:fixture-app%' AND state='open'").get(),now=Date.now();
 const insert=db.db.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?,?,?,NULL,?,?)');db.db.exec('BEGIN');for(let i=0;i<5010;i++)insert.run(randomUUID(),'closed-'+i,active.scope,'resolved',active.signature,active.payload,now,now,now,'Fixture closed');insert.run(randomUUID(),'expired',active.scope,'resolved',active.signature,active.payload,now,now,now-31*86400000,'Fixture expired');db.db.exec('COMMIT');
 reconcileIncidents(db);const report=incidentReport(db);assert.equal(report.counts.resolved,5000);assert.equal(report.counts.open,206);assert.equal(report.items.filter(i=>i.state==='open').length,200);assert.equal(report.items.filter(i=>i.state==='resolved').length,200);assert.equal(report.total,5206);
 for(let i=0;i<105;i++){reading(db,i%2?'exited:unhealthy':'degraded:unhealthy');reconcileIncidents(db)}assert.equal(db.db.prepare('SELECT COUNT(*) n FROM incident_events WHERE incident_id=?').get(active.id).n,100);
}));

test('renewals deduplicate each threshold, keep stale evidence open and archive without claiming payment',()=>sandbox(async db=>{db.configureCollector(true);db.collectorHeartbeat();const id=randomUUID(),now=Date.parse('2026-10-13T12:00:00Z');saveBillingEntry(db,{id,label:'Fixture renewal',provider:'Hostinger',currency:'USD',amount:'10',periodMonths:1,kind:'contract',source:'Fixture contract',observedDate:'2026-10-13',renewalDate:'2026-11-01',renewalMode:'automatic'},{now});reconcileIncidents(db,{now});const find=at=>incidentReport(db,{now:at}).items.find(i=>i.payload.findingId==='renewal:'+id);assert.equal(find(now).state,'open');reconcileIncidents(db,{now:now+86400000});assert.equal(find(now).events.length,1);reconcileIncidents(db,{now:now+13*86400000});assert.equal(find(now).events[0].event,'changed');reconcileIncidents(db,{now:now+100*86400000});assert.equal(find(now).state,'open');const row=billingReport(db,{now}).items[0];archiveBillingEntry(db,{id,revision:row.revision,archived:true},{now});reconcileIncidents(db,{now});const old=db.db.prepare('SELECT state,close_reason FROM incidents WHERE id=?').get(find(now)?.id??db.db.prepare('SELECT id FROM incidents WHERE payload LIKE ?').get('%renewal:%').id);assert.equal(old.state,'monitoring-ended');assert.match(old.close_reason,/No acredita/)}));

import {clearIncidentInbox,restoreIncidentToInbox} from '../lib/server/incidents.mjs';
test('clear inbox retains unresolved signals, is reversible, rejects a changed list and new changes return to pending',()=>sandbox(async db=>{
 prepare(db);reconcileIncidents(db);const original=appIncident(db),before=incidentReport(db);const cleared=clearIncidentInbox(db,{revision:before.inboxRevision});assert.equal(cleared,before.counts.open);assert.equal(incidentReport(db).counts.open,0);assert.equal(appIncident(db).state,'acknowledged');assert.equal(appIncident(db).closedAt,null);assert.ok(appIncident(db).events.some(e=>e.event==='inbox-cleared'));
 reading(db);reconcileIncidents(db);assert.equal(appIncident(db).state,'acknowledged');restoreIncidentToInbox(db,original.id,{revision:original.revision});assert.equal(appIncident(db).state,'open');
 const old=incidentReport(db).inboxRevision;reading(db,'degraded:unhealthy');reconcileIncidents(db);assert.throws(()=>clearIncidentInbox(db,{revision:old}),{status:409});assert.equal(appIncident(db).state,'open');assert.throws(()=>restoreIncidentToInbox(db,original.id,{revision:original.revision}),{status:409});
 clearIncidentInbox(db,{revision:incidentReport(db).inboxRevision});reading(db,'exited:unhealthy');reconcileIncidents(db);assert.equal(appIncident(db).state,'open');
 clearIncidentInbox(db,{revision:incidentReport(db).inboxRevision});reading(db,'running:healthy');reconcileIncidents(db);assert.equal(appIncident(db).state,'resolved');reading(db);reconcileIncidents(db);assert.notEqual(appIncident(db).id,original.id);assert.equal(appIncident(db).state,'open');
}));
test('clear includes all pending rows beyond the display limit and never crosses connection identities',()=>sandbox(async db=>{
 prepare(db);reading(db,'exited:unhealthy',Date.now(),{resources:Array.from({length:206},(_,i)=>({id:'bulk-'+i,name:'Fixture '+i,type:'application',status:'exited:unhealthy'}))});reconcileIncidents(db);const r=incidentReport(db);assert.equal(r.counts.open,206);assert.equal(clearIncidentInbox(db,{revision:r.inboxRevision}),206);assert.equal(incidentReport(db).counts.acknowledged,206);assert.equal(incidentReport(db).items.filter(i=>i.state==='acknowledged').length,200);
 const old=incidentReport(db).items[0];db.configureCoolify('https://panel.example','ROTATED_FIXTURE_KEY');assert.throws(()=>restoreIncidentToInbox(db,old.id,{revision:old.revision}),{status:404});assert.throws(()=>clearIncidentInbox(db,{revision:r.inboxRevision}),{status:409});
}));
