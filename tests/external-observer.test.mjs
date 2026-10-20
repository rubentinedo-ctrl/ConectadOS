import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,unlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Store} from '../lib/server/store.mjs';
import {observerConnection,observerKey,configureObserver,observerScope} from '../lib/server/observer-config.mjs';
import {externalObserverReport,refreshExternalObserver} from '../lib/server/external-observer.mjs';
import {assertNoAssistantSecrets} from '../lib/server/assistant.mjs';
import {configuration,tick} from '../deploy/observer/lib/monitor.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';import {rotateKeyCopy} from '../lib/server/rotate-key.mjs';import {saveConfig} from '../scripts/config.mjs';
import {collectorTick} from '../lib/server/collector.mjs';
const key='OBSERVER_READER_ISOLATED_FIXTURE_'.repeat(2);
const cfg=configuration({OBSERVER_TARGETS:'[{"id":"web","url":"https://web.example"}]'});
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-observer-test-'));await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:3119,mode:'demo'});const db=new Store(root);try{await fn(db,root)}finally{db.close();await rm(root,{recursive:true,force:true})}}
function enable(db){configureObserver(db,{revision:observerConnection(db).revision,url:'https://observer.example',configurationHash:cfg.hash,enabled:true,readSecret:key});db.configureCollector(true)}
async function exported(at=Date.now()){let state=null,etag=0;const store={read:async()=>state?{value:state,etag:String(etag)}:null,compareAndSet:async(old,value)=>{if(old!==(state?String(etag):null))return null;state=structuredClone(value);return String(++etag)}};const check=async()=>({checkedAt:at,kind:'responding',status:200,durationMs:12,certificateExpiresAt:null});await tick(store,cfg,{now:()=>at,check});return {text:JSON.stringify({backupVersion:1,exportedAt:at,configuration:{targets:cfg.targets,intervalSeconds:cfg.intervalSeconds},state})}}
test('reader configuration encrypts a distinct key, binds revision/scope and needs an unarchived local activation identity',()=>fixture(async(db,root)=>{
 const initial=observerConnection(db);assert.equal(initial.hasKey,false);enable(db);assert.equal(observerKey(db),key);assert.equal(observerConnection(db).activated,true);assert.equal(JSON.stringify(externalObserverReport(db)).includes(key),false);assert.equal(db.db.prepare('SELECT sealed FROM observer_connection').get().sealed.includes(key),false);assert.throws(()=>assertNoAssistantSecrets(db,'echo '+key));
 const old=observerConnection(db),scope=observerScope(db);assert.throws(()=>configureObserver(db,{...old,revision:'initial',enabled:false}),{status:409});
 configureObserver(db,{...old,enabled:false});assert.equal(observerScope(db),scope);assert.equal(observerConnection(db).enabled,false);assert.equal(observerKey(db),key);
 await unlink(path.join(root,'.keys/observer-reader-instance.key'));assert.equal(observerConnection(db).activated,false);
 const current=observerConnection(db);assert.throws(()=>configureObserver(db,{...current,url:'https://different.example',enabled:true}),{status:409});
 db.saveCredential('Coolify','Fixture',key);assert.throws(()=>configureObserver(db,{...current,enabled:true,readSecret:key}),/No reutilices|no reutilices/);
}));
test('reader retains dated observations on failure, hides current status, rejects old/changed rounds and does not query from reports',()=>fixture(async db=>{
 enable(db);let at=Date.now(),calls=0;const data=await exported(at),read=async c=>{calls++;assert.equal(c.url,'https://observer.example');assert.equal(c.readSecret,key);return data};
 await refreshExternalObserver(db,{read,now:()=>at});let report=externalObserverReport(db,{now:at});assert.equal(report.status,'observed');assert.equal(report.observation.targets[0].current,'checking');assert.equal(calls,1);
 for(let i=0;i<5;i++)externalObserverReport(db,{now:at});assert.equal(calls,1);assert.deepEqual(await refreshExternalObserver(db,{read,now:()=>at}),{cached:true});
 at+=60000;await assert.rejects(refreshExternalObserver(db,{read:async()=>{throw new Error('PRIVATE-TRANSPORT-MARKER')},now:()=>at}));report=externalObserverReport(db,{now:at});assert.equal(report.status,'error');assert.equal(report.observation.history.length,1);assert.equal(report.observation.targets[0].current,'unknown');assert.equal(JSON.stringify(report).includes('PRIVATE'),false);
 const wrong=JSON.parse(data.text);wrong.exportedAt=at;wrong.state.targets[0].successes=2;wrong.state.targets[0].status='responding';await assert.rejects(refreshExternalObserver(db,{read:async()=>({text:JSON.stringify(wrong)}),now:()=>at,force:true}),/sin una ronda nueva/);
 await refreshExternalObserver(db,{read:async()=>({text:JSON.stringify({...JSON.parse(data.text),exportedAt:at})}),now:()=>at,force:true});assert.equal(externalObserverReport(db,{now:at+181000}).status,'stale');
 const older=await exported(at-120000);await assert.rejects(refreshExternalObserver(db,{read:async()=>older,now:()=>at,force:true}),/lectura anterior/);
}));
test('shared lease and configuration changes protect against slow or superseded readers',()=>fixture(async(db,root)=>{
 enable(db);const other=new Store(root);let finish;const waiting=new Promise(r=>finish=r),at=Date.now(),data=await exported(at);
 const first=refreshExternalObserver(db,{read:async()=>{await waiting;return data},now:()=>at});await new Promise(r=>setImmediate(r));
 try{assert.deepEqual(await refreshExternalObserver(other,{read:async()=>data,now:()=>at}),{busy:true});configureObserver(other,{...observerConnection(other),enabled:false});finish();await assert.rejects(first,{status:409});assert.equal(externalObserverReport(db).observation,null);}finally{finish();other.close()}
}));
test('restoration and master-key rotation retain the encrypted reader/history and pause every copied identity',()=>fixture(async(db,root)=>{
 enable(db);const data=await exported();await refreshExternalObserver(db,{read:async()=>data});const ownerKey=await readFile(path.join(root,'.keys/vault.key')),copy=path.join(root,'copy');await snapshot(root,copy);
 const restoredPath=path.join(root,'restored');await restoreToNewDirectory(copy,restoredPath,path.join(root,'.keys/vault.key'));const restored=new Store(restoredPath);try{assert.equal(observerKey(restored),key);assert.equal(externalObserverReport(restored).status,'paused');assert.equal(observerConnection(restored).enabled,false);assert.equal(observerConnection(restored).activated,false);assert.equal(externalObserverReport(restored).observation.history.length,1);}finally{restored.close()}
 const rotatedPath=path.join(root,'rotated');await rotateKeyCopy(copy,rotatedPath,path.join(root,'.keys/vault.key'));const rotated=new Store(rotatedPath);try{assert.equal(observerKey(rotated),key);assert.equal(observerConnection(rotated).enabled,false);assert.equal(observerConnection(rotated).activated,false);assert.equal(externalObserverReport(rotated).observation.history.length,1);assert.notDeepEqual(await readFile(path.join(rotatedPath,'.keys/vault.key')),ownerKey);}finally{rotated.close()}
 assert.equal(observerConnection(db).enabled,true);assert.deepEqual(await readFile(path.join(root,'.keys/vault.key')),ownerKey);
 // An older restorer copying only SQLite and vault.key cannot inherit the activation file.
 const legacyPath=path.join(root,'legacy');await saveConfig(legacyPath,{schemaVersion:1,host:'127.0.0.1',port:3119,mode:'demo'});const {copyFile,mkdir}=await import('node:fs/promises');await mkdir(path.join(legacyPath,'.keys'),{recursive:true});await copyFile(path.join(root,'.keys/vault.key'),path.join(legacyPath,'.keys/vault.key'));await copyFile(path.join(copy,'conectados.sqlite'),path.join(legacyPath,'.data/conectados.sqlite'));const legacy=new Store(legacyPath);try{assert.equal(observerConnection(legacy).enabled,true);assert.equal(observerConnection(legacy).activated,false);assert.deepEqual(await refreshExternalObserver(legacy,{read:()=>{throw new Error('Must not query')}}),{paused:true});}finally{legacy.close()}
}));
test('collector queries only its configured reader, shares the result with UI and respects global pause',()=>fixture(async db=>{
 enable(db);let calls=0;const data=await exported();await collectorTick(db,{externalObserver:{read:async()=>{calls++;return data}}});assert.equal(calls,1);assert.equal(externalObserverReport(db).status,'observed');db.configureCollector(false);await collectorTick(db,{externalObserver:{read:async()=>{calls++;return data}}});assert.equal(calls,1);assert.equal(externalObserverReport(db).status,'paused');
}));
