import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {coolifyURL,publicIPv4,collectCoolify,normalizeResources,normalizeServiceComponents} from '../lib/server/coolify.mjs';
import {Store} from '../lib/server/store.mjs';
const publicAddress={address:'93.184.216.34',family:4};
function transport({status=200,body='[]',contentType='application/json',inspect=()=>{},error=false}={}){
 return (url,options,callback)=>{inspect(url,options);const req=new EventEmitter();req.end=()=>{queueMicrotask(()=>{if(error){req.emit('error',new Error('test transport'));return}const res=new PassThrough();res.statusCode=status;res.headers={'content-type':contentType};callback(res);res.end(body)})};return req};
}
test('Coolify blocks private destinations, credentials in URLs, ports and redirects without forwarding secrets',async()=>{
 for(const value of ['http://panel.example','https://localhost','https://127.0.0.1','https://[::1]','https://user:password@panel.example','https://panel.example:8443','https://panel.example/api','https://panel.example?token=secret'])assert.throws(()=>coolifyURL(value));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','::ffff:127.0.0.1'])assert.equal(publicIPv4(address),false);
 let requests=0;const request=transport({inspect:()=>requests++});
 await assert.rejects(collectCoolify('https://panel.example','test-secret',{resolve:async()=>[publicAddress,{address:'127.0.0.1',family:4}],request}));assert.equal(requests,0);
 await assert.rejects(collectCoolify('https://panel.example','test-secret',{resolve:async()=>[publicAddress],request:transport({status:302})}),/redirigió/);
});
test('Coolify pins DNS, uses GET only and persists an allowlist of fields rather than response secrets',async()=>{
 let resolutions=0;const token='FAKE-NOT-A-REAL-TOKEN';
 const snapshot=await collectCoolify('https://panel.example/',token,{resolve:async()=>{resolutions++;return [publicAddress]},request:transport({body:JSON.stringify([{uuid:'app-id',name:'App',type:'application',status:'running',env:{password:'must-not-expose'},private_key:'must-not-expose'},{uuid:'db-id',name:token,type:'database',status:'stopped'}]),inspect:(url,options)=>{assert.equal(url.pathname,'/api/v1/resources');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+token);options.lookup('panel.example',{all:true},(_error,values)=>assert.deepEqual(values,[publicAddress]));assert.ok(options.signal instanceof AbortSignal)}})});
 assert.equal(resolutions,1);assert.equal(snapshot.resources.length,2);assert.equal(snapshot.resources[1].name,'Recurso sin nombre');assert.equal(JSON.stringify(snapshot).includes(token),false);assert.equal(JSON.stringify(snapshot).includes('must-not-expose'),false);
 assert.throws(()=>normalizeResources({data:[]}),/Formato/);assert.throws(()=>normalizeResources([{uuid:'same'},{uuid:'same'}]),/duplicados/);
});
test('Coolify explains permissions, expiry, rate limits, invalid responses and interrupted transport',async()=>{
 for(const [status,pattern] of [[401,/vencido/],[403,/permiso/],[429,/limitó/],[500,/no pudo/]])await assert.rejects(collectCoolify('https://panel.example','test-token',{resolve:async()=>[publicAddress],request:transport({status,body:'secret-provider-body'})}),pattern);
 await assert.rejects(collectCoolify('https://panel.example','test-token',{resolve:async()=>[publicAddress],request:transport({contentType:'text/html'})}),/formato/);
 await assert.rejects(collectCoolify('https://panel.example','test-token',{resolve:async()=>[publicAddress],request:transport({body:'invalid'})}),/JSON/);
 await assert.rejects(collectCoolify('https://panel.example','test-token',{resolve:async()=>[publicAddress],request:transport({error:true})}),/conectar/);
 await assert.rejects(collectCoolify('https://panel.example','test-token',{resolve:async()=>[publicAddress],request:transport({body:'x'.repeat(2*1024*1024+1)})}),/excede/);
});
test('Coolify retains previous readings after failure, preserves encrypted credentials and detects changed instance',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-coolify-'));let db;
 try{db=new Store(root);assert.throws(()=>db.configureCoolify('https://panel.example',''),{status:409});db.configureCoolify('https://panel.example','FAKE-TEST-ONLY');const snapshot={resources:[],checkedAt:Date.now(),source:'https://panel.example',coverage:'test'};db.saveCoolifySnapshot('https://panel.example',snapshot);db.failCoolify('https://panel.example','Test error');assert.deepEqual(db.coolifyConnection().snapshot,snapshot);assert.equal(db.coolifyConnection().error,'Test error');assert.equal(JSON.stringify(db.coolifyConnection()).includes('FAKE-TEST-ONLY'),false);assert.throws(()=>db.configureCoolify('https://other.example',''),{status:409});db.configureCoolify('https://other.example','FAKE-NEW-TOKEN');assert.equal(db.coolifyConnection().snapshot,null);assert.throws(()=>db.saveCoolifySnapshot('https://panel.example',snapshot),{status:409});db.close();db=new Store(root);assert.equal(db.coolifyConnection().url,'https://other.example');assert.equal((await readFile(path.join(root,'.data/conectados.sqlite'))).includes(Buffer.from('FAKE-NEW-TOKEN')),false)}finally{db?.close();await rm(root,{recursive:true,force:true})}
});

function routedTransport(routes,calls=[]){return (url,options,callback)=>{
 calls.push(url.pathname);assert.equal(options.method,'GET');const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const fixture=routes[url.pathname]??{status:404};const res=new PassThrough();res.statusCode=fixture.status??200;res.headers={'content-type':'application/json',...fixture.headers};callback(res);res.end(JSON.stringify(fixture.body??{message:'Never expose provider error or secrets'}))});return req;
}}
const parents=[{uuid:'service-a',name:'Parent A',type:'service',status:'running:healthy'},{uuid:'service-b',name:'Parent B',type:'service',status:'running:healthy'}];
const detail=(id='service-a')=>({uuid:id,applications:[{uuid:'app-component',name:'Gateway',human_name:'Public gateway',status:'running:healthy',image:'supabase/kong:3.0',password:'PRIVATE-FIELD',fqdn:'https://not-requested.example',exclude_from_status:true}],databases:[{uuid:'db-component',name:'Postgres',status:'exited:unhealthy',image:'supabase/postgres:15.8',password:'PRIVATE-FIELD',public_port:5432}],docker_compose_raw:'PRIVATE-FIELD',server:{private_key:'PRIVATE-FIELD'}});
test('Stopped applications get bounded read-only history metadata; secrets, failed reads and old zero counts are not reused',async()=>{
 const app={uuid:'new-app',name:'Created app',type:'application',status:'exited:unhealthy'},calls=[];
 const routes={'/api/v1/resources':{body:[app]},'/api/v1/deployments/applications/new-app':{body:{count:0,deployments:[],secret:'PRIVATE-HISTORY-FIELD'}}};
 const options={resolve:async()=>[publicAddress]},snapshot=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,request:routedTransport(routes,calls)});
 assert.deepEqual(calls,['/api/v1/resources','/api/v1/deployments/applications/new-app']);assert.equal(snapshot.applicationDeployments[0].count,0);assert.ok(snapshot.applicationDeployments[0].source.endsWith('?skip=0&take=1'));assert.equal(JSON.stringify(snapshot).includes('PRIVATE-HISTORY-FIELD'),false);
 for(const body of [{count:0,deployments:[{}]},{count:1,deployments:[]},{count:'0',deployments:[]}]){const broken=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous:snapshot,request:routedTransport({...routes,'/api/v1/deployments/applications/new-app':{body}})});assert.equal(broken.applicationDeployments[0].count,null);assert.ok(broken.applicationDeployments[0].error)}
 const denied=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous:snapshot,request:routedTransport({...routes,'/api/v1/deployments/applications/new-app':{status:403}})});assert.equal(denied.applicationDeployments[0].checkedAt,null);
});
test('A targeted diagnosis refreshes only the selected service and retains unrelated evidence unchanged',async()=>{
 const routes={'/api/v1/resources':{body:parents},'/api/v1/services/service-a':{body:detail()},'/api/v1/services/service-b':{body:detail('service-b')}};
 const options={resolve:async()=>[publicAddress]},previous=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,request:routedTransport(routes)}),calls=[];
 const current=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous,forceDetails:true,detailIds:['service-a'],request:routedTransport(routes,calls)});
 assert.deepEqual(calls,['/api/v1/resources','/api/v1/services/service-a']);assert.deepEqual(current.serviceDetails[1],previous.serviceDetails[1]);
});
test('Coolify service components bind to their parent, distinguish databases and omit compose, secrets and arbitrary image URLs',async()=>{
 const token='FAKE-COMPONENT-TOKEN';const calls=[];const routes={'/api/v1/resources':{body:parents},'/api/v1/services/service-a':{body:detail()},'/api/v1/services/service-b':{status:403}};
 const snapshot=await collectCoolify('https://panel.example',token,{resolve:async()=>[publicAddress],request:routedTransport(routes,calls)});
 assert.equal(snapshot.resources.length,2);assert.equal(snapshot.serviceDetails.length,2);const first=snapshot.serviceDetails[0];assert.equal(first.components[1].type,'database');assert.equal(first.components[1].status,'exited:unhealthy');assert.equal(first.components[0].name,'Public gateway');assert.equal(first.components[0].excludedFromStatus,true);assert.equal(first.source,'https://panel.example/api/v1/services/service-a');assert.ok(first.expiresAt>first.checkedAt);assert.equal(snapshot.serviceDetails[1].checkedAt,null);assert.match(snapshot.serviceDetails[1].error,/permiso/);
 assert.equal(JSON.stringify(snapshot).includes('PRIVATE-FIELD'),false);assert.equal(JSON.stringify(snapshot).includes('not-requested.example'),false);assert.deepEqual(calls.sort(),['/api/v1/resources','/api/v1/services/service-a','/api/v1/services/service-b']);
 assert.throws(()=>normalizeServiceComponents(detail('different'),'service-a'),/otro recurso/);assert.throws(()=>normalizeServiceComponents({...detail(),databases:[detail().applications[0]]},'service-a'),/duplicados/);
 const unsafe=detail();unsafe.databases[0].image='https://user:password@registry.example/image?token=secret';unsafe.applications[0].name=token;unsafe.applications[0].human_name=token;const normalized=normalizeServiceComponents(unsafe,'service-a',token);assert.equal(normalized[1].image,null);assert.equal(normalized[0].name,'Componente sin nombre');
});
test('Coolify component cache keeps original dates, preserves evidence after failure and clears on parent or source changes',async()=>{
 const routes={'/api/v1/resources':{body:parents.slice(0,1)},'/api/v1/services/service-a':{body:detail()}};const options={resolve:async()=>[publicAddress]};const previous=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,request:routedTransport(routes)});
 const cachedCalls=[];const cached=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous,request:routedTransport(routes,cachedCalls)});assert.deepEqual(cachedCalls,['/api/v1/resources']);assert.equal(cached.serviceDetails[0].checkedAt,previous.serviceDetails[0].checkedAt);
 const failureRoutes={...routes,'/api/v1/services/service-a':{status:404}};const failed=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous,forceDetails:true,request:routedTransport(failureRoutes)});assert.equal(failed.serviceDetails[0].checkedAt,previous.serviceDetails[0].checkedAt);assert.deepEqual(failed.serviceDetails[0].components,previous.serviceDetails[0].components);assert.ok(failed.serviceDetails[0].error);
 const foreign=await collectCoolify('https://other.example','FAKE-TOKEN',{...options,previous,request:routedTransport(failureRoutes)});assert.equal(foreign.serviceDetails[0].checkedAt,null);assert.deepEqual(foreign.serviceDetails[0].components,[]);
 const removed=await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous,request:routedTransport({'/api/v1/resources':{body:[]}})});assert.deepEqual(removed.serviceDetails,[]);
 const nextCalls=[];await collectCoolify('https://panel.example','FAKE-TOKEN',{...options,previous:failed,request:routedTransport(failureRoutes,nextCalls)});assert.deepEqual(nextCalls,['/api/v1/resources']);
});
test('Coolify respects remaining request allowance before concurrent detail queries and exposes partial coverage',async()=>{
 const calls=[];const routes={'/api/v1/resources':{body:parents,headers:{'x-ratelimit-remaining':'1'}},'/api/v1/services/service-a':{body:detail(),headers:{'x-ratelimit-remaining':'0'}}};
 const result=await collectCoolify('https://panel.example','FAKE-TOKEN',{resolve:async()=>[publicAddress],request:routedTransport(routes,calls)});assert.deepEqual(calls,['/api/v1/resources','/api/v1/services/service-a']);assert.equal(result.serviceDetails[0].components.length,2);assert.match(result.serviceDetails[1].error,/consultas disponibles/);assert.equal(result.serviceDetails[1].checkedAt,null);
});
