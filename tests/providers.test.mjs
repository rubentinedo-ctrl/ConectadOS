import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {providerJSON} from '../lib/server/provider-http.mjs';import {collectVercel,listVercelTeams} from '../lib/server/vercel.mjs';import {collectCloudflare} from '../lib/server/cloudflare.mjs';import {Store,AppError} from '../lib/server/store.mjs';import {refreshProvider} from '../lib/server/provider-collector.mjs';
const id=value=>value.toString(16).padStart(32,'0');
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('provider transport restricts origins, GET, secret propagation, redirects and bounded errors',async()=>{
 let requests=0;
 await assert.rejects(providerJSON('Unknown','/path','TEST',{fetcher:()=>requests++}));await assert.rejects(providerJSON('Vercel','//outside.example/path','TEST',{fetcher:()=>requests++}));assert.equal(requests,0);
 assert.deepEqual(await providerJSON('Vercel','/v2/teams','TEST-TOKEN',{fetcher:async(url,options)=>{assert.equal(url.origin,'https://api.vercel.com');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer TEST-TOKEN');assert.ok(options.signal instanceof AbortSignal);return json({teams:[]})}}),{teams:[]});
 for(const status of [401,403,429,500])await assert.rejects(providerJSON('Cloudflare','/client/v4/zones','TEST',{fetcher:async()=>new Response('sensitive-provider-body',{status})}),e=>!e.message.includes('sensitive-provider-body'));
 await assert.rejects(providerJSON('Vercel','/path','TEST',{fetcher:async()=>new Response('invalid',{headers:{'Content-Type':'application/json'}})}),/JSON/);
 await assert.rejects(providerJSON('Vercel','/path','TEST',{fetcher:async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'Content-Type':'application/json'}})}),/excede/);
 await assert.rejects(providerJSON('Vercel','/path','TEST',{fetcher:async()=>{throw new Error('secret-transport-details')}}),e=>!e.message.includes('secret-transport-details'));
});
test('Vercel follows pagination in one scope and keeps current production metadata without env secrets',async()=>{
 let calls=0;const get=async(provider,url)=>{assert.equal(provider,'Vercel');assert.match(url,/teamId=team_test/);calls++;return {projects:[{id:'p'+calls,name:'Project '+calls,env:[{value:'DO-NOT-COPY'}],targets:{production:{id:'d'+calls,readyState:'READY',alias:['app'+calls+'.example.com','https://unsafe.example'],createdAt:100}},latestDeployments:[{readyState:'ERROR'}]}],pagination:{next:calls===1?50:null}}};
 const snapshot=await collectVercel('TEST-TOKEN','team_test',{get});assert.equal(calls,2);assert.equal(snapshot.resources.length,2);assert.equal(snapshot.resources[0].status,'deployment:READY');assert.deepEqual(snapshot.resources[0].domains,['app1.example.com']);assert.equal(JSON.stringify(snapshot).includes('DO-NOT-COPY'),false);
 await assert.rejects(collectVercel('TEST','team_test',{get:async()=>({projects:[{id:'same'}],pagination:{next:1}})}),/repetidos|paginación/);
 assert.deepEqual(await listVercelTeams('TEST',{get:async()=>({teams:[{id:'team_demo',name:'Demo'}],pagination:{next:null}})}),[{id:'team_demo',name:'Demo'}]);
});
test('Cloudflare reads every zone and DNS page, retaining destinations but excluding TXT and verification secrets',async()=>{
 let dnsPages=0;const get=async(provider,url)=>{assert.equal(provider,'Cloudflare');const u=new URL(url,'https://api.cloudflare.com');const page=Number(u.searchParams.get('page'));if(!u.pathname.endsWith('/dns_records')){assert.equal(u.searchParams.get('per_page'),'50');return {success:true,result:[{id:id(1),name:'example.com',status:'active',verification_key:'MUST-NOT-COPY'}],result_info:{page:1,total_pages:1}}}
 dnsPages++;return {success:true,result:page===1?[{id:id(2),name:'app.example.com',type:'A',content:'192.0.2.1',proxied:true,ttl:1}]:[{id:id(3),name:'_verify.example.com',type:'TXT',content:'MUST-NOT-COPY'}],result_info:{page,total_pages:2}}};
 const snapshot=await collectCloudflare('TEST-TOKEN','all',{get});assert.equal(dnsPages,2);assert.equal(snapshot.resources.length,1);assert.equal(snapshot.records.length,2);assert.equal(snapshot.records[0].value,'192.0.2.1');assert.equal(snapshot.records[1].value,null);assert.equal(snapshot.records[1].valueRedacted,true);assert.equal(JSON.stringify(snapshot).includes('MUST-NOT-COPY'),false);
 await assert.rejects(collectCloudflare('TEST','all',{get:async()=>({success:true,result:[{id:'unsafe/path',name:'example.com'}],result_info:{page:1,total_pages:1}})}),/identificadores/);
 await assert.rejects(collectCloudflare('TEST','all',{get:async()=>({success:true,result:[],result_info:{page:1,total_pages:101}})}),/paginación/);
});
test('provider snapshot retains last evidence on permissions error, deduplicates work and isolates changed scopes and tokens',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-provider-'));const db=new Store(root);try{
 db.configureProvider('Vercel','team_demo','TEST-OLD-TOKEN');const snapshot={resources:[],source:'https://api.vercel.com',checkedAt:Date.now(),coverage:'test'};await refreshProvider(db,'Vercel',{collect:async()=>snapshot});
 let calls=0;await refreshProvider(db,'Vercel',{collect:async()=>{calls++;return snapshot}});assert.equal(calls,0);
 await assert.rejects(refreshProvider(db,'Vercel',{force:true,collect:async()=>{throw new AppError('Faltan permisos.',502)}}));assert.deepEqual(db.providerConnections()[0].snapshot,snapshot);assert.equal(db.providerConnections()[0].error,'Faltan permisos.');
 await assert.rejects(refreshProvider(db,'Vercel',{force:true,collect:async()=>{db.configureProvider('Vercel','team_other','TEST-NEW-TOKEN');return snapshot}}),/cambió/);assert.equal(db.providerConnections()[0].snapshot,null);assert.equal(db.providerConnections()[0].error,null);
 const lease=db.acquireProvider('Vercel');assert.ok(lease);assert.deepEqual(await refreshProvider(db,'Vercel',{force:true,collect:async()=>snapshot}),{busy:true});db.releaseProvider('Vercel',lease);
 db.deleteCredential('Vercel');assert.equal(db.providerConnections()[0].hasToken,false);assert.equal(JSON.stringify(db.providerConnections()).includes('TEST-NEW-TOKEN'),false);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
test('changed scope is collected immediately and a corrupt credential does not disable other providers',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-isolation-'));const db=new Store(root);const snapshot={resources:[],source:'https://api.vercel.com',checkedAt:Date.now(),coverage:'test'};
 try{
  db.configureProvider('Vercel','team_first','TEST-VERCEL-TOKEN');await refreshProvider(db,'Vercel',{collect:async()=>snapshot});
  db.configureProvider('Vercel','team_second');assert.equal(db.providerConnections()[0].attempted,null);
  let calls=0;await refreshProvider(db,'Vercel',{collect:async()=>{calls++;return snapshot}});assert.equal(calls,1);
  db.configureProvider('Cloudflare','all','TEST-CLOUDFLARE-TOKEN');
  db.db.prepare('UPDATE credentials SET sealed=? WHERE provider=?').run('invalid','Vercel');
  assert.equal(db.providerConnections().length,2);
  await assert.rejects(refreshProvider(db,'Vercel',{force:true}),e=>e.message==='No se pudo consultar Vercel.');
  assert.deepEqual(await refreshProvider(db,'Cloudflare',{collect:async()=>({...snapshot,source:'https://api.cloudflare.com'})}),{updated:true});
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM provider_collection_lease').get().n,0);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
test('Supabase lists Cloud projects without database host, project keys or personal fields',async()=>{
 const {collectSupabase}=await import('../lib/server/supabase.mjs');
 const snapshot=await collectSupabase('TEST-TOKEN','all',{get:async(provider,url)=>{assert.equal(provider,'Supabase');assert.equal(url,'/v1/projects');return [{id:'a'.repeat(20),name:'Example',status:'ACTIVE_HEALTHY',region:'us-east-1',organization_id:'org-test',database:{host:'SECRET-HOST',version:'17.6',password:'DO-NOT-COPY'},api_key:'DO-NOT-COPY'}]}});
 assert.equal(snapshot.resources.length,1);assert.equal(snapshot.resources[0].databaseVersion,'17.6');assert.equal(snapshot.resources[0].status,'project:ACTIVE_HEALTHY');assert.equal(JSON.stringify(snapshot).includes('DO-NOT-COPY'),false);assert.equal(JSON.stringify(snapshot).includes('SECRET-HOST'),false);
 await assert.rejects(collectSupabase('TEST-TOKEN','other',{get:()=>{throw new Error('must not call')}}),/all/);
 await assert.rejects(collectSupabase('TEST-TOKEN','all',{get:async()=>[{id:'a'.repeat(20)},{id:'a'.repeat(20)}]}),/repetidos/);
});
test('Hostinger binds metrics to one VPS, retains provider units and drops unrelated sensitive fields',async()=>{
 const {collectHostinger,listHostingerServers}=await import('../lib/server/hostinger.mjs');const now=1791736800000,second=String(now/1000-60);const paths=[];
 const snapshot=await collectHostinger('TEST-TOKEN','123',{now:()=>now,get:async(provider,path)=>{assert.equal(provider,'Hostinger');paths.push(path);return path==='/api/vps/v1/virtual-machines'?[{id:123,hostname:'vps.example.com'},{id:456,hostname:'Other VPS'}]:path.includes('/metrics?')?{cpu_usage:{unit:'%',usage:{[second]:18}},ram_usage:{unit:'bytes',usage:{[second]:1024}},unrelated:{password:'MUST-NOT-COPY'}}:{id:123,hostname:'vps.example.com',plan:'KVM 4',state:'running',cpus:4,memory:16384,disk:204800,template:{name:'Ubuntu 24.04',script:'MUST-NOT-COPY'},ipv4:[{address:'192.0.2.1'}],root_password:'MUST-NOT-COPY',subscription_id:'MUST-NOT-COPY'}}});
 assert.equal(snapshot.resources[0].id,'123');assert.equal(snapshot.resources[0].cpuCount,4);assert.equal(snapshot.metrics[1].unit,'bytes');assert.equal(snapshot.metrics[0].points[0].at,now-60000);assert.equal(JSON.stringify(snapshot).includes('MUST-NOT-COPY'),false);assert.equal(paths.length,3);assert.equal(snapshot.accountServers.length,2);assert.equal(snapshot.resources[0].osTemplate,'Ubuntu 24.04');assert.ok(paths.every(p=>p.includes('/virtual-machines')));
 assert.deepEqual(await listHostingerServers('TEST',{get:async()=>[{id:123,hostname:'Example'}]}),[{id:'123',name:'Example'}]);
 await assert.rejects(collectHostinger('TEST','../123'),/identificador/);
 await assert.rejects(collectHostinger('TEST','123',{now:()=>now,get:async(_p,path)=>path.includes('/metrics?')?{}:{id:456}}),/distinto/);
 await assert.rejects(collectHostinger('TEST','123',{now:()=>now,get:async(_p,path)=>path.includes('/metrics?')?{cpu_usage:{unit:'%',usage:{[second]:'invalid'}}}:{id:123}}),/muestras/);
});
