import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {configureNotificationPolicy,notificationCategories,notificationProviders} from '../lib/server/notification-policy.mjs';
import {Store} from '../lib/server/store.mjs';
import {sendResend,emailAddress} from '../lib/server/resend.mjs';
import {reconcileIncidents,incidentReport,acknowledgeIncident} from '../lib/server/incidents.mjs';
import {notificationReport,configureNotifications,activateNotifications,muteNotifications,enqueueNotifications,enqueueTestNotification,deliverNotifications} from '../lib/server/notifications.mjs';
import {saveConfig} from '../scripts/config.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';
const token='re_TEST_ONLY_NO_REAL_PROVIDER_ACCESS',body=JSON.stringify({from:'alerts@example.com',to:['owner@example.com'],subject:'Fixture only',text:'No real mail.'});
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-notifications-'));const db=new Store(root);try{await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
const configure=(db,extra={})=>configureNotifications(db,{sender:'alerts@example.com',recipient:'owner@example.com',includeDetails:false,dailyLimit:10,revision:notificationReport(db).revision,...extra});
const activate=db=>{const p=notificationReport(db).policy;if(!p.configured)configureNotificationPolicy(db,{categories:Object.keys(notificationCategories),providers:notificationProviders,minimumMinutes:0,intervalMinutes:0,repeatHours:1,maxPerDay:100},{revision:p.revision});activateNotifications(db,true,{revision:notificationReport(db).revision,now:Date.now()-10})};
const enqueueTest=db=>enqueueTestNotification(db,randomUUID(),{revision:notificationReport(db).revision});
const accepted=async()=>({accepted:true,providerId:randomUUID()});
async function prepared(db){configure(db);db.saveCredential('Resend','Fixture key',token);const id=enqueueTest(db);await deliverNotifications(db,{send:accepted,onlyId:id});db.configureCollector(true);db.collectorHeartbeat();activate(db)}
function reading(db,status='exited:unhealthy',name='PRIVATE RESOURCE NAME'){if(!db.coolifyConnection())db.configureCoolify('https://panel.example','TEST_ONLY_COOLIFY_TOKEN');db.saveCoolifySnapshot('https://panel.example',{source:'https://panel.example',checkedAt:Date.now(),expiresAt:Date.now()+300000,coverage:'Fixture',resources:[{id:'app',name,type:'application',status}]});reconcileIncidents(db)}

test('Resend transport only uses fixed HTTPS destination, bounded text, no redirects, scoped headers and sanitized responses',async()=>{
 const key='conectados/'+randomUUID(),id=randomUUID();let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(options.headers['Idempotency-Key'],key);assert.equal(options.body,body);return Response.json({id})};
 assert.deepEqual(await sendResend(token,body,key,{fetcher}),{accepted:true,providerId:id});assert.equal(calls,1);
 for(const address of ['a@example.com\nBcc: another@example.com','a..b@example.com','a@localhost','a@example..com','a@-bad.example','name <a@example.com>'])assert.throws(()=>emailAddress(address));
 assert.equal(emailAddress('Owner@EXAMPLE.COM'),'Owner@example.com');
 await assert.rejects(sendResend(token,JSON.stringify({...JSON.parse(body),to:['a@example.com','b@example.com']}),key,{fetcher}));await assert.rejects(sendResend(token+'\n',body,key,{fetcher}));await assert.rejects(sendResend(token,body,key+'\n',{fetcher}));await assert.rejects(sendResend(token,JSON.stringify({...JSON.parse(body),attachments:['not allowed']}),key,{fetcher}));assert.equal(calls,1);
 const denied=await sendResend(token,body,key,{fetcher:async()=>new Response(token,{status:403})});assert.equal(denied.retryable,false);assert.equal(JSON.stringify(denied).includes(token),false);
 const rate=await sendResend(token,body,key,{fetcher:async()=>new Response(token,{status:429,headers:{'retry-after':'3600'}})});assert.equal(rate.retryAfterMs,3600000);
 const crash=await sendResend(token,body,key,{fetcher:async()=>{throw Error(token)}});assert.equal(crash.ambiguous,true);assert.equal(JSON.stringify(crash).includes(token),false);
 const oversize=await sendResend(token,body,key,{fetcher:async()=>new Response('x'.repeat(17000),{status:200,headers:{'content-type':'application/json'}})});assert.equal(oversize.accepted,false);
 const conflict=await sendResend(token,body,key,{fetcher:async()=>Response.json({name:'invalid_idempotent_request',message:token},{status:409})});assert.equal(conflict.retryable,false);assert.equal(JSON.stringify(conflict).includes(token),false);
 assert.equal((await sendResend(token,body,key,{fetcher:async()=>Response.json({name:'concurrent_idempotent_requests'},{status:409})})).retryable,true);
 assert.equal((await sendResend(token,body,key,{fetcher:async()=>Response.json({id:token})})).accepted,false);
});

test('mail configuration stays disabled until its own test is accepted and rejects stale recipient revisions',async()=>sandbox(async db=>{
 assert.equal(notificationReport(db).enabled,false);assert.deepEqual(await deliverNotifications(db,{send:async()=>{throw Error('must not send')}}),{idle:true});configure(db);assert.throws(()=>activate(db),{status:409});assert.throws(()=>enqueueTest(db),{status:409});
 db.saveCredential('Resend','Test only',token);const oldRevision=notificationReport(db).revision,id=enqueueTestNotification(db,randomUUID(),{revision:oldRevision});await deliverNotifications(db,{send:accepted,onlyId:id});assert.equal(notificationReport(db).ready,true);assert.equal(notificationReport(db).enabled,false);activate(db);assert.equal(notificationReport(db).enabled,true);
 configure(db,{recipient:'other@example.com'});assert.equal(notificationReport(db).ready,false);assert.equal(notificationReport(db).enabled,false);assert.throws(()=>activateNotifications(db,true,{revision:oldRevision}),{status:409});assert.throws(()=>enqueueTestNotification(db,randomUUID(),{revision:oldRevision}),{status:409});assert.throws(()=>configureNotifications(db,{sender:'a@example.com',recipient:'b@example.com',includeDetails:false,dailyLimit:1,revision:oldRevision}),{status:409});
 const testId=enqueueTest(db);await deliverNotifications(db,{send:accepted,onlyId:testId});db.saveCredential('Resend','Rotated fixture','re_DIFFERENT_TEST_ONLY_ACCESS');assert.equal(notificationReport(db).ready,false);assert.throws(()=>activate(db),{status:409});assert.equal(JSON.stringify(notificationReport(db)).includes(token),false);
}));

test('warnings deduplicate by episode and revision, exclude prior inventory and keep infrastructure details out by default',async()=>sandbox(async db=>{
 configure(db);db.saveCredential('Resend','Test',token);db.configureCollector(true);db.collectorHeartbeat();reading(db);const before=incidentReport(db).items[0];db.db.prepare('UPDATE incident_events SET created=created-10000').run();const id=enqueueTest(db);await deliverNotifications(db,{send:accepted,onlyId:id});activate(db);assert.equal(enqueueNotifications(db).added,0);
 reading(db,'degraded:unhealthy');assert.equal(enqueueNotifications(db).added,1);assert.equal(enqueueNotifications(db).added,0);const warning=db.db.prepare("SELECT * FROM notification_outbox WHERE kind='warning'").get();assert.equal(warning.payload.includes('PRIVATE RESOURCE NAME'),false);assert.equal(warning.payload.includes('https://panel.example'),false);assert.equal(warning.payload.includes(token),false);
 await deliverNotifications(db,{send:async(_key,payload,idempotency)=>{assert.equal(payload,warning.payload);assert.equal(idempotency,'conectados/'+warning.id);return accepted()}});assert.equal(enqueueNotifications(db).added,0);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE kind='warning'").get().n,1);
 const incident=incidentReport(db).items.find(i=>i.id===before.id);assert.equal(incident.state,'open');
}));

test('recognition, fresh recovery, pause, recipient or provider access change cancel unsent warnings',async()=>sandbox(async db=>{
 await prepared(db);reading(db);enqueueNotifications(db);let i=incidentReport(db).items.find(i=>i.payload.findingId==='Coolify:app');acknowledgeIncident(db,i.id,{revision:i.revision});let sends=0;await deliverNotifications(db,{send:async()=>{sends++;return accepted()}});assert.equal(sends,0);assert.equal(notificationReport(db).counts.cancelled,1);
 reading(db,'degraded:unhealthy');enqueueNotifications(db);reading(db,'running:healthy');await deliverNotifications(db,{send:async()=>{sends++;return accepted()}});assert.equal(sends,0);
 reading(db);enqueueNotifications(db);db.configureCoolify('https://panel.example','DIFFERENT_COOLIFY_TEST_ACCESS');reconcileIncidents(db);await deliverNotifications(db,{send:async()=>{sends++;return accepted()}});assert.equal(sends,0);
 reading(db);enqueueNotifications(db);muteNotifications(db,60);await deliverNotifications(db,{send:async()=>{sends++;return accepted()}});assert.equal(sends,0);assert.equal(enqueueNotifications(db).added,0);
 muteNotifications(db,0);reading(db,'degraded:unhealthy');enqueueNotifications(db);db.configureCollector(false);await deliverNotifications(db,{send:async()=>{sends++;return accepted()}});assert.equal(sends,0);
}));

test('delivery retries preserve immutable requests, share leases and stop before the provider deduplication window expires',async()=>sandbox(async(db,root)=>{
 configure(db);db.saveCredential('Resend','Test',token);const id=enqueueTest(db),other=new Store(root);let release;const wait=new Promise(r=>release=r),seen=[];
 const pending=deliverNotifications(db,{onlyId:id,send:async(_key,payload,key)=>{seen.push([payload,key]);await wait;return {accepted:false,retryable:true,ambiguous:true,error:token}}});
 try{assert.deepEqual(await deliverNotifications(other,{send:accepted}),{busy:true});release();await pending;assert.equal(notificationReport(db).deliveries[0].state,'queued');assert.equal(JSON.stringify(notificationReport(db)).includes(token),false);
 db.db.prepare('UPDATE notification_outbox SET next_attempt=0 WHERE id=?').run(id);await deliverNotifications(other,{send:async(_key,payload,key)=>{seen.push([payload,key]);return accepted()}});assert.deepEqual(seen[0],seen[1]);assert.equal(notificationReport(db).deliveries[0].state,'accepted');
 const older=enqueueTest(db);db.db.prepare("UPDATE notification_outbox SET created=?,expires=?,attempts=1,state='sending',lease_until=0 WHERE id=?").run(Date.now()-21*3600000,Date.now()-3600000,older);let calls=0;await deliverNotifications(db,{send:async()=>{calls++;return accepted()}});assert.equal(calls,0);assert.equal(notificationReport(db).deliveries.find(i=>i.id===older).state,'uncertain');
 }finally{release();other.close()}
}));

test('daily cap counts new requests, test retries are idempotent and in-flight configuration changes remain accurately recorded',async()=>sandbox(async db=>{
 configure(db,{dailyLimit:1});db.saveCredential('Resend','Test',token);const requestId=randomUUID(),revision=notificationReport(db).revision,id=enqueueTestNotification(db,requestId,{revision});assert.equal(enqueueTestNotification(db,requestId,{revision}),id);await deliverNotifications(db,{send:accepted});assert.equal(notificationReport(db).remainingToday,0);enqueueTest(db);let calls=0;await deliverNotifications(db,{send:async()=>{calls++;return accepted()}});assert.equal(calls,0);
 configure(db,{dailyLimit:10});const latest=enqueueTest(db);await deliverNotifications(db,{onlyId:latest,send:async()=>{configure(db,{recipient:'changed@example.com'});return accepted()}});const report=notificationReport(db);assert.equal(report.deliveries.find(i=>i.id===latest).state,'accepted');assert.equal(report.ready,false);assert.equal(report.testAcceptedAt,null);
}));

test('accepted mail and dedup markers survive independent restore; pending requests retain identity but cannot send',async()=>sandbox(async(db,root)=>{
 await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:4200,mode:'demo'});await prepared(db);reading(db);enqueueNotifications(db);const copy=path.join(root,'snapshot'),target=path.join(root,'restored');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));const restored=new Store(target);try{const sourceRows=db.db.prepare('SELECT id,payload,credential_identity FROM notification_outbox').all();assert.deepEqual(restored.db.prepare('SELECT id,payload,credential_identity FROM notification_outbox').all(),sourceRows);assert.equal(restored.db.prepare('SELECT COUNT(*) n FROM notification_seen').get().n,2);assert.equal(restored.collectorStatus().heartbeat,null);let calls=0;await deliverNotifications(restored,{send:async()=>{calls++;return accepted()}});assert.equal(calls,0);assert.equal(restored.collectorStatus().enabled,false);assert.equal(notificationReport(restored).enabled,false);assert.equal(notificationReport(restored).counts.accepted,1);assert.equal(restored.db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE state='cancelled'").get().n,1);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE state='queued'").get().n,1);assert.equal(enqueueNotifications(restored).added,0)}finally{restored.close()}
}));

test('ambiguous sends stop after four identical attempts and a later pause cannot claim that nothing was accepted',async()=>sandbox(async db=>{
 configure(db);db.saveCredential('Resend','Test',token);const id=enqueueTest(db),requests=[];
 for(let attempt=0;attempt<4;attempt++){db.db.prepare('UPDATE notification_outbox SET next_attempt=0 WHERE id=?').run(id);await deliverNotifications(db,{send:async(_token,payload,key)=>{requests.push([payload,key]);return {accepted:false,retryable:true,ambiguous:true,error:'No se pudo confirmar la respuesta de Resend.'}}})}
 assert.equal(notificationReport(db).deliveries.find(i=>i.id===id).state,'uncertain');assert.equal(requests.length,4);assert.ok(requests.every(r=>JSON.stringify(r)===JSON.stringify(requests[0])));assert.deepEqual(await deliverNotifications(db,{send:async()=>{throw Error('must not resend')}}),{idle:true});
 await prepared(db);reading(db);enqueueNotifications(db);await deliverNotifications(db,{send:async()=>({accepted:false,retryable:true,ambiguous:true,error:'No se pudo confirmar la respuesta de Resend.'})});muteNotifications(db,60);assert.equal(notificationReport(db).deliveries.find(i=>i.kind==='warning').state,'uncertain');
}));

test('bounded mail queue keeps a partial batch and persistent dedup prevents repeating an old active warning after history cleanup',async()=>sandbox(async db=>{
 await prepared(db);reading(db);db.saveCoolifySnapshot('https://panel.example',{source:'https://panel.example',checkedAt:Date.now(),expiresAt:Date.now()+300000,coverage:'Queue limit fixture',resources:Array.from({length:600},(_,i)=>({id:'resource-'+i,name:'Fixture '+i,type:'application',status:'exited:unhealthy'}))});reconcileIncidents(db);
 assert.equal(enqueueNotifications(db).added,500);assert.equal(enqueueNotifications(db).added,0);assert.equal(notificationReport(db).counts.queued,500);
 const first=db.db.prepare("SELECT * FROM notification_outbox WHERE kind='warning' LIMIT 1").get();await deliverNotifications(db,{onlyId:first.id,send:accepted});db.db.prepare('UPDATE notification_outbox SET created=? WHERE id=?').run(Date.now()-31*24*3600000,first.id);enqueueNotifications(db);assert.equal(db.db.prepare('SELECT id FROM notification_outbox WHERE id=?').get(first.id),undefined);assert.ok(db.db.prepare('SELECT dedup_key FROM notification_seen WHERE dedup_key=?').get(first.dedup_key));assert.equal(notificationReport(db).counts.queued,500);
}));

test('rotating or revoking the mail key disables the channel atomically and a new test never resumes old warnings',async()=>sandbox(async db=>{
 await prepared(db);reading(db);enqueueNotifications(db);const warning=db.db.prepare("SELECT * FROM notification_outbox WHERE kind='warning'").get(),testId=enqueueTest(db),revision=notificationReport(db).revision;
 db.db.prepare('UPDATE incident_events SET created=created-10000').run();
 db.saveCredential('Resend','Rotated fixture','re_NEW_FIXTURE_ACCESS_ONLY');
 let report=notificationReport(db);assert.equal(report.enabled,false);assert.equal(report.ready,false);assert.equal(report.testAcceptedAt,null);assert.notEqual(report.revision,revision);
 assert.equal(report.deliveries.find(r=>r.id===warning.id).state,'cancelled');assert.equal(report.deliveries.find(r=>r.id===testId).state,'cancelled');assert.equal(enqueueNotifications(db).added,0);
 await deliverNotifications(db,{onlyId:enqueueTest(db),send:accepted});assert.equal(notificationReport(db).ready,true);assert.equal(notificationReport(db).enabled,false);activate(db);assert.equal(enqueueNotifications(db).added,0);
 reading(db,'degraded:unhealthy');assert.equal(enqueueNotifications(db).added,1);await deliverNotifications(db,{send:async()=>({accepted:false,retryable:true,ambiguous:true})});db.deleteCredential('Resend');report=notificationReport(db);
 assert.equal(report.enabled,false);assert.equal(report.ready,false);assert.equal(report.hasToken,false);assert.equal(report.deliveries.find(r=>r.state==='uncertain').attempts,1);
}));

test('a key or recipient changed after claiming a request cannot send its old payload or consume a new-request quota',async()=>sandbox(async db=>{
 for(const change of ['key','recipient']){
  configure(db);db.saveCredential('Resend','Fixture',token);const id=enqueueTest(db),original=db.credential.bind(db);let reads=0,sends=0;
  db.credential=provider=>{reads++;if(change==='key')db.saveCredential('Resend','New fixture','re_CHANGED_DURING_CLAIM');else db.db.prepare('UPDATE notification_config SET recipient=?,generation=?,enabled=0,test_identity=NULL,test_accepted=NULL WHERE id=1').run('changed@example.com',randomUUID());return original(provider)};
  try{assert.deepEqual(await deliverNotifications(db,{onlyId:id,send:async()=>{sends++;return accepted()}}),{cancelled:true})}finally{db.credential=original}
  assert.equal(reads,1);assert.equal(sends,0);const row=db.db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(id);assert.equal(row.state,'cancelled');assert.equal(row.attempts,0);assert.equal(row.first_attempt,null);assert.equal(notificationReport(db).remainingToday,3);
 }
}));

test('mail access and channel reset roll back together on a database failure',async()=>sandbox(async db=>{
 await prepared(db);const identity=db.credentialIdentity('Resend'),revision=notificationReport(db).revision;
 db.db.exec("CREATE TRIGGER fixture_mail_reset_failure BEFORE UPDATE ON notification_config BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 assert.throws(()=>db.saveCredential('Resend','Must roll back','re_MUST_NOT_PERSIST_TEST_KEY'));assert.equal(db.credentialIdentity('Resend'),identity);assert.equal(notificationReport(db).revision,revision);assert.equal(notificationReport(db).enabled,true);
 assert.throws(()=>db.deleteCredential('Resend'));assert.equal(db.credentialIdentity('Resend'),identity);assert.equal(notificationReport(db).enabled,true);
 db.db.exec('DROP TRIGGER fixture_mail_reset_failure');
}));
