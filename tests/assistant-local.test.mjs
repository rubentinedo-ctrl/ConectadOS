import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {Store} from '../lib/server/store.mjs';
import {configureAssistant,assistantReport,assistantKey,previewAssistant,askAssistant} from '../lib/server/assistant.mjs';
import {localAssistantRuntime,localModelName,dockerLocalAddress,localAssistantJSON,listLocalAssistantModels,generateLocalAssistant} from '../lib/server/assistant-local.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';
import {saveConfig} from '../scripts/config.mjs';

const runtime=localAssistantRuntime({CONECTADOS_LOCAL_AI:'loopback'});
const row={name:'fixture:local',digest:'a'.repeat(64),size:1024,details:{format:'gguf'}};
const info={details:{format:'gguf'},capabilities:['completion'],model_info:{'general.architecture':'fixture','fixture.context_length':32768}};
const answer={model:row.name,done:true,message:{role:'assistant',content:'Observación de ensayo [S1].'},prompt_eval_count:80,eval_count:12};
function fixtureRequest(overrides={},calls=[]){return async(p,o)=>{calls.push({path:p,options:o});return Object.hasOwn(overrides,p)?overrides[p]:p==='/api/status'?{cloud:{disabled:true}}:p==='/api/tags'?{models:[row]}:p==='/api/show'?info:answer}}
const args=()=>({model:row.name,instructions:'Only fixture instructions.',prompt:'Only anonymous fixture observations.',maxOutput:128,signal:AbortSignal.timeout(2000),runtimeBinding:runtime.binding,beforeDispatch:()=>{}});
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-local-ai-'));const db=new Store(root);const previous=process.env.CONECTADOS_LOCAL_AI;process.env.CONECTADOS_LOCAL_AI='loopback';try{await fn(db,root)}finally{if(previous===undefined)delete process.env.CONECTADOS_LOCAL_AI;else process.env.CONECTADOS_LOCAL_AI=previous;db.close();await rm(root,{recursive:true,force:true})}}
function configure(db,options={}){return configureAssistant(db,{revision:assistantReport(db).config.revision,provider:'Ollama',model:row.name,limitsEnabled:true,dailyRequests:10,dailyTokens:50000,maxOutput:128,inputRate:null,outputRate:null,...options})}
const ask=db=>({id:randomUUID(),consent:true,preview:previewAssistant(db,{question:'¿Qué muestran las fuentes?'})});

test('local destination is disabled by default and accepts only operator modes; model names exclude paths, URLs and cloud',()=>{
 assert.equal(localAssistantRuntime({}).enabled,false);
 for(const value of ['http://169.254.169.254','http://example.com','loopback ','constructor','toString'])assert.equal(localAssistantRuntime({CONECTADOS_LOCAL_AI:value}).enabled,false);
 assert.equal(runtime.enabled,true);assert.notEqual(runtime.binding,localAssistantRuntime({CONECTADOS_LOCAL_AI:'docker'}).binding);
 for(const model of ['../file','https://host/model','model:cloud','model-cloud:latest','name/a/b','model with space','model\n'])assert.equal(localModelName(model),false);
 assert.equal(localModelName('namespace/model:Q4_K_M'),true);
 for(const ip of ['127.0.0.1','169.254.169.254','8.8.8.8','0.0.0.0','172.32.0.1','::1','10.bad.0.1'])assert.equal(dockerLocalAddress(ip),false);
 for(const ip of ['10.0.0.2','172.18.0.2','192.168.1.2'])assert.equal(dockerLocalAddress(ip),true);
});
test('catalog verifies cloud disabled and exposes only bounded local downloaded models, no arbitrary metadata',async()=>{
 const remote={...row,name:'remote:latest',remote_host:'https://private-secret.example'};
 const catalog=await listLocalAssistantModels({runtime,request:fixtureRequest({'/api/tags':{models:[row,row,remote,{...row,name:'fixture:cloud'},{...row,name:'embedding:latest',details:{format:'other'}},{...row,name:'bad',digest:'bad'}]}})});
 assert.deepEqual(catalog.models,[row.name]);assert.equal(JSON.stringify(catalog).includes('private-secret'),false);
 for(const status of [{cloud:{disabled:false}},{},null])await assert.rejects(listLocalAssistantModels({runtime,request:fixtureRequest({'/api/status':status})}));
 await assert.rejects(listLocalAssistantModels({runtime:localAssistantRuntime({}),request:()=>{throw new Error('must not connect')}}),{status:409});
 await assert.rejects(listLocalAssistantModels({runtime,request:fixtureRequest({'/api/tags':{models:Array(2001).fill(row)}})}),{status:502});
});
test('local chat reviews metadata before dispatch, has no key/tools/pull or retries and bounds runtime resources',async()=>{
 const calls=[];let dispatch=0;const result=await generateLocalAssistant({...args(),beforeDispatch:()=>dispatch++},{runtime,request:fixtureRequest({},calls)});
 assert.equal(dispatch,1);assert.equal(result.text,answer.message.content);assert.equal(result.input,80);assert.equal(result.output,12);
 assert.deepEqual(calls.map(x=>x.path),['/api/status','/api/tags','/api/show','/api/chat']);
 const body=calls[3].options.body;assert.equal(body.stream,false);assert.equal(body.think,false);assert.equal(body.keep_alive,0);assert.equal(body.options.num_predict,128);assert.equal(body.options.num_thread,2);assert.equal(body.tools,undefined);assert.equal(body.key,undefined);assert.deepEqual(body.messages.map(x=>x.role),['system','user']);
});
test('unverified local inference, remote models, incompatible context and changed destination never dispatch prompt',async()=>{
 for(const override of [{'/api/status':{cloud:{disabled:false}}},{'/api/tags':{models:[]}},{'/api/show':{...info,remote_model:'remote'}},{'/api/show':{...info,capabilities:['embedding']}},{'/api/show':{...info,model_info:{'general.architecture':'fixture','fixture.context_length':10}}}]){
  const calls=[];let dispatch=0;await assert.rejects(generateLocalAssistant({...args(),beforeDispatch:()=>dispatch++},{runtime,request:fixtureRequest(override,calls)}));assert.equal(dispatch,0);assert.equal(calls.some(x=>x.path==='/api/chat'),false);
 }
 let calls=0;await assert.rejects(generateLocalAssistant({...args(),runtimeBinding:'changed'},{runtime,request:()=>calls++}),{status:409});assert.equal(calls,0);
});
test('incomplete, remote, tool, wrong-model and oversized outputs are rejected; unknown usage remains unknown',async()=>{
 for(const bad of [{...answer,done:false},{...answer,remote_host:'https://example.com'},{...answer,model:'other:local'},{...answer,message:{...answer.message,tool_calls:[{}]}},{...answer,message:{role:'assistant',content:'x'.repeat(32001)}},{...answer,eval_count:129}])await assert.rejects(generateLocalAssistant(args(),{runtime,request:fixtureRequest({'/api/chat':bad})}),{status:502});
 const unknown=await generateLocalAssistant(args(),{runtime,request:fixtureRequest({'/api/chat':{...answer,prompt_eval_count:undefined,eval_count:undefined}})});assert.equal(unknown.input,undefined);assert.equal(unknown.output,undefined);
 const limited=await generateLocalAssistant(args(),{runtime,request:fixtureRequest({'/api/chat':{...answer,eval_count:128,done_reason:'length'}})});assert.equal(limited.outputLimited,true);
});
test('local configuration removes cloud key, needs no API key, prices or external permission, and conserves shared quota',async()=>sandbox(async db=>{
 configureAssistant(db,{revision:'initial',provider:'OpenAI',model:'fixture',dailyRequests:10,dailyTokens:50000,maxOutput:128,inputRate:null,outputRate:null,key:'ISOLATED_CLOUD_KEY_ONLY'});
 const result=configure(db);assert.equal(assistantKey(db),null);assert.equal(result.config.hasKey,false);assert.equal(result.config.ready,true);
 assert.throws(()=>configure(db,{key:'DO_NOT_SEND_LOCAL_KEY'}),{status:400});assert.throws(()=>configure(db,{inputRate:1,outputRate:2}),{status:400});
 const request=ask(db);await assert.rejects(askAssistant(db,{...request,consent:false},{runner:()=>{throw new Error('not dispatched')}}),{status:400});
 const got=await askAssistant(db,request,{runner:options=>generateLocalAssistant(options,{runtime,request:fixtureRequest()})});assert.equal(got.provider,'Ollama');assert.equal(got.usage.estimated,null);assert.equal(assistantReport(db).usage.requests,1);
 await assert.rejects(askAssistant(db,{...request,id:randomUUID()},{runner:()=>{throw new Error('no duplicate')}}),{status:409});
 configure(db,{dailyRequests:1});await assert.rejects(askAssistant(db,ask(db),{runner:()=>{throw new Error('quota')}}),{status:429});
}));
test('runtime change and revoked access invalidate local consent; abort after dispatch remains uncertain',async()=>sandbox(async db=>{
 configure(db);const req=ask(db);process.env.CONECTADOS_LOCAL_AI='docker';await assert.rejects(askAssistant(db,req,{runner:()=>{throw new Error('not allowed')}}),{status:409});process.env.CONECTADOS_LOCAL_AI='loopback';
 await assert.rejects(askAssistant(db,req,{authorized:()=>false}),{status:401});let calls=0;
 await assert.rejects(askAssistant(db,req,{runner:async options=>{options.beforeDispatch();calls++;throw new Error('ISOLATED_RAW_SECRET')}}),e=>e.status===502&&!e.message.includes('ISOLATED_RAW_SECRET'));
 assert.equal(calls,1);assert.equal(assistantReport(db).history[0].state,'uncertain');assert.equal(assistantReport(db).history[0].reserved,1);
 delete process.env.CONECTADOS_LOCAL_AI;assert.equal(assistantReport(db).config.ready,false);assert.throws(()=>ask(db),{status:409});
}));
test('restored local configuration preserves usage without embedding activation or prompt; no session survives',async()=>sandbox(async(db,root)=>{
 configure(db);await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:4200,mode:'demo'});await askAssistant(db,ask(db),{runner:options=>generateLocalAssistant(options,{runtime,request:fixtureRequest()})});db.session();const copy=path.join(root,'copy'),target=path.join(root,'restore');await snapshot(root,copy);await restoreToNewDirectory(copy,target,path.join(root,'.keys/vault.key'));
 delete process.env.CONECTADOS_LOCAL_AI;const recovered=new Store(target);try{const report=assistantReport(recovered);assert.equal(report.config.provider,'Ollama');assert.equal(report.config.ready,false);assert.equal(report.usage.requests,1);assert.equal(recovered.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(JSON.stringify(recovered.db.prepare('SELECT * FROM assistant_usage').all()).includes('¿Qué muestran'),false)}finally{recovered.close()}
}));
test('Docker DNS is pinned and rejects mixed/public/metadata resolution before creating a socket',async()=>{
 const docker=localAssistantRuntime({CONECTADOS_LOCAL_AI:'docker'});
 for(const rows of [[],[{family:4,address:'169.254.169.254'}],[{family:4,address:'10.0.0.2'},{family:4,address:'8.8.8.8'}]])await assert.rejects(localAssistantJSON('/api/status',{runtime:docker,resolve:async()=>rows}),{status:403});
 await assert.rejects(localAssistantJSON('/api/pull',{runtime,body:{model:'fixture'}}),{status:403});
 await assert.rejects(localAssistantJSON('/api/chat',{runtime,method:'GET'}),{status:403});
 const controller=new AbortController();const waiting=localAssistantJSON('/api/status',{runtime:docker,resolve:()=>new Promise(()=>{}),signal:controller.signal});controller.abort();await assert.rejects(waiting,{status:409});
});
test('native transport sends only fixed requests and bounds malformed, redirect, oversized and interrupted responses',async()=>{
 const server=createServer((req,res)=>{
  const mode=server.mode??'ok';assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.host,'127.0.0.1:11434');assert.equal(req.url,'/api/status');
  res.setHeader('Content-Type','application/json');if(mode==='redirect'){res.writeHead(302,{Location:'http://169.254.169.254'});res.end();return}if(mode==='bad'){res.end('RAW_PRIVATE_SECRET');return}if(mode==='big'){res.end('x'.repeat(524289));return}if(mode==='interrupted'){res.write('{');res.destroy();return}if(mode==='wait'){return}res.end(JSON.stringify({cloud:{disabled:true}}));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const requestFactory=(options,callback)=>{assert.equal(options.port,11434);assert.equal(options.hostname,'127.0.0.1');assert.equal(options.agent,false);return httpRequest({...options,port:server.address().port},callback)};
 try{assert.equal((await localAssistantJSON('/api/status',{runtime,requestFactory,signal:AbortSignal.timeout(1000)})).cloud.disabled,true);for(const mode of ['redirect','bad','big','interrupted','wait']){server.mode=mode;await assert.rejects(localAssistantJSON('/api/status',{runtime,requestFactory,signal:AbortSignal.timeout(mode==='wait'?40:1000)}),e=>!e.message.includes('RAW_PRIVATE_SECRET'))}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

test('native timeout and explicit cancellation retain distinct sanitized errors without another request',async()=>{
 let calls=0;const server=createServer(()=>{calls++});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const requestFactory=(options,callback)=>httpRequest({...options,port:server.address().port},callback);
 try{
  await assert.rejects(localAssistantJSON('/api/status',{runtime,requestFactory,signal:AbortSignal.timeout(40)}),e=>e.status===504&&/tiempo de espera/.test(e.message)&&/no se repetirá/.test(e.message));
  const controller=new AbortController(),received=new Promise(r=>server.once('request',r));
  const pending=localAssistantJSON('/api/status',{runtime,requestFactory,signal:controller.signal});await received;controller.abort(new Error('PRIVATE_CANCEL_REASON'));
  await assert.rejects(pending,e=>e.status===409&&!e.message.includes('PRIVATE_CANCEL_REASON'));assert.equal(calls,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
test('an expired timeout is identified before resolving or opening a local connection',async()=>{
 const controller=new AbortController();controller.abort(new DOMException('PRIVATE_TIMEOUT_REASON','TimeoutError'));let calls=0;
 await assert.rejects(localAssistantJSON('/api/status',{runtime,signal:controller.signal,requestFactory:()=>{calls++;throw Error('must not connect')}}),e=>e.status===504&&!e.message.includes('PRIVATE_TIMEOUT_REASON'));assert.equal(calls,0);
});
