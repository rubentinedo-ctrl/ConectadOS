import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {configuration,tick,report,validateState,MAX_BYTES} from '../lib/monitor.mjs';
import {endpoint,authorized} from '../lib/endpoint.mjs';
import {probe,origin} from '../lib/probe.mjs';
import {blobStore} from '../lib/blob.mjs';
import {BlobPreconditionFailedError} from '@vercel/blob';
const config=configuration({OBSERVER_TARGETS:JSON.stringify([{id:'panel',url:'https://panel.example'}])});
const time=()=>{let value=1791700000000;return {now:()=>value,advance:(delta=300000)=>value+=delta};};
function memory(){let data=null,version=0;return {read:async()=>data?structuredClone(data):null,compareAndSet:async(etag,value)=>{if(etag!==(data?.etag??null))return null;data={etag:String(++version),value:structuredClone(value)};return data.etag;},data:()=>structuredClone(data)};}
const observation=(now,kind='responding')=>({checkedAt:now(),kind,status:kind==='responding'?200:kind==='protected'?401:kind==='http-error'?503:null,durationMs:['responding','protected','http-error'].includes(kind)?12:null,certificateExpiresAt:null});
const response=()=>({code:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}});
test('configuration rejects unsafe or excessive targets and distinguishes revisions',()=>{
 for(const url of ['http://web.example','https://127.0.0.1','https://[::1]','https://web.example/health','https://web.example?key=SECRET','https://user:SECRET@web.example','https://web.example:8443','https://web.example.','https://localhost'])assert.throws(()=>origin(url));
 assert.throws(()=>configuration({OBSERVER_TARGETS:'[{"id":"a","url":"https://a.example","extra":"SECRET"}]'}));
 assert.throws(()=>configuration({OBSERVER_TARGETS:'[]'}));
 assert.throws(()=>configuration({OBSERVER_TARGETS:JSON.stringify([{id:'a',url:'https://a.example'},{id:'a',url:'https://b.example'}])}));
 assert.throws(()=>configuration({OBSERVER_TARGETS:JSON.stringify(Array.from({length:9},(_,i)=>({id:'a'+i,url:'https://a'+i+'.example'})))}));
 assert.notEqual(config.hash,configuration({OBSERVER_TARGETS:JSON.stringify(config.targets),OBSERVER_INTERVAL_SECONDS:'60'}).hash);
});
test('outage opens once after three consecutive failures, recovery twice, stale reports never claim health',async()=>{
 const store=memory(),clock=time();let kind='responding';const check=async()=>observation(clock.now,kind);
 await tick(store,config,{now:clock.now,check});assert.equal(report(store.data().value,config,clock.now()).targets[0].current,'checking');
 clock.advance();await tick(store,config,{now:clock.now,check});assert.equal(store.data().value.targets[0].status,'responding');
 kind='unreachable';for(let i=0;i<5;i++){clock.advance();await tick(store,config,{now:clock.now,check});}
 assert.equal(store.data().value.events.length,1);assert.equal(store.data().value.targets[0].status,'issue');assert.equal(store.data().value.events[0].delivery,'not-configured');
 kind='responding';clock.advance();await tick(store,config,{now:clock.now,check});assert.equal(store.data().value.targets[0].status,'issue');
 clock.advance();await tick(store,config,{now:clock.now,check});assert.deepEqual(store.data().value.events.map(e=>e.kind),['issue','recovered']);
 assert.equal(report(store.data().value,config,clock.now()).targets[0].current,'responding');
 clock.advance(650000);assert.equal(report(store.data().value,config,clock.now()).targets[0].current,'unknown');
 assert.equal(report(store.data().value,config,clock.now()).status,'stale');
});
test('gaps reset confirmation counters and protected pages are not application health',async()=>{
 const store=memory(),clock=time(),check=async()=>observation(clock.now,'protected');
 await tick(store,config,{now:clock.now,check});clock.advance();await tick(store,config,{now:clock.now,check});
 clock.advance(660000);await tick(store,config,{now:clock.now,check});assert.equal(store.data().value.targets[0].failures,1);assert.equal(store.data().value.events.length,0);
 for(let i=0;i<2;i++){clock.advance();await tick(store,config,{now:clock.now,check});}assert.equal(store.data().value.events.length,1);
});
test('simultaneous invocations and expired writers cannot replace newer observations',async()=>{
 const store=memory(),clock=time();let finish;
 const pending=new Promise(r=>finish=r);let checks=0;
 const job=tick(store,config,{now:clock.now,check:async()=>{checks++;await pending;return observation(clock.now);}});
 await new Promise(r=>setImmediate(r));
 assert.equal((await tick(store,config,{now:clock.now,check:async()=>{checks++;return observation(clock.now);}})).status,'busy');
 finish();assert.equal((await job).status,'observed');assert.equal(checks,1);
 assert.equal((await tick(store,config,{now:clock.now,check:async()=>observation(clock.now)})).status,'not-due');
 clock.advance();let finishOld;const oldPending=new Promise(r=>finishOld=r);
 const old=tick(store,config,{now:clock.now,check:async()=>{await oldPending;return observation(clock.now);}});await new Promise(r=>setImmediate(r));
 clock.advance();assert.equal((await tick(store,config,{now:clock.now,check:async()=>observation(clock.now)})).status,'observed');
 finishOld();assert.equal((await old).status,'expired');assert.equal(store.data().value.history.length,2);
 // Force a write conflict after a fast completed observation.
 clock.advance();const loser={read:store.read,compareAndSet:async(etag,value)=>value.lease?store.compareAndSet(etag,value):null};
 assert.equal((await tick(loser,config,{now:clock.now,check:async()=>observation(clock.now)})).status,'superseded');
});
test('corruption, time reversal and configuration changes stop without writes; retention remains bounded',async()=>{
 const store=memory(),clock=time(),check=async()=>observation(clock.now);
 await tick(store,config,{now:clock.now,check});const saved=store.data();
 await assert.rejects(tick(store,{...config,hash:'changed'},{now:clock.now,check}));assert.deepEqual(store.data(),saved);
 clock.advance(-10000);assert.equal((await tick(store,config,{now:clock.now,check})).status,'not-due');assert.deepEqual(store.data(),saved);
 assert.throws(()=>validateState({...saved.value,secret:'PRIVATE'},config));
 const cfg=configuration({OBSERVER_TARGETS:JSON.stringify(Array.from({length:8},(_,i)=>({id:'web'+i,url:'https://web'+i+'.example'})))}),many=memory(),c=time();
 for(let i=0;i<140;i++){await tick(many,cfg,{now:c.now,check:async()=>observation(c.now,i%5<3?'http-error':'responding')});c.advance();}
 const result=many.data().value;assert.ok(result.history.length<=60);assert.equal(result.events.length,50);assert.ok(Buffer.byteLength(JSON.stringify(result))<=MAX_BYTES);validateState(result,cfg);
});
test('endpoints authenticate before storage, sanitize errors and separate check from report',async()=>{
 let reads=0,checks=0;const cron='c'.repeat(40),secret='r'.repeat(40),clock=time(),store=memory();
 const env={CRON_SECRET:cron,OBSERVER_REPORT_SECRET:secret,OBSERVER_TARGETS:JSON.stringify(config.targets),OBSERVER_ENABLED:'1'};
 const wrapped={...store,read:async()=>{reads++;return store.read();}};
 for(const kind of ['check','report']){
  const handler=endpoint(kind,{env,store:wrapped,now:clock.now,check:async()=>{checks++;return observation(clock.now);}});
  for(const [request,code] of [[{method:'GET',headers:{}},401],[{method:'POST',headers:{authorization:'Bearer '+cron}},405],[{method:'GET',headers:{authorization:'Bearer '+(kind==='check'?secret:cron)}},401],[{method:'GET',query:{target:'https://evil.example'},headers:{authorization:'Bearer '+cron}},400]]){
   const res=response();await handler(request,res);assert.equal(res.code,code);assert.equal(res.headers['Cache-Control'],'private, no-store');
  }
 }
 assert.equal(reads,0);assert.equal(checks,0);
 const res=response();await endpoint('check',{env,store,now:clock.now,check:async()=>observation(clock.now)})({method:'GET',headers:{authorization:'Bearer '+cron}},res);assert.equal(res.code,200);
 const view=response();await endpoint('report',{env,store,now:clock.now})({method:'GET',headers:{authorization:'Bearer '+secret}},view);assert.equal(view.code,200);assert.equal(view.body.targets.length,1);assert.equal(JSON.stringify(view.body).includes(cron),false);
 const failed=response();await endpoint('report',{env,store:{read:async()=>{throw new Error('PRIVATE-RUNTIME-MARKER');}}})({method:'GET',headers:{authorization:'Bearer '+secret}},failed);assert.equal(failed.code,503);assert.equal(JSON.stringify(failed.body).includes('PRIVATE'),false);
 const health=response();await endpoint('health')({method:'GET',headers:{}},health);assert.deepEqual(health.body,{service:'conectados-observer',version:1});
 assert.equal(authorized('Bearer '+cron,cron),true);assert.equal(authorized('Bearer '+cron,'short'),false);
 const paused=response();await endpoint('report',{env:{...env,OBSERVER_ENABLED:'0'},store})({method:'GET',headers:{authorization:'Bearer '+secret}},paused);assert.equal(paused.code,409);
});
test('Blob reads bypass cache and writes require the exact ETag or create-only; private failures propagate',async()=>{
 let options,body;
 const store=blobStore({metadata:async()=>({pathname:'observer/state-v1.json',etag:'etag-1'}),record:()=>{},read:async(path,opts)=>{assert.equal(path,'observer/state-v1.json');assert.equal(opts.useCache,false);assert.equal(opts.access,'private');return {statusCode:200,stream:new ReadableStream({start(c){c.enqueue(Buffer.from('{"ok":true}'));c.close();}}),blob:{pathname:path,etag:'etag-1',size:11}};},write:async(path,value,opts)=>{options=opts;body=value;return {etag:'etag-2'};}});
 assert.deepEqual(await store.read(),{etag:'etag-1',value:{ok:true}});
 assert.equal(await store.compareAndSet('etag-1',{ok:true}),'etag-2');assert.equal(options.ifMatch,'etag-1');assert.equal(options.allowOverwrite,true);assert.equal(options.access,'private');assert.equal(options.addRandomSuffix,false);assert.equal(body,'{"ok":true}');
 await store.compareAndSet(null,{ok:true});assert.equal(options.allowOverwrite,false);assert.equal(options.ifMatch,undefined);
 for(const e of [new BlobPreconditionFailedError()])assert.equal(await blobStore({write:async()=>{throw e;}}).compareAndSet(null,{}),null);
 await assert.rejects(blobStore({write:async()=>{throw new Error('access denied');}}).compareAndSet(null,{}));
 await assert.rejects(blobStore({metadata:async()=>({pathname:'observer/state-v1.json',etag:'etag-1'}),read:async()=>({statusCode:200,blob:{pathname:'wrong',size:99999,etag:'x'},stream:{}})}).read());
});
test('HTTPS probe blocks mixed DNS, pins public addresses, never follows redirects or stores raw headers',async()=>{
 let calls=0;
 const transport=(status=200,authorized=true)=>(url,options,callback)=>{calls++;assert.equal(options.method,'HEAD');assert.equal(options.rejectUnauthorized,true);assert.deepEqual(Object.keys(options.headers),['User-Agent']);options.lookup('changed.example',{},(_e,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4);});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers={'set-cookie':'PRIVATE','location':'https://127.0.0.1'};res.socket={authorized,getPeerCertificate:()=>({valid_to:'Jan 01 00:00:00 2027 GMT'})};callback(res);res.end();});return req;};
 const resolve=async()=>[{family:4,address:'8.8.8.8'}];
 const bad=await probe('https://panel.example',{resolve:async()=>[{family:4,address:'8.8.8.8'},{family:4,address:'169.254.169.254'}],request:transport()});assert.equal(bad.kind,'blocked');assert.equal(calls,0);
 const result=await probe('https://panel.example',{resolve,request:transport(302)});assert.equal(result.kind,'responding');assert.equal(calls,1);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(JSON.stringify(result).includes('127.0.0.1'),false);
 assert.equal((await probe('https://panel.example',{resolve,request:transport(200,false)})).kind,'unreachable');
 const controller=new AbortController();controller.abort();assert.equal((await probe('https://panel.example',{resolve,request:transport(),signal:controller.signal})).kind,'unreachable');assert.equal(calls,2);
});

test('private export restores validated state with effects paused and lease removed, without altering the source',async()=>{
 const {recoverExport}=await import('../lib/recovery.mjs');const store=memory(),clock=time(),secret='r'.repeat(40);
 await tick(store,config,{now:clock.now,check:async()=>observation(clock.now)});
 const original=store.data();const env={OBSERVER_TARGETS:JSON.stringify(config.targets),CRON_SECRET:'c'.repeat(40),OBSERVER_REPORT_SECRET:secret,OBSERVER_ENABLED:'1'};
 const unauthorized=response();await endpoint('export',{env,store,now:clock.now})({method:'GET',headers:{}},unauthorized);assert.equal(unauthorized.code,401);
 const res=response();await endpoint('export',{env,store,now:clock.now})({method:'GET',headers:{authorization:'Bearer '+secret}},res);assert.equal(res.code,200);
 const recovered=recoverExport(JSON.stringify(res.body));assert.equal(recovered.enabled,false);assert.equal(recovered.state.lease,null);assert.deepEqual(recovered.state.history,original.value.history);assert.deepEqual(store.data(),original);
 assert.throws(()=>recoverExport(JSON.stringify({...res.body,secret:'PRIVATE'})));
 assert.throws(()=>recoverExport(JSON.stringify({...res.body,state:{...res.body.state,configurationHash:'wrong'}})));
 assert.throws(()=>recoverExport(JSON.stringify({...res.body,exportedAt:res.body.exportedAt-1})));
});

test('reader sends its key only to the fixed HTTPS export path; TLS, DNS, redirects, secret payloads and stale copies fail closed',async()=>{
 const {readExport}=await import('../lib/client.mjs');const store=memory(),clock=time();await tick(store,config,{now:clock.now,check:async()=>observation(clock.now)});
 const backup={backupVersion:1,exportedAt:clock.now(),configuration:{targets:config.targets,intervalSeconds:config.intervalSeconds},state:store.data().value};
 const reader={url:'https://observer.example',readSecret:'r'.repeat(40)};let calls=0;
 const transport=({code=200,tls=true,payload=JSON.stringify(backup)}={})=>(url,options,callback)=>{
  calls++;assert.equal(url.href,'https://observer.example/api/export');assert.equal(options.method,'GET');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.headers.Authorization,'Bearer '+reader.readSecret);
  options.lookup('wrong.example',{},(_err,ip)=>assert.equal(ip,'8.8.8.8'));
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=code;res.headers={'content-type':'application/json','location':'https://127.0.0.1?PRIVATE'};res.socket={authorized:tls};callback(res);res.end(payload);});return req;
 };
 const opts={now:clock.now,resolve:async()=>[{family:4,address:'8.8.8.8'}]};
 const read=await readExport(reader,{...opts,request:transport()});assert.equal(read.source,'https://observer.example/api/export');assert.equal(read.state.history.length,1);
 await assert.rejects(readExport(reader,{...opts,resolve:async()=>[{family:4,address:'127.0.0.1'}],request:transport()}));assert.equal(calls,1);
 for(const options of [{code:302},{tls:false},{payload:JSON.stringify({...backup,secret:reader.readSecret})},{payload:'x'.repeat(71537)},{payload:JSON.stringify({...backup,exportedAt:clock.now()-120001})}])await assert.rejects(readExport(reader,{...opts,request:transport(options)}),/Could not read a valid private observer export/);
});


test('check diagnostics record only a fixed outcome and time, without targets or access keys',async()=>{
 const store=memory(),clock=time(),records=[],env={CRON_SECRET:'c'.repeat(40),OBSERVER_REPORT_SECRET:'r'.repeat(40),OBSERVER_TARGETS:JSON.stringify(config.targets),OBSERVER_ENABLED:'1'};
 const handler=endpoint('check',{env,store,now:clock.now,check:async()=>observation(clock.now),record:v=>records.push(v)});
 for(let i=0;i<2;i++){const res=response();await handler({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},res);assert.equal(res.code,200);}
 assert.deepEqual(records,[{component:'observer-check',outcome:'observed',at:clock.now()},{component:'observer-check',outcome:'not-due',at:clock.now()}]);
 const bad=endpoint('check',{env,store:{read:async()=>{throw new Error('PRIVATE-ERROR')}},now:clock.now,record:v=>records.push(v)}),res=response();await bad({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},res);assert.equal(res.code,503);assert.deepEqual(records.at(-1),{component:'observer-check',outcome:'failed',at:clock.now()});
 assert.equal(JSON.stringify(records).includes('panel.example'),false);assert.equal(JSON.stringify(records).includes(env.CRON_SECRET),false);assert.equal(JSON.stringify(records).includes('PRIVATE'),false);
});


test('storage writes use canonical metadata tags and reject a version changing during download',async()=>{
 const stream=()=>new ReadableStream({start(c){c.enqueue(Buffer.from('{"ok":true}'));c.close();}});
 const read=async()=>({statusCode:200,stream:stream(),blob:{pathname:'observer/state-v1.json',etag:'download-version',size:11}});
 const records=[];const store=blobStore({read,metadata:async()=>({pathname:'observer/state-v1.json',etag:'canonical-version'}),record:v=>records.push(v)});assert.deepEqual(await store.read(),{etag:'canonical-version',value:{ok:true}});assert.deepEqual(records,[{component:'observer-storage',downloadTagMatches:false}]);
 let n=0;await assert.rejects(blobStore({read,metadata:async()=>({pathname:'observer/state-v1.json',etag:String(n++)}),record:()=>{}}).read(),/version changed/);
});
