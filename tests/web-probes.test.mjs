import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Store} from '../lib/server/store.mjs';import {probeURL,checkWeb,refreshWebProbe,collectWebProbes} from '../lib/server/web-probes.mjs';import {collectorTick} from '../lib/server/collector.mjs';import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';import {saveConfig} from '../scripts/config.mjs';
const address={address:'8.8.8.8',family:4};
function transport({status=200,authorized=true,error=false,inspect=()=>{},validTo='Jan 01 00:00:00 2027 GMT'}={}){return(url,options,callback)=>{
 inspect(url,options);const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{if(error){req.emit('error',new Error('PRIVATE-TRANSPORT-MARKER'));return}const res=new PassThrough();res.statusCode=status;res.headers={location:'https://127.0.0.1/?secret=PRIVATE-MARKER','set-cookie':'PRIVATE-MARKER'};res.socket={authorized,getPeerCertificate:()=>({valid_to:validTo,subject:{CN:'PRIVATE-MARKER'}})};callback(res);res.end()});return req;
}}
const sample=(url,kind='response',httpStatus=200)=>{const checkedAt=Date.now();return {source:url,method:'HEAD',checkedAt,expiresAt:checkedAt+300000,kind,httpStatus,durationMs:httpStatus===null?null:42,certificateExpiresAt:null,error:null}};
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-probe-test-'));const db=new Store(root);try{await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
test('web probes require a public HTTPS origin and never contact mixed/private DNS or propagate credentials',async()=>{
 for(const value of ['http://web.example','https://localhost','https://127.0.0.1','https://[::1]','https://web.example:8443','https://web.example/health','https://user:password@web.example','https://web.example?key=secret','https://web.example#key','https://web.example.'])assert.throws(()=>probeURL(value));
 let calls=0;const blocked=await checkWeb('https://web.example',{resolve:async()=>[address,{family:4,address:'169.254.169.254'}],request:transport({inspect:()=>calls++})});assert.equal(blocked.kind,'blocked');assert.equal(calls,0);
 const result=await checkWeb('https://web.example/',{resolve:async()=>[address],request:transport({inspect:(url,options)=>{calls++;assert.equal(url.href,'https://web.example/');assert.equal(options.method,'HEAD');assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,true);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);options.lookup('web.example',{all:true},(_err,values)=>assert.deepEqual(values,[address]));assert.ok(options.signal instanceof AbortSignal)}})});
 assert.equal(result.kind,'response');assert.equal(result.httpStatus,200);assert.equal(result.source,'https://web.example');assert.ok(result.durationMs>=0);assert.equal(result.certificateExpiresAt,Date.parse('2027-01-01'));assert.equal(JSON.stringify(result).includes('PRIVATE-MARKER'),false);
});
test('web probes classify redirects and restricted access separately and redact transport and certificate failures',async()=>{
 for(const [status,kind] of [[204,'response'],[302,'redirect'],[401,'protected'],[403,'protected'],[405,'unsupported'],[404,'http-error'],[503,'http-error']]){
  let calls=0;const r=await checkWeb('https://web.example',{resolve:async()=>[address],request:transport({status,inspect:()=>calls++})});assert.equal(r.kind,kind);assert.equal(calls,1);assert.equal(JSON.stringify(r).includes('PRIVATE-MARKER'),false);
 }
 for(const options of [{error:true},{authorized:false}]){const r=await checkWeb('https://web.example',{resolve:async()=>[address],request:transport(options)});assert.equal(r.kind,'unreachable');assert.equal(r.httpStatus,null);assert.equal(JSON.stringify(r).includes('PRIVATE-TRANSPORT-MARKER'),false)}
 const abort=new AbortController();abort.abort();let called=false;const cancelled=await checkWeb('https://web.example',{signal:abort.signal,resolve:async()=>{called=true;return [address]}});assert.equal(cancelled.kind,'unreachable');assert.equal(called,false);
 const pending=new AbortController();const never=new Promise(()=>{});const delayed=checkWeb('https://web.example',{signal:pending.signal,resolve:()=>never});pending.abort();assert.equal((await delayed).kind,'unreachable');
});
test('web probe history preserves last response after failure, resets on target change, bounds age, and survives recovery',async()=>sandbox(async(db,root)=>{
 await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:4200,mode:'demo'});const id=db.configureWebProbe({label:'Fixture website',url:'https://web.example',enabled:true});
 assert.throws(()=>db.configureWebProbe({label:'Duplicate',url:'https://web.example',enabled:true}),{status:409});assert.throws(()=>db.configureWebProbe({id:'../wrong',label:'Wrong',url:'https://web.example',enabled:true}));
 let p=db.webProbes()[0];db.saveWebProbeResult(id,p.revision,sample(p.url));const first=db.webProbes()[0].snapshot;
 db.saveWebProbeResult(id,p.revision,{...sample(p.url,'unreachable',null),error:'PRIVATE-RAW-ERROR'});p=db.webProbes()[0];assert.equal(p.snapshot.lastResponse.checkedAt,first.checkedAt);assert.equal(p.snapshot.lastResponse.httpStatus,200);assert.equal(p.snapshot.kind,'unreachable');assert.equal(JSON.stringify(p).includes('PRIVATE-RAW-ERROR'),false);assert.equal(p.history.length,2);
 db.db.prepare('INSERT INTO web_probe_history(probe_id,checked,snapshot) VALUES(?,?,?)').run(id,Date.now()-8*86400000,JSON.stringify(first));db.saveWebProbeResult(id,p.revision,sample(p.url));assert.equal(db.webProbes()[0].history.length,3);
 const copy=path.join(root,'copy'),target=path.join(root,'restored');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));const recovered=new Store(target);try{assert.deepEqual(recovered.webProbes(),db.webProbes());assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM provider_collection_lease').get().n,0)}finally{recovered.close()}
 const oldRevision=p.revision;db.configureWebProbe({id,label:'Changed',url:'https://other.example',enabled:true});assert.equal(db.webProbes()[0].snapshot,null);assert.deepEqual(db.webProbes()[0].history,[]);assert.throws(()=>db.saveWebProbeResult(id,oldRevision,sample('https://web.example')),{status:409});db.removeWebProbe(id);assert.deepEqual(db.webProbes(),[]);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM web_probe_history').get().n,0);
}));
test('web collection respects global and individual pause, shares leases and cannot overwrite an edited target',async()=>sandbox(async(db,root)=>{
 const id=db.configureWebProbe({label:'Fixture',url:'https://web.example',enabled:true});let calls=0;const check=async url=>{calls++;return sample(url)};
 assert.deepEqual(await collectorTick(db),{disabled:true});assert.equal(db.webProbes()[0].snapshot,null);
 await collectWebProbes(db,{check});assert.equal(calls,1);await refreshWebProbe(db,id,{check});assert.equal(calls,1);
 const other=new Store(root);let finish;const promise=new Promise(r=>finish=r);const running=refreshWebProbe(db,id,{force:true,check:async url=>{await promise;return sample(url)}});
 try{assert.deepEqual(await refreshWebProbe(other,id,{force:true,check}),{busy:true});db.configureWebProbe({id,label:'New target',url:'https://other.example',enabled:false});finish();await assert.rejects(running,{status:409});assert.equal(db.webProbes()[0].snapshot,null);assert.deepEqual(await refreshWebProbe(db,id,{check}),{disabled:true});await refreshWebProbe(db,id,{force:true,check});assert.equal(calls,2)}finally{finish();other.close()}
}));

test('probe configuration and results enforce target limits, classification and bounded retained history',async()=>sandbox(async db=>{
 for(let i=0;i<20;i++)db.configureWebProbe({label:'Fixture '+i,url:`https://web${i}.example`,enabled:false});
 assert.throws(()=>db.configureWebProbe({label:'Over limit',url:'https://excess.example',enabled:false}),{status:409});
 const p=db.webProbes()[0];assert.throws(()=>db.saveWebProbeResult(p.id,p.revision,sample(p.url,'response',503)),/Clasificación/);assert.throws(()=>db.saveWebProbeResult(p.id,p.revision,{...sample(p.url),source:'https://other.example'}),/no compatible/);
 const insert=db.db.prepare('INSERT INTO web_probe_history(probe_id,checked,snapshot) VALUES(?,?,?)');db.db.exec('BEGIN');for(let i=0;i<10085;i++)insert.run(p.id,Date.now(),JSON.stringify(sample(p.url)));db.db.exec('COMMIT');db.saveWebProbeResult(p.id,p.revision,sample(p.url));assert.equal(db.db.prepare('SELECT COUNT(*) n FROM web_probe_history WHERE probe_id=?').get(p.id).n,10080);assert.equal(db.webProbes()[0].history.length,60);
}));
