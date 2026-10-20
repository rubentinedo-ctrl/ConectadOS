import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {Store,AppError} from '../lib/server/store.mjs';
import {normalizeHostSample,readHostSample,hostTelemetryReport,refreshHostTelemetry,recoverHostTelemetry} from '../lib/server/host-telemetry.mjs';
import {inspectCoolifyServer,normalizeCoolifyServer} from '../lib/server/coolify.mjs';
import {prepareServerCopy} from '../lib/server/server-copy.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';import {saveConfig} from '../scripts/config.mjs';
const at=Date.now(),token='HOST-TEST-ONLY-TOKEN',origin='https://panel.example',id='host-a';
const sample=(sampledAt=at)=>({schema:1,agentVersion:'1',agentId:'a'.repeat(64),coolifyOrigin:origin,serverId:id,sampledAt,windowMs:1001,cpuCount:4,cpu:{workPercent:12,stealPercent:2,ioWaitPercent:1,reason:'sampled'},memory:{totalBytes:16*2**30,availableBytes:8*2**30,swapTotalBytes:2**30,swapFreeBytes:2**29},disk:{path:'/',totalBytes:200*2**30,freeBytes:160*2**30,availableBytes:150*2**30},load:[.5,.7,1],uptimeSeconds:86400});
const server=()=>({id,name:'Fixture host',reachable:true,usable:true,sentinelEnabled:true,sentinelMetricsEnabled:false,checkedAt:at,source:origin+'/api/v1/servers/'+id});
const opts=(value=sample(),inspect=async()=>server())=>({enabled:true,read:async()=>value,inspect,now:()=>value.sampledAt});
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-host-'));const db=new Store(root);try{db.configureCoolify(origin,token);db.configureCollector(true);await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
test('host samples reject stale, future, nonfinite, out of range, foreign shape and unknown CPU while allowlisting output',()=>{
 const raw={...sample(),secret:'must-not-retain'};assert.equal('secret' in normalizeHostSample(raw),false);
 for(const change of [{sampledAt:at-180001},{sampledAt:at+30001},{cpuCount:0},{agentId:'machine-id'},{coolifyOrigin:origin+'/path'},{load:[NaN,0,0]},{memory:{...raw.memory,availableBytes:Infinity}},{disk:{...raw.disk,availableBytes:raw.disk.totalBytes+1}},{cpu:{...raw.cpu,workPercent:101}},{cpu:{...raw.cpu,workPercent:null}}])assert.throws(()=>normalizeHostSample({...sample(),...change},{now:at}));
 const unknown=sample();unknown.cpu={workPercent:null,stealPercent:null,ioWaitPercent:null,reason:'counter-reset'};assert.equal(normalizeHostSample(unknown).cpu.workPercent,null);
});
test('fixed host file cannot be redirected and rejects devices, oversized or malformed payloads; descriptors close',async()=>{
 let closed=0;const opener=async(p,flags)=>{assert.equal(p,'/host-telemetry/host.json');assert.ok(flags>0);return {stat:async()=>({isFile:()=>true,size:2}),read:async b=>{b.write('{}');return {bytesRead:2}},close:async()=>closed++}};
 assert.deepEqual(await readHostSample({opener}),{});assert.equal(closed,1);
 for(const stat of [{isFile:()=>false,size:1},{isFile:()=>true,size:32769}])await assert.rejects(readHostSample({opener:async()=>({stat:async()=>stat,close:async()=>closed++})}),/archivo privado/);assert.equal(closed,3);
 await assert.rejects(readHostSample({opener:async()=>{throw Error('PRIVATE PATH OR SECRET')}}),e=>!e.message.includes('SECRET'));
});
test('authorized host readings persist, cache once, preserve dates on failures and hide stale, paused or revoked evidence',async()=>sandbox(async(db,root)=>{
 let calls=0;assert.deepEqual(await refreshHostTelemetry(db,{enabled:false}),{disabled:true});
 await refreshHostTelemetry(db,opts(sample(),async()=>{calls++;return server()}));assert.equal(calls,1);assert.equal(hostTelemetryReport(db,{enabled:true,now:at}).status,'sampled');
 assert.deepEqual(await refreshHostTelemetry(db,opts()),{cached:true});assert.equal(calls,1);
 assert.equal(hostTelemetryReport(db,{enabled:true,now:at+180001}).status,'stale');assert.equal(hostTelemetryReport(db,{enabled:true,now:at-30001}).status,'stale');
 const later=sample(at+60000);await assert.rejects(refreshHostTelemetry(db,opts(later,async()=>{throw new AppError('Sin permiso.',403)})),/permiso/);const failure=hostTelemetryReport(db,{enabled:true,now:at+60000});assert.equal(failure.latest.sampledAt,at);assert.equal(failure.status,'error');
 await refreshHostTelemetry(db,opts(later));assert.equal(hostTelemetryReport(db,{enabled:true,now:at+60000}).history.length,2);
 db.configureCollector(false);assert.equal(hostTelemetryReport(db,{enabled:true}).status,'paused');db.deleteCredential('Coolify');assert.equal(hostTelemetryReport(db,{enabled:true}).status,'unconnected');
 db.configureCoolify(origin,'DIFFERENT-HOST-TEST-TOKEN');assert.equal(hostTelemetryReport(db,{enabled:true}).latest,null);assert.equal((await readFile(path.join(root,'.data/conectados.sqlite'))).includes(Buffer.from(token)),false);
}));
test('host source, pseudonymous identity, duplicate revision and exact authorized server cannot silently change',async()=>sandbox(async db=>{
 await refreshHostTelemetry(db,opts());
 for(const change of [{coolifyOrigin:'https://other.example'},{agentId:'b'.repeat(64)},{serverId:'host-b'},{sampledAt:at-1},{cpu:{...sample().cpu,workPercent:13}}])await assert.rejects(refreshHostTelemetry(db,opts({...sample(),...change})),{status:409});
 await assert.rejects(refreshHostTelemetry(db,opts(sample(at+1),async()=>({...server(),id:'host-b'}))),/corresponde/);
 assert.equal(hostTelemetryReport(db,{enabled:true,now:at}).history.length,1);
}));
test('host lease blocks overlap and rejects access rotation and expiry during reads without saving under new credentials',async()=>sandbox(async(db,root)=>{
 let finish;const gate=new Promise(r=>finish=r),other=new Store(root);const pending=refreshHostTelemetry(db,{...opts(),read:async()=>{await gate;return sample()}});try{assert.deepEqual(await refreshHostTelemetry(other,opts()),{busy:true})}finally{finish();await pending;other.close()}
 await assert.rejects(refreshHostTelemetry(db,{...opts(),read:async()=>{db.configureCoolify(origin,'ROTATED-TEST-TOKEN');return sample()}}),/cambió/);assert.equal(hostTelemetryReport(db,{enabled:true}).latest,null);
 const c=sample(at+1);let tick=c.sampledAt;await assert.rejects(refreshHostTelemetry(db,{...opts(c),now:()=>tick,inspect:async()=>{tick+=30001;return server()}}),/cambió/);assert.equal(hostTelemetryReport(db,{enabled:true}).latest,null);
}));
test('host normalization and server response reject credentials across all providers without raw server fields',async()=>sandbox(async db=>{
 const raw=sample();db.saveCredential('Cloudflare','fixture','c'.repeat(64));raw.agentId='c'.repeat(64);await assert.rejects(refreshHostTelemetry(db,opts(raw)),/credencial/);assert.equal(hostTelemetryReport(db,{enabled:true}).latest,null);
 const value=normalizeCoolifyServer({uuid:id,name:token,ip:'private-address',user:'root',settings:{is_sentinel_enabled:true,is_metrics_enabled:false,sentinel_token:'MUST-NOT-STORE'}},id,token,at);assert.equal(value.name,'Servidor de Coolify');assert.equal(JSON.stringify(value).includes('MUST-NOT-STORE'),false);assert.equal('ip' in value,false);assert.throws(()=>normalizeCoolifyServer({uuid:'other'},id));
}));
function transport(status,body,inspect=()=>{}){return (url,options,callback)=>{inspect(url,options);const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers={'content-type':'application/json'};callback(res);res.end(JSON.stringify(body))});return req}}
test('Coolify server detail uses GET with pinned public DNS and bounded redacted permission, redirect and identity failures',async()=>{
 const address={address:'93.184.216.34',family:4},resolve=async()=>[address];let requests=0;
 const result=await inspectCoolifyServer(origin,token,id,{resolve,request:transport(200,{uuid:id,name:'Host',settings:{sentinel_token:'DO-NOT-LEAK'}},(url,o)=>{requests++;assert.equal(url.pathname,'/api/v1/servers/host-a');assert.equal(o.method,'GET');o.lookup('panel.example',{all:true},(_e,list)=>assert.deepEqual(list,[address]));assert.ok(o.signal instanceof AbortSignal)})});assert.equal(requests,1);assert.equal(result.id,id);assert.equal(JSON.stringify(result).includes('DO-NOT-LEAK'),false);
 for(const status of [401,403,302,429,500])await assert.rejects(inspectCoolifyServer(origin,token,id,{resolve,request:transport(status,{secret:token})}),e=>!e.message.includes(token));
 await assert.rejects(inspectCoolifyServer(origin,token,id,{resolve,request:transport(200,{uuid:'other'})}));await assert.rejects(inspectCoolifyServer(origin,token,id,{resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>{throw Error('should not request')}}));
});
test('restoring dated host evidence clears in-flight lease, preserves original and pauses observation when preparing a server copy',async()=>sandbox(async(db,root)=>{
 await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:3119,mode:'demo'});await refreshHostTelemetry(db,opts());db.db.exec("UPDATE host_telemetry_state SET lease='in-flight',lease_expires=9999999999999");
 const copy=path.join(root,'backup'),target=path.join(root,'restored');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));const restored=new Store(target);try{const report=hostTelemetryReport(restored,{enabled:true,now:at});assert.equal(report.latest.sampledAt,at);assert.equal(restored.db.prepare('SELECT lease FROM host_telemetry_state').get().lease,null);assert.equal(db.db.prepare('SELECT lease FROM host_telemetry_state').get().lease,'in-flight');recoverHostTelemetry(restored)}finally{restored.close()}
 const prepared=path.join(root,'prepared');await prepareServerCopy(copy,prepared,path.join(root,'.keys/vault.key'),'https://console.example');const isolated=new Store(prepared);try{assert.equal(hostTelemetryReport(isolated,{enabled:true,now:at}).status,'paused');assert.equal(hostTelemetryReport(isolated,{enabled:false,now:at}).configured,false)}finally{isolated.close()}
}));
