import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Store,AppError} from '../lib/server/store.mjs';import {refreshCoolify,collectorTick} from '../lib/server/collector.mjs';
import {declaredState,observationStale,orbitPositions} from '../lib/observations.mjs';
const fixture=(status='running:healthy')=>({source:'https://panel.example',checkedAt:Date.now(),coverage:'Test only',resources:[{id:'resource-a',name:'Test resource',type:'service',status}]});
async function sandbox(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-collector-'));const db=new Store(root);try{await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
test('collector stays disabled by default, caches readings, and locks overlapping processes',async()=>sandbox(async(db,root)=>{
 db.configureCoolify('https://panel.example','TEST-ONLY-TOKEN');let calls=0;const collect=async()=>{calls++;return fixture()};
 assert.deepEqual(await collectorTick(db,{collect}),{disabled:true});assert.equal(calls,0);
 db.configureCollector(true);await collectorTick(db,{collect});assert.equal(calls,1);assert.equal(db.observationHistory().length,1);
 await refreshCoolify(db,{collect});assert.equal(calls,1);
 const other=new Store(root);let finish;const pending=new Promise(resolve=>finish=resolve);const first=refreshCoolify(db,{force:true,collect:async()=>{await pending;return fixture()}});
 try{assert.deepEqual(await refreshCoolify(other,{force:true,collect}),{busy:true});assert.equal(calls,1)}finally{finish();await first;other.close()}
 assert.ok(db.collectorStatus().heartbeat);assert.equal(db.collectorStatus().error,null);
}));
test('failed or revoked connection retains dated evidence and never overwrites a changed credential',async()=>sandbox(async db=>{
 db.configureCoolify('https://panel.example','OLD-TEST-TOKEN');db.configureCollector(true);db.saveCoolifySnapshot('https://panel.example',fixture());
 await collectorTick(db,{force:true,collect:async()=>{throw new AppError('Token no válido.',502)}});
 assert.equal(db.coolifyConnection().snapshot.resources.length,1);assert.equal(db.collectorStatus().error,'Token no válido.');assert.equal(observationStale(db.coolifyConnection()),true);
 await assert.rejects(refreshCoolify(db,{force:true,collect:async()=>{db.configureCoolify('https://panel.example','NEW-TEST-TOKEN');return fixture()}}),/cambió/);
 assert.equal(db.coolifyConnection().snapshot,null);assert.deepEqual(db.observationHistory(),[]);assert.ok(db.acquireCollection());
}));
test('history distinguishes stopped, degraded, unknown and provider health, bounds retention and clears on token removal',async()=>sandbox(async db=>{
 db.configureCoolify('https://panel.example','TEST-ONLY-TOKEN');
 const sample=fixture('degraded:unhealthy');db.saveCoolifySnapshot('https://panel.example',{...sample,checkedAt:Date.now()-8*86400000});db.saveCoolifySnapshot('https://panel.example',sample);
 assert.equal(db.observationHistory().length,1);assert.equal(db.observationHistory()[0].attention,1);assert.equal(db.observationHistory()[0].warnings[0].name,'Test resource');assert.equal(db.observationHistory()[0].warnings[0].kind,'unhealthy');
 assert.equal(declaredState('running:unknown').key,'unknown');assert.equal(declaredState('running:unhealthy').key,'warning');assert.equal(declaredState('exited:unhealthy').key,'stopped');assert.equal(declaredState('running:healthy').key,'healthy');
 assert.equal(observationStale(db.coolifyConnection(),sample.checkedAt+300001),true);
 assert.deepEqual(orbitPositions([]),[]);assert.deepEqual(orbitPositions(sample.resources).map(r=>r.id),['resource-a']);
 db.deleteCredential('Coolify');assert.deepEqual(db.observationHistory(),[]);assert.equal(db.coolifyConnection().snapshot,null);
}));

test('component changes affect dated history and audit while repeated readings and excluded tasks do not create warnings',async()=>sandbox(async db=>{
 db.configureCoolify('https://panel.example','TEST-ONLY-TOKEN');
 const sample=fixture();sample.serviceDetails=[{serviceId:'resource-a',components:[{id:'init',type:'application',name:'Initialization',status:'exited',excludedFromStatus:true}],error:null,checkedAt:Date.now(),attemptedAt:Date.now(),expiresAt:Date.now()+900000,source:'https://panel.example/api/v1/services/resource-a'}];
 db.saveCoolifySnapshot('https://panel.example',sample);assert.equal(db.observationHistory()[0].attention,0);const before=db.audit().filter(e=>e.event==='coolify_refreshed').length;
 db.saveCoolifySnapshot('https://panel.example',{...sample,checkedAt:sample.checkedAt+1,serviceDetails:[{...sample.serviceDetails[0],checkedAt:sample.checkedAt+1}]});assert.equal(db.audit().filter(e=>e.event==='coolify_refreshed').length,before);
 const changed={...sample,checkedAt:sample.checkedAt+2,serviceDetails:[{...sample.serviceDetails[0],components:[...sample.serviceDetails[0].components,{id:'db',type:'database',name:'DB',status:'exited:unhealthy',excludedFromStatus:false}]}]};db.saveCoolifySnapshot('https://panel.example',changed);assert.equal(db.observationHistory()[0].attention,1);assert.equal(db.audit().filter(e=>e.event==='coolify_refreshed').length,before+1);
}));
