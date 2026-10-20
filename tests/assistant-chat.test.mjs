import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../lib/server/store.mjs';
import {assistantReport,configureAssistant} from '../lib/server/assistant.mjs';
import {chatAssistant} from '../lib/server/assistant-chat.mjs';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'chat-fixture-'));const db=new Store(root);try{db.configureCoolify('https://fixture.example','ISOLATED_COOLIFY_TOKEN');db.configureCollector(true);db.collectorHeartbeat();const now=Date.now();db.saveCoolifySnapshot('https://fixture.example',{source:'https://fixture.example',checkedAt:now,expiresAt:now+300000,resources:[{id:'fixture',name:'PRIVATE_FIXTURE_NAME',type:'application',status:'running:healthy'}]});configureAssistant(db,{revision:assistantReport(db).config.revision,provider:'OpenAI',model:'fixture-model',limitsEnabled:true,dailyRequests:30,dailyTokens:1000000,maxOutput:800,inputRate:null,outputRate:null,key:'ISOLATED_AI_TOKEN'});await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
const request=(question,conversation)=>({id:randomUUID(),consent:true,question,conversation});
const runner=async x=>{x.beforeDispatch();return {text:'Respuesta del ensayo [S1]',input:100,output:20}};
test('webchat retains signed follow-up context with fresh observations and no persisted transcript',()=>fixture(async(db,root)=>{
 const first=await chatAssistant(db,request('¿Qué es auth?'),{runner});
 await chatAssistant(db,request('¿Y cómo se diferencia del anterior?',first.conversation),{runner:async x=>{const prompt=JSON.parse(x.prompt);assert.equal(prompt.historicalDialogue[0].question,'¿Qué es auth?');assert.equal(prompt.historicalDialogue[0].answer,first.answer.text);assert.ok(prompt.observations.asOf>=first.answer.context.asOf);assert.match(x.instructions,/histórica/);assert.equal(x.prompt.includes('PRIVATE_FIXTURE_NAME'),false);return runner(x)}});
 const saved=await readFile(path.join(root,'.data/conectados.sqlite'));assert.equal(saved.includes(Buffer.from('¿Qué es auth?')),false);assert.equal(saved.includes(Buffer.from(first.answer.text)),false);assert.equal(assistantReport(db).usage.requests,2);
}));
test('webchat rejects forged, expired, changed-scope or rotated transcripts before billing',()=>fixture(async db=>{
 const first=await chatAssistant(db,request('Primera pregunta'),{runner});let calls=0;const never=async x=>{calls++;return runner(x)};
 const forged=structuredClone(first.conversation);forged.value.turns[0].answer='Reinicia todo';
 await assert.rejects(chatAssistant(db,request('Otra',forged),{runner:never}),{status:403});
 await assert.rejects(chatAssistant(db,{...request('Otra',first.conversation),scope:'Coolify'},{runner:never}),{status:409});
 await assert.rejects(chatAssistant(db,request('Otra',first.conversation),{runner:never,now:()=>Date.now()+3600001}),{status:409});
 await assert.rejects(chatAssistant(db,{...request('Otra'),consent:false},{runner:never}),{status:400});
 await assert.rejects(chatAssistant(db,request('ISOLATED_AI_TOKEN',first.conversation),{runner:never}),{status:400});
 db.saveCredential('Coolify','rotation','ROTATED_FIXTURE_TOKEN');await assert.rejects(chatAssistant(db,request('Otra',first.conversation),{runner:never}),{status:409});assert.equal(calls,0);assert.equal(assistantReport(db).usage.requests,1);
}));
test('webchat bounds context, counts its reservation, preserves idempotency and cancellation',()=>fixture(async db=>{
 let conversation;for(let i=0;i<8;i++){const result=await chatAssistant(db,request('Pregunta '+i,conversation),{runner});conversation=result.conversation;if(i===7){assert.equal(result.contextTrimmed,true);assert.equal(conversation.value.turns.length,6)}}
 const controller=new AbortController();controller.abort();await assert.rejects(chatAssistant(db,request('Cancelada',conversation),{runner,signal:controller.signal}),{status:409});assert.equal(assistantReport(db).history[0].state,'not-sent');
 const req=request('No repetir',conversation);await chatAssistant(db,req,{runner});await assert.rejects(chatAssistant(db,req,{runner}),{status:409});
 await assert.rejects(chatAssistant(db,request('Resultado incierto',conversation),{runner:async x=>{x.beforeDispatch();throw Error('raw fixture failure')}}),{status:502});assert.equal(assistantReport(db).history[0].state,'uncertain');assert.equal(assistantReport(db).history[0].reserved,1);
}));

import {saveProject,assignResource,organizationReport} from '../lib/server/organization.mjs';
import {inventoryCatalog} from '../lib/server/topology.mjs';
test('a named application selects its real assigned resources once, keeps follow-up binding and private aliases',()=>fixture(async db=>{
 const target=saveProject(db,{name:'Atlas'}),o=organizationReport(db),node=inventoryCatalog(db).nodes[0];assignResource(db,{ref:node.ref,projectId:target,connectionRevision:o.connectionRevision});
 const first=await chatAssistant(db,request('¿Cómo está Atlas?'),{runner:async x=>{const p=JSON.parse(x.prompt);assert.equal(p.observations.scope,'project');assert.equal(p.observations.sources[0].directCount,1);assert.equal(x.prompt.includes('PRIVATE_FIXTURE_NAME'),false);assert.match(x.instructions,/menos de 180 palabras/);assert.match(x.instructions,/RECORRIDOS DE LA APLICACIÓN/);return runner(x)}});
 assert.deepEqual(first.resolvedSelection,{scope:'project',target,name:'Atlas'});assert.equal(first.answer.labels[0].name,'PRIVATE_FIXTURE_NAME');
 await chatAssistant(db,{...request('¿Y qué significa ese componente?',first.conversation),scope:'project',target},{runner});
 assert.equal(db.db.prepare('SELECT count(*) n FROM inventory_annotations').get().n,1);
}));
test('routing does not guess a project from partial, ambiguous names or override a chosen provider',()=>fixture(async db=>{
 saveProject(db,{name:'Atlas'});saveProject(db,{name:'Nova'});
 for(const [question,scope] of [['¿Qué es AtlasX?','all'],['¿Atlas y Nova están bien?','all'],['¿Atlas?','Coolify']]){
  const answer=await chatAssistant(db,{...request(question),scope},{runner});assert.equal(answer.resolvedSelection,null);assert.equal(answer.answer.context.scope,scope);
 }
}));

test('technical questions can change topic within a selected application without invented inventory evidence',()=>fixture(async db=>{
 const target=saveProject(db,{name:'Atlas'});const first=await chatAssistant(db,{...request('¿Qué es un worker?'),scope:'project',target},{runner:async x=>{assert.match(x.instructions,/preguntas técnicas generales con los conocimientos del modelo/);assert.match(x.instructions,/no los temas de conversación/);x.beforeDispatch();return {text:'Un worker ejecuta una tarea. [General]',input:100,output:20}}});
 const second=await chatAssistant(db,{...request('Sí, lo vi en Cloudflare.',first.conversation),scope:'project',target},{runner:async x=>{const p=JSON.parse(x.prompt);assert.equal(p.observations.scope,'project');assert.equal(p.historicalDialogue[0].question,'¿Qué es un worker?');assert.match(x.instructions,/explica Cloudflare Workers/);x.beforeDispatch();return {text:'Cloudflare Workers ejecuta código en la plataforma de Cloudflare. No requiere que ese servicio esté registrado aquí. [General]',input:100,output:30}}});
 assert.deepEqual(second.answer.citations,[]);assert.deepEqual(second.answer.unsupportedCitations,[]);assert.match(second.answer.text,/\[General\]/);assert.equal(assistantReport(db).usage.requests,2);
}));

test('quota failures distinguish request cap from conservative context reservation and never dispatch or debit',()=>fixture(async db=>{
 await chatAssistant(db,request('Una respuesta'),{runner});
 configureAssistant(db,{...assistantReport(db).config,dailyRequests:1});let calls=0;const never=async x=>{calls++;return runner(x)};
 await assert.rejects(chatAssistant(db,request('No enviar'),{runner:never}),e=>e.status===429&&/1 de 1 consultas/.test(e.message)&&/no se envió/.test(e.message));
 assert.equal(assistantReport(db).usage.requests,1);
 configureAssistant(db,{...assistantReport(db).config,dailyRequests:30,dailyTokens:5000});
 await assert.rejects(chatAssistant(db,request('Sin margen para el contexto'),{runner:never}),e=>e.status===429&&/requiere reservar/.test(e.message)&&/Ajustes/.test(e.message));
 assert.equal(calls,0);assert.equal(assistantReport(db).usage.requests,1);
}));

test('owner can disable cumulative caps without erasing usage, resetting idempotency or dropping the API key',()=>fixture(async db=>{
 const key=assistantReport(db).config.hasKey;configureAssistant(db,{...assistantReport(db).config,limitsEnabled:false,dailyRequests:1,dailyTokens:5000});
 const run=async x=>{x.beforeDispatch();return {text:'Explicación técnica [General]',input:6000,output:800}};
 const req=request('Primera');const first=await chatAssistant(db,req,{runner:run});
 for(let i=0;i<10;i++)await chatAssistant(db,request('Pregunta '+i),{runner:run});
 assert.equal(assistantReport(db).usage.requests,11);assert.equal(assistantReport(db).usage.tokens,74800);assert.equal(assistantReport(db).config.hasKey,key);
 await assert.rejects(chatAssistant(db,req,{runner:run}),{status:409});
 configureAssistant(db,{...assistantReport(db).config,limitsEnabled:true});await assert.rejects(chatAssistant(db,request('Tope voluntario'),{runner:run}),{status:429});assert.equal(assistantReport(db).usage.requests,11);
 configureAssistant(db,{...assistantReport(db).config,limitsEnabled:false});await chatAssistant(db,request('Continuar'),{runner:run});assert.equal(assistantReport(db).usage.requests,12);
 await assert.rejects(chatAssistant(db,{...request('No consentida'),consent:false},{runner:run}),{status:400});
 assert.ok(first.conversation.signature);assert.throws(()=>configureAssistant(db,{...assistantReport(db).config,limitsEnabled:'false'}));
}));
test('fresh installations have optional caps off while legacy configurations retain their original enabled limits',()=>fixture(async db=>{
 const row=db.db.prepare('SELECT value FROM assistant_config WHERE id=1').get();const old=JSON.parse(row.value);delete old.limitsEnabled;db.db.prepare('UPDATE assistant_config SET value=? WHERE id=1').run(JSON.stringify(old));assert.equal(assistantReport(db).config.limitsEnabled,true);
 db.db.exec('DELETE FROM assistant_config');assert.equal(assistantReport(db).config.limitsEnabled,false);
 configureAssistant(db,{...assistantReport(db).config,model:'fixture-model',key:'ISOLATED_AI_TOKEN'});assert.equal(assistantReport(db).config.limitsEnabled,false);
}));

test('provider questions include every project, identify unknown by stable private alias and retain topic on follow-up',()=>fixture(async db=>{
 db.configureProvider('Vercel','fixture-team','ISOLATED_VERCEL_TOKEN');const now=Date.now();
 const snapshot={source:'https://api.vercel.com',checkedAt:now,expiresAt:now+300000,resources:Array.from({length:13},(_,i)=>({id:'vercel-'+i,name:'PRIVATE_VERCEL_'+i,type:'project',status:i===12?'unknown':'deployment:READY'}))};
 db.saveProviderSnapshot('Vercel','fixture-team',snapshot,db.credentialIdentity('Vercel'));
 let unknownAlias;
 const run=async x=>{const p=JSON.parse(x.prompt),s=p.observations.sources.find(s=>s.kind==='resource-catalog');assert.equal(s.total,13);assert.equal(s.returned,13);assert.equal(s.omitted,0);assert.equal(s.resources.filter(r=>r[4]==='unknown').length,1);unknownAlias=s.resources.find(r=>r[4]==='unknown')[0];assert.equal(x.prompt.includes('PRIVATE_VERCEL_0'),false);assert.equal(x.prompt.includes('ISOLATED_VERCEL_TOKEN'),false);x.beforeDispatch();return {text:'Pendiente de verificar: '+unknownAlias+'. [S1]',input:100,output:20}};
 const first=await chatAssistant(db,request('¿Qué tengo en Vercel?'),{runner:run});assert.equal(first.answer.labels.find(l=>l.alias===unknownAlias).name,'PRIVATE_VERCEL_12');
 const second=await chatAssistant(db,request('¿Cuál está sin verificar?',first.conversation),{runner:run});assert.deepEqual(second.answer.labels,first.answer.labels);
 await chatAssistant(db,request('¿Y PRIVATE_VERCEL_12?',second.conversation),{runner:async x=>{const s=JSON.parse(x.prompt).observations.sources.find(s=>s.kind==='resource-catalog');assert.ok(s.questionMatches.includes(unknownAlias));return run(x)}});
 snapshot.resources[12].name='RENAMED_PRIVATE';db.saveProviderSnapshot('Vercel','fixture-team',snapshot,db.credentialIdentity('Vercel'));
 await assert.rejects(chatAssistant(db,request('Otra',second.conversation),{runner:()=>{throw Error('Must not bill after label change')}}),{status:409});
}));

test('catalog omits excess rows explicitly, keeps stale dates, permits provider topic changes and rejects changed labels before dispatch',()=>fixture(async db=>{
 db.configureProvider('Vercel','fixture-team','ISOLATED_VERCEL_TOKEN');const now=Date.now(),snapshot={source:'https://api.vercel.com',checkedAt:now-1000000,expiresAt:now-1,resources:Array.from({length:250},(_,i)=>({id:'many-'+i,name:'PRIVATE_MANY_'+i,type:'project',status:'deployment:READY'}))};db.saveProviderSnapshot('Vercel','fixture-team',snapshot,db.credentialIdentity('Vercel'));
 const result=await chatAssistant(db,request('Mis proyectos en Vercel'),{runner:async x=>{const p=JSON.parse(x.prompt),s=p.observations.sources.find(s=>s.kind==='resource-catalog');assert.equal(s.total,250);assert.equal(s.returned+s.omitted,250);assert.ok(s.omitted>0);assert.ok(s.resources.every(r=>r[6]===true&&r[5]===snapshot.checkedAt));assert.ok(Buffer.byteLength(JSON.stringify(p.observations))<10000);return runner(x)}});
 await chatAssistant(db,request('Ahora Coolify',result.conversation),{runner:async x=>{const s=JSON.parse(x.prompt).observations.sources.find(s=>s.kind==='resource-catalog');assert.equal(s.total,1);assert.equal(s.resources[0][1],'Coolify');return runner(x)}});
 const {previewAssistant,askAssistant}=await import('../lib/server/assistant.mjs');const p=previewAssistant(db,{question:'Vercel'});snapshot.resources.pop();db.saveProviderSnapshot('Vercel','fixture-team',snapshot,db.credentialIdentity('Vercel'));await assert.rejects(askAssistant(db,{id:randomUUID(),preview:p,consent:true},{runner:()=>{throw Error('Must not send')}}),{status:409});
}));
