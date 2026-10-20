import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {configuration,tick} from '../lib/monitor.mjs';
import {blobStore} from '../lib/blob.mjs';
import {mailAddress,mailBody,sendObserverMail} from '../lib/mail-transport.mjs';
import {mailConfiguration,validateMailState,prepareMail,planMailTest,confirmMailReceipt,setMailPolicy,mailReport,recoverMailState,dispatchMailTest,mailTick} from '../lib/mail.mjs';

const key='re_ISOLATED_MAIL_FIXTURE_ONLY_'.repeat(2);
const env={OBSERVER_ENABLED:'1',OBSERVER_MAIL_ENABLED:'1',OBSERVER_MAIL_KEY:key,OBSERVER_MAIL_INSTANCE:'ISOLATED_INSTANCE_ONLY_'.repeat(3),OBSERVER_MAIL_FROM:'observer@example.com',OBSERVER_MAIL_TO:'owner@example.com',CRON_SECRET:'c'.repeat(40),OBSERVER_REPORT_SECRET:'r'.repeat(40),OBSERVER_MAIL_CONTROL_SECRET:'m'.repeat(40)};
const monitorConfig=configuration({OBSERVER_TARGETS:JSON.stringify([{id:'panel',url:'https://panel.example'}])});
const cfg=mailConfiguration(env,monitorConfig);
function memory(){let data=null,n=0;return {read:async()=>structuredClone(data),compareAndSet:async(etag,value)=>{if(etag!==(data?.etag??null))return null;data={etag:String(++n),value:structuredClone(value)};return data.etag;},data:()=>structuredClone(data)};}
function clock(){let n=1791735000000;return {now:()=>n,advance:(delta=300000)=>n+=delta};}
const publicDNS=async()=>[{address:'8.8.8.8',family:4}];
const body=JSON.stringify({from:cfg.from,to:[cfg.to],subject:'Fixture',text:'Isolated message'});
const responseID=randomUUID();
function transport({code=200,tls=true,payload=JSON.stringify({id:responseID}),stall=false,onRequest=()=>{}}={}){return (url,opts,callback)=>{
 onRequest(url,opts);assert.equal(url,'https://api.resend.com/emails');assert.equal(opts.method,'POST');assert.equal(opts.agent,false);assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.headers.Authorization,'Bearer '+key);opts.lookup('other.example',{},(_error,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4)});
 const request=new EventEmitter();request.destroy=()=>{};request.end=text=>{assert.equal(text,body);queueMicrotask(()=>{const res=new PassThrough();res.statusCode=code;res.headers={'content-type':'application/json',location:'https://127.0.0.1'};res.socket={authorized:tls};callback(res);if(!stall)res.end(payload);})};return request;
};}
async function sender(_key,text,_id,{beforeDispatch}){await beforeDispatch();return {status:'accepted',providerId:randomUUID()};}
async function reviewed(store,c,config=cfg){await prepareMail(store,config,{now:c.now(),consent:true});const plan=await planMailTest(store,config,{now:c.now(),revision:store.data().value.revision,consent:true});let code;
 await dispatchMailTest(store,config,{id:plan.id,revision:plan.revision,consent:true,now:c.now,send:async(k,text,id,opts)=>{assert.equal(k,key);code=JSON.parse(text).text.match(/\n([A-Za-z0-9_-]{24})\n/)[1];return sender(k,text,id,opts)}});
 await confirmMailReceipt(store,config,{id:plan.id,code,revision:store.data().value.revision,now:c.now(),consent:true});await setMailPolicy(store,config,{active:true,revision:store.data().value.revision,now:c.now(),consent:true});return {plan,code};
}
async function observe(source,c,kind='responding'){return tick(source,monitorConfig,{now:c.now,check:async()=>({checkedAt:c.now(),kind,status:kind==='responding'?200:null,durationMs:kind==='responding'?10:null,certificateExpiresAt:null})});}
async function outage(source,c){for(let i=0;i<3;i++){await observe(source,c,'unreachable');if(i<2)c.advance();}}

test('mail payload accepts one plain fixed address and rejects arbitrary fields, headers and recipients',async()=>{
 assert.equal(mailAddress('owner@EXAMPLE.com'),'owner@example.com');assert.equal(mailBody(body).to[0],cfg.to);
 for(const value of ['Name <owner@example.com>',' owner@example.com','a..b@example.com','a@example..com','a@example.com\r\nBcc: secret@example.com'])assert.throws(()=>mailAddress(value));
 for(const value of [{...JSON.parse(body),bcc:['other@example.com']},{...JSON.parse(body),to:[cfg.to,'other@example.com']},{...JSON.parse(body),subject:'bad\nheader'}])assert.throws(()=>mailBody(JSON.stringify(value)));
 let calls=0;await assert.rejects(sendObserverMail(key,body,'fixture',{resolve:async()=>{calls++;return publicDNS()}}));assert.equal(calls,0);
 await assert.rejects(sendObserverMail(key,body,'https://secret.example?token=key',{beforeDispatch:async()=>{}}));
});

test('mail transport pins public DNS, validates TLS, never follows redirects and sanitizes acknowledgements',async()=>{
 let calls=0;const options={resolve:publicDNS,beforeDispatch:async()=>{},request:transport({onRequest:(_u,o)=>{calls++;assert.equal(o.headers['Idempotency-Key'],'fixture/1')}})};
 assert.deepEqual(await sendObserverMail(key,body,'fixture/1',options),{status:'accepted',providerId:responseID});
 assert.deepEqual(await sendObserverMail(key,body,'fixture/1',{...options,resolve:async()=>[{family:4,address:'8.8.8.8'},{family:4,address:'127.0.0.1'}]}),{status:'rejected',code:'blocked-dns'});assert.equal(calls,1);
 for(const spec of [{code:302},{tls:false},{payload:'PRIVATE'},{payload:JSON.stringify({id:responseID,key})},{payload:'x'.repeat(8193)}])assert.equal((await sendObserverMail(key,body,'fixture/1',{...options,request:transport(spec)})).status,'uncertain');
 assert.deepEqual(await sendObserverMail(key,body,'fixture/1',{...options,request:transport({code:403})}),{status:'rejected',code:'permission'});
 assert.deepEqual(await sendObserverMail(key,body,'fixture/1',{...options,request:transport({code:429})}),{status:'retryable',code:'provider-busy'});
});

test('transport has one total deadline across DNS, approval and response; aborted calls start no operation',async()=>{
 let requests=0,lookups=0;const options={timeoutMs:20,resolve:async()=>{lookups++;return publicDNS()},beforeDispatch:async()=>{},request:transport({stall:true,onRequest:()=>requests++})};
 assert.equal((await sendObserverMail(key,body,'fixture',options)).status,'uncertain');assert.equal(requests,1);
 assert.equal((await sendObserverMail(key,body,'fixture',{...options,resolve:()=>new Promise(()=>{})})).status,'not-dispatched');
 assert.equal((await sendObserverMail(key,body,'fixture',{...options,beforeDispatch:()=>new Promise(()=>{})})).status,'not-dispatched');assert.equal(requests,1);
 const aborted=new AbortController();aborted.abort();const old=lookups;assert.equal((await sendObserverMail(key,body,'fixture',{...options,signal:aborted.signal})).status,'not-dispatched');assert.equal(lookups,old);
});

test('new outbox is paused and encrypted; API acceptance alone cannot activate alerts',async()=>{
 assert.equal(mailConfiguration({},monitorConfig),null);assert.equal(mailConfiguration({...env,OBSERVER_MAIL_ENABLED:undefined},monitorConfig).enabled,false);
 for(const change of [{OBSERVER_MAIL_INSTANCE:env.CRON_SECRET},{OBSERVER_MAIL_KEY:env.CRON_SECRET},{OBSERVER_MAIL_DAILY_LIMIT:'51'},{OBSERVER_MAIL_DETAILS:'yes'}])assert.throws(()=>mailConfiguration({...env,...change},monitorConfig));
 const store=memory(),c=clock();await assert.rejects(prepareMail(store,cfg));await prepareMail(store,cfg,{consent:true,now:c.now()});const plan=await planMailTest(store,cfg,{revision:store.data().value.revision,now:c.now(),consent:true});
 assert.deepEqual(Object.keys(plan).sort(),['from','id','revision','to']);const stored=JSON.stringify(store.data().value);for(const marker of [cfg.from,cfg.to,key,env.OBSERVER_MAIL_INSTANCE,'Confirma la recepción'])assert.equal(stored.includes(marker),false);
 await dispatchMailTest(store,cfg,{id:plan.id,revision:plan.revision,consent:true,now:c.now,send:sender});assert.equal(mailReport(store.data().value,cfg,{now:c.now()}).receiptConfirmed,false);
 await assert.rejects(setMailPolicy(store,cfg,{active:true,revision:store.data().value.revision,consent:true,now:c.now()}),/Confirm test/);
});

test('test receipt confirms only its configuration; repetition never resends and wrong codes fail',async()=>{
 const store=memory(),c=clock();const {plan,code}=await reviewed(store,c);assert.equal(mailReport(store.data().value,cfg,{now:c.now()}).status,'active');
 const before=store.data();let sends=0;assert.deepEqual(await dispatchMailTest(store,cfg,{id:plan.id,revision:'stale',consent:true,now:c.now,send:async()=>{sends++}}),{status:'accepted',cached:true});assert.equal(sends,0);assert.deepEqual(store.data(),before);
 await assert.rejects(confirmMailReceipt(store,cfg,{id:plan.id,code:'x'.repeat(24),revision:before.value.revision,consent:true,now:c.now()}));
 const changed=mailConfiguration({...env,OBSERVER_MAIL_TO:'new@example.com'},monitorConfig);await assert.rejects(confirmMailReceipt(store,changed,{id:plan.id,code,revision:before.value.revision,consent:true,now:c.now()}));
 const report=JSON.stringify(mailReport(store.data().value,cfg,{now:c.now()}));for(const marker of [code,key,env.OBSERVER_MAIL_INSTANCE,'sealed','payloadHash'])assert.equal(report.includes(marker),false);
});

test('three failures notify once; two responses notify recovery once, stale source sends nothing',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);let sends=0;const send=async(k,text,id,opts)=>{sends++;assert.equal(text.includes('panel.example'),false);return sender(k,text,id,opts)};
 assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send})).status,'accepted');assert.equal(sends,1);
 await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});assert.equal(sends,1);
 c.advance();await observe(source,c);await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});assert.equal(sends,1);
 c.advance();await observe(source,c);await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});assert.equal(sends,2);
 await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});assert.equal(sends,2);c.advance(650000);assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send})).status,'stale-source');assert.equal(sends,2);
});

test('disabled channel reads nothing; pause, mute and changed binding block automatic mail',async()=>{
 let reads=0;const none={read:async()=>{reads++;throw Error('must not read')}};assert.equal((await mailTick(none,none,null,monitorConfig)).status,'disabled');assert.equal((await mailTick(none,none,{...cfg,enabled:false},monitorConfig)).status,'disabled');assert.equal(reads,0);
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);await setMailPolicy(store,cfg,{active:true,mutedUntil:c.now()+300000,revision:store.data().value.revision,now:c.now(),consent:true});
 assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:()=>{throw Error('must not send')}})).status,'muted');
 await setMailPolicy(store,cfg,{active:false,revision:store.data().value.revision,now:c.now(),consent:true});assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now})).status,'paused');
 const changed=mailConfiguration({...env,OBSERVER_MAIL_DETAILS:'1'},monitorConfig);assert.equal((await mailTick(store,source,changed,monitorConfig,{now:c.now})).status,'review-required');await prepareMail(store,changed,{revision:store.data().value.revision,now:c.now(),consent:true});assert.equal(store.data().value.confirmedTest,null);assert.equal(store.data().value.active,false);
});

test('uncertain retries use identical encrypted intent, body and idempotency key, within bounded quota and window',async()=>{
 const store=memory(),source=memory(),c=clock(),small=mailConfiguration({...env,OBSERVER_MAIL_DAILY_LIMIT:'3'},monitorConfig);await reviewed(store,c,small);await outage(source,c);const sent=[];
 const send=async(k,text,id,opts)=>{await opts.beforeDispatch();sent.push({text,id});return {status:'uncertain',code:'unconfirmed'}};
 for(let i=0;i<2;i++){await mailTick(store,source,small,monitorConfig,{now:c.now,send});c.advance();await observe(source,c,'unreachable')}
 assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal((await mailTick(store,source,small,monitorConfig,{now:c.now,send})).status,'quota');assert.equal(sent.length,2);
 c.advance(23*3600000);await observe(source,c,'unreachable');await mailTick(store,source,small,monitorConfig,{now:c.now,send});assert.equal(sent.length,2);
});

test('copy recovery preserves evidence and source while rotating epoch and dropping approval',async()=>{
 const store=memory(),c=clock();const {plan,code}=await reviewed(store,c);const original=store.data().value,recovered=recoverMailState(original);assert.notEqual(recovered.state.epoch,original.epoch);assert.equal(recovered.state.active,false);assert.equal(recovered.state.confirmedTest,null);assert.equal(recovered.enabled,false);assert.equal(recovered.newInstanceRequired,true);assert.deepEqual(store.data().value,original);assert.equal(recovered.state.items[0].status,'accepted');
 const target=memory();await target.compareAndSet(null,recovered.state);await assert.rejects(confirmMailReceipt(target,cfg,{id:plan.id,code,revision:recovered.state.revision,now:c.now(),consent:true}));validateMailState(recovered.state);
});

test('Blob shares one deadline through metadata, body and revalidation and restricts object paths',async()=>{
 assert.throws(()=>blobStore({pathname:'other.json'}));const path='observer/mail-v1.json';let meta=0,reads=0;const store=blobStore({pathname:path,timeoutMs:35,record:()=>{},metadata:async()=>{meta++;await new Promise(r=>setTimeout(r,15));return {pathname:path,etag:'canonical'}},read:async()=>{reads++;await new Promise(r=>setTimeout(r,15));return {statusCode:200,blob:{pathname:path,etag:'download',size:2},stream:new ReadableStream({start(c){c.enqueue(Buffer.from('{}'));c.close()}})}}});
 await assert.rejects(store.read(),/deadline/);assert.equal(reads,1);assert.ok(meta<=2);
 const blocked=blobStore({timeoutMs:10,metadata:()=>new Promise(()=>{}),read:async()=>{reads++;throw Error('must not read')}});await assert.rejects(blocked.read(),/deadline/);assert.equal(reads,1);
});

test('concurrent workers claim one intent and an idle tick preserves revision without storage writes',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);let release,sends=0;const wait=new Promise(r=>release=r);
 const pending=mailTick(store,source,cfg,monitorConfig,{now:c.now,send:async(k,text,id,opts)=>{await opts.beforeDispatch();sends++;await wait;return {status:'accepted',providerId:randomUUID()}}});await new Promise(r=>setImmediate(r));
 assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:sender})).status,'busy');assert.equal(sends,1);release();assert.equal((await pending).status,'accepted');
 const before=store.data();assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:sender})).status,'idle');assert.deepEqual(store.data(),before);
});

test('revocation during source lookup is rechecked before HTTP; late acceptance records truth without restoring policy',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);let reads=0,posts=0;
 const racingSource={read:async()=>{reads++;if(reads===2)await setMailPolicy(store,cfg,{active:false,revision:store.data().value.revision,now:c.now(),consent:true});return source.read()}};
 const blocked=await mailTick(store,racingSource,cfg,monitorConfig,{now:c.now,send:async(k,text,id,opts)=>{try{await opts.beforeDispatch()}catch{return {status:'not-dispatched',code:'unconfirmed'}}posts++;return {status:'accepted',providerId:randomUUID()}}});assert.equal(blocked.status,'cancelled');assert.equal(posts,0);assert.equal(store.data().value.active,false);
 const other=memory();await reviewed(other,c);const sent=await mailTick(other,source,cfg,monitorConfig,{now:c.now,send:async(k,text,id,opts)=>{await opts.beforeDispatch();await setMailPolicy(other,cfg,{active:false,revision:other.data().value.revision,now:c.now(),consent:true});return {status:'accepted',providerId:randomUUID()}}});assert.equal(sent.status,'accepted');assert.equal(other.data().value.active,false);
});

test('failed acknowledgement persistence retries the same intent, not a second message',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);const sent=[];let rejectAck=true;
 const conflicted={read:store.read,compareAndSet:async(etag,value)=>{if(rejectAck&&value.items.some(r=>r.kind==='issue'&&r.status==='accepted'))return null;return store.compareAndSet(etag,value)}};
 const send=async(k,text,id,opts)=>{await opts.beforeDispatch();sent.push({text,id});return {status:'accepted',providerId:responseID}};
 await assert.rejects(mailTick(conflicted,source,cfg,monitorConfig,{now:c.now,send}),/state changed/);assert.equal(store.data().value.items.at(-1).status,'sending');
 rejectAck=false;c.advance();await observe(source,c,'unreachable');assert.equal((await mailTick(conflicted,source,cfg,monitorConfig,{now:c.now,send})).status,'accepted');assert.deepEqual(sent[0],sent[1]);assert.equal(sent.length,2);
});

test('expired or exhausted attempts cannot starve the next incident and older recovery never dispatches',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);let sends=0;const uncertain=async(k,text,id,opts)=>{await opts.beforeDispatch();sends++;return {status:'uncertain',code:'unconfirmed'}};
 for(let i=0;i<3;i++){await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:uncertain});c.advance();await observe(source,c,'unreachable')}
 assert.equal(sends,3);assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:uncertain})).status,'idle');assert.equal(sends,3);
 for(let i=0;i<2;i++){c.advance();await observe(source,c)}
 // A new confirmed outage supersedes the older recovery before the queue runs.
 c.advance();await outage(source,c);assert.equal((await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:sender})).status,'accepted');assert.equal(store.data().value.items.filter(r=>r.kind==='recovered').length,0);
});

test('an incident still active after history retention gets one notice based on current evidence',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);const loaded=source.data();loaded.value.events=[];await source.compareAndSet(loaded.etag,loaded.value);const before=source.data();let sends=0;
 const send=async(k,text,id,opts)=>{sends++;assert.ok(JSON.parse(text).text.includes(new Date(c.now()).toISOString()));return sender(k,text,id,opts)};
 await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});await mailTick(store,source,cfg,monitorConfig,{now:c.now,send});assert.equal(sends,1);assert.deepEqual(source.data(),before);
});

test('attempt times, state shape and tampered encrypted payloads fail before dispatch',async()=>{
 const store=memory(),c=clock();await prepareMail(store,cfg,{now:c.now(),consent:true});const plan=await planMailTest(store,cfg,{revision:store.data().value.revision,consent:true,now:c.now()});const original=store.data();
 for(const mutate of [s=>s.extra='SECRET',s=>s.items[0].createdAt--,s=>s.items[0].firstAttemptAt=c.now(),s=>s.items[0].nextAttemptAt--,s=>s.active=true]){const changed=structuredClone(original.value);mutate(changed);assert.throws(()=>validateMailState(changed))}
 const altered=structuredClone(original.value);altered.items[0].payloadHash='0'.repeat(64);await store.compareAndSet(original.etag,altered);let sends=0;await assert.rejects(dispatchMailTest(store,cfg,{id:plan.id,revision:altered.revision,consent:true,now:c.now,send:async()=>{sends++}}),/binding changed/);assert.equal(sends,0);
});

test('mail endpoints separate read/control/cron access and reject parameters, browser origins and arbitrary recipients before storage',async()=>{
 const {mailEndpoint}=await import('../lib/mail-endpoint.mjs');const {endpoint}=await import('../lib/endpoint.mjs');let reads=0,sends=0;const records=[],store={read:async()=>{reads++;throw Error(key)}};
 const response=()=>({code:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(value){this.body=value;return this}});
 const base={method:'POST',headers:{authorization:'Bearer '+env.OBSERVER_MAIL_CONTROL_SECRET,'content-type':'application/json'},body:{action:'prepare',revision:null,consent:true}};
 const handler=mailEndpoint('control',{env:{...env,OBSERVER_TARGETS:JSON.stringify(monitorConfig.targets)},store,send:async()=>{sends++},record:r=>records.push(r)});
 for(const [req,code] of [[{...base,headers:{...base.headers,authorization:'Bearer '+env.CRON_SECRET}},401],[{...base,headers:{...base.headers,authorization:'Bearer '+env.OBSERVER_REPORT_SECRET}},401],[{...base,method:'GET'},405],[{...base,query:{token:'secret'}},400],[{...base,headers:{...base.headers,origin:'https://other.example'}},400],[{...base,body:{...base.body,to:'other@example.com'}},400],[{...base,body:{...base.body,consent:false}},400],[{...base,body:'x'.repeat(2049)},400]]){const res=response();await handler(req,res);assert.equal(res.code,code);assert.equal(res.headers['Cache-Control'],'private, no-store')}
 assert.equal(reads,0);assert.equal(sends,0);assert.equal(records.length,0);
 const report=mailEndpoint('report',{env:{...env,OBSERVER_TARGETS:JSON.stringify(monitorConfig.targets)},store,record:r=>records.push(r)});const failure=response();await report({method:'GET',headers:{authorization:'Bearer '+env.OBSERVER_REPORT_SECRET}},failure);assert.equal(failure.code,503);assert.equal(JSON.stringify(failure.body).includes(key),false);
 const unconfigured=response();await mailEndpoint('report',{env:{OBSERVER_TARGETS:JSON.stringify(monitorConfig.targets),CRON_SECRET:env.CRON_SECRET,OBSERVER_REPORT_SECRET:env.OBSERVER_REPORT_SECRET},store})({method:'GET',headers:{authorization:'Bearer '+env.OBSERVER_REPORT_SECRET}},unconfigured);assert.equal(unconfigured.code,200);assert.equal(unconfigured.body.status,'not-configured');assert.equal(reads,1);
 let hooked=0;const monitor=memory(),c=clock(),reply=response();await endpoint('check',{store:monitor,env:{OBSERVER_TARGETS:JSON.stringify(monitorConfig.targets),CRON_SECRET:env.CRON_SECRET,OBSERVER_REPORT_SECRET:env.OBSERVER_REPORT_SECRET,OBSERVER_ENABLED:'1'},now:c.now,check:async()=>({checkedAt:c.now(),kind:'responding',status:200,durationMs:1,certificateExpiresAt:null}),afterCheck:async()=>{hooked++;throw Error(key)},record:r=>records.push(r)})({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},reply);assert.equal(reply.code,200);assert.equal(reply.body.status,'observed');assert.equal(hooked,1);assert.equal(JSON.stringify(records).includes(key),false);
});

test('private mail control flow provides metadata without leaking receipt and never grants a reader mutation access',async()=>{
 const {mailEndpoint}=await import('../lib/mail-endpoint.mjs');const store=memory(),c=clock(),records=[],configurationEnv={...env,OBSERVER_TARGETS:JSON.stringify(monitorConfig.targets)};let sentCode,sends=0;
 const handler=mailEndpoint('control',{store,env:configurationEnv,now:c.now,record:r=>records.push(r),send:async(k,text,id,opts)=>{sends++;sentCode=JSON.parse(text).text.match(/\n([A-Za-z0-9_-]{24})\n/)[1];return sender(k,text,id,opts)}});
 const response=()=>({code:null,body:null,setHeader(){},status(code){this.code=code;return this},json(value){this.body=value;return this}});
 async function act(action,extra={}){const res=response();await handler({method:'POST',headers:{authorization:'Bearer '+env.OBSERVER_MAIL_CONTROL_SECRET,'content-type':'application/json'},body:{action,revision:store.data()?.value.revision??null,consent:true,...extra}},res);assert.equal(res.code,200);return res.body}
 await act('prepare');const plan=(await act('plan')).result;const dispatched=await act('send',{id:plan.id});assert.equal(dispatched.result.status,'accepted');assert.equal(sends,1);assert.equal(JSON.stringify(dispatched).includes(sentCode),false);assert.equal(dispatched.report.receiptConfirmed,false);
 await act('receipt',{id:plan.id,code:sentCode});const active=await act('policy',{active:true,mutedUntil:null});assert.equal(active.report.status,'active');
 const exported=response();await mailEndpoint('export',{store,env:configurationEnv,now:c.now})({method:'GET',headers:{authorization:'Bearer '+env.OBSERVER_REPORT_SECRET}},exported);assert.equal(exported.code,200);validateMailState(exported.body.state);assert.equal(exported.body.exportedAt,c.now());for(const marker of [sentCode,key,env.OBSERVER_MAIL_INSTANCE,cfg.from,cfg.to])assert.equal(JSON.stringify(exported.body).includes(marker),false);assert.equal(recoverMailState(exported.body.state).state.active,false);assert.equal(JSON.stringify(records).includes(sentCode),false);
 const missingControl=response();await mailEndpoint('control',{store,env:{...configurationEnv,OBSERVER_MAIL_CONTROL_SECRET:env.OBSERVER_REPORT_SECRET}})({method:'POST',headers:{authorization:'Bearer '+env.OBSERVER_REPORT_SECRET},body:{action:'prepare',revision:null,consent:true}},missingControl);assert.equal(missingControl.code,401);
});

test('automatic mail is inert by default and its failures never expose credentials',async()=>{
 const {automaticMail}=await import('../lib/mail-endpoint.mjs');let reads=0;const none={read:async()=>{reads++;throw Error(key)}};const records=[];
 await automaticMail({env,source:none,store:none,record:r=>records.push(r)}); // Invalid/missing targets is sanitized.
 assert.deepEqual(records.map(r=>[r.component,r.outcome]),[['observer-mail','failed']]);assert.equal(reads,0);assert.equal(JSON.stringify(records).includes(key),false);
 await automaticMail({env:{...env,OBSERVER_MAIL_ENABLED:undefined},source:none,store:none});assert.equal(reads,0);
});

test('a complete mail export restores paused in a new epoch; future, oversized and altered envelopes fail',async()=>{
 const {recoverMailExport}=await import('../lib/mail.mjs');const store=memory(),c=clock();await reviewed(store,c);const backup={backupVersion:1,exportedAt:c.now(),state:store.data().value},text=JSON.stringify(backup),recovered=recoverMailExport(text);
 assert.equal(recovered.enabled,false);assert.equal(recovered.newInstanceRequired,true);assert.equal(recovered.exportedAt,c.now());assert.equal(recovered.state.active,false);assert.notEqual(recovered.state.epoch,backup.state.epoch);assert.equal(JSON.stringify(backup),text);
 for(const bad of [{...backup,secret:'PRIVATE'},{...backup,backupVersion:2},{...backup,exportedAt:backup.exportedAt-1}])assert.throws(()=>recoverMailExport(JSON.stringify(bad)));assert.throws(()=>recoverMailExport('x'.repeat(66001)));
 assert.throws(()=>mailConfiguration({...env,OBSERVER_MAIL_CONTROL_SECRET:undefined},monitorConfig));assert.throws(()=>mailConfiguration({...env,OBSERVER_MAIL_CONTROL_SECRET:env.CRON_SECRET},monitorConfig));
});

test('recovery does not notify an outage whose dispatch was explicitly prevented before POST',async()=>{
 const store=memory(),source=memory(),c=clock();await reviewed(store,c);await outage(source,c);let sends=0;
 await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:async()=>({status:'not-dispatched',code:'unconfirmed'})});assert.equal(store.data().value.items.at(-1).mayHaveSent,false);
 for(let i=0;i<2;i++){c.advance();await observe(source,c)}
 await mailTick(store,source,cfg,monitorConfig,{now:c.now,send:async()=>{sends++;return {status:'accepted',providerId:randomUUID()}}});assert.equal(sends,0);assert.equal(store.data().value.items.filter(r=>r.kind==='recovered').length,0);
});

test('private mail reader uses its existing read key only at a fixed GET path and bounds TLS, DNS, redirects and payloads',async()=>{
 const {readMailReport}=await import('../lib/mail-reader.mjs');const {privateObserverRead}=await import('../lib/private-reader.mjs');const readSecret='PRIVATE_READER_ISOLATED_ONLY_'.repeat(2),reader={url:'https://observer.example',readSecret};let calls=0;
 const request=({code=200,tls=true,payload=JSON.stringify(mailReport(null,null)),stall=false}={})=>(url,opts,done)=>{calls++;assert.equal(url.href,'https://observer.example/api/mail-report');assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,'Bearer '+readSecret);assert.equal(opts.rejectUnauthorized,true);opts.lookup('wrong.example',{},(_err,ip)=>assert.equal(ip,'8.8.8.8'));const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=code;res.headers={'content-type':'application/json',location:'https://127.0.0.1'};res.socket={authorized:tls};done(res);if(!stall)res.end(payload)});return req};
 const options={resolve:publicDNS,request:request()};assert.equal((await readMailReport(reader,options)).report.status,'not-configured');
 await assert.rejects(privateObserverRead(reader,'/api/check',options));await assert.rejects(privateObserverRead(reader,'/api/mail',options));assert.equal(calls,1);
 await assert.rejects(readMailReport(reader,{...options,resolve:async()=>[{family:4,address:'127.0.0.1'}]}));assert.equal(calls,1);
 for(const spec of [{code:302},{tls:false},{payload:JSON.stringify({...mailReport(null,null),readSecret})},{payload:'x'.repeat(32769)}])await assert.rejects(readMailReport(reader,{...options,request:request(spec)}),/valid private mail metadata/);
 await assert.rejects(readMailReport(reader,{...options,timeoutMs:15,request:request({stall:true})}));const old=calls;await assert.rejects(readMailReport(reader,{...options,timeoutMs:15,resolve:()=>new Promise(()=>{})}));assert.equal(calls,old);
 const controller=new AbortController();controller.abort();let dns=0;await assert.rejects(readMailReport(reader,{...options,signal:controller.signal,resolve:async()=>{dns++;return publicDNS()}}));assert.equal(dns,0);assert.equal(calls,old);
});
