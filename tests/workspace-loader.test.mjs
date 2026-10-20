import test from 'node:test';import assert from 'node:assert/strict';
import {createWorkspaceLoader} from '../lib/workspace-loader.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('inventory appears before a slow operations response; operations failure leaves inventory visible',async()=>{
 const pending=deferred(),inventories=[],errors=[];
 const load=createWorkspaceLoader({read:async path=>path.endsWith('infrastructure')?{resources:['a','b']}:pending.promise,inventory:v=>inventories.push(v),jobs:()=>{},inventoryError:()=>errors.push('inventory'),jobsError:()=>errors.push('jobs')});
 const work=load();await work;assert.deepEqual(inventories,[{resources:['a','b']}]);assert.deepEqual(errors,[]);pending.reject(Error('Slow jobs failed'));await tick();assert.deepEqual(errors,['jobs']);assert.equal(inventories.length,1);
});
test('older overlapping responses cannot erase a newer inventory or operations result',async()=>{
 const oldInventory=deferred(),oldJobs=deferred(),inventories=[],jobs=[];let calls=0;
 const load=createWorkspaceLoader({read:path=>{calls++;return calls<=2?path.endsWith('infrastructure')?oldInventory.promise:oldJobs.promise:Promise.resolve({version:2})},inventory:v=>inventories.push(v),jobs:v=>jobs.push(v),inventoryError:()=>{},jobsError:()=>{}});
 const old=load();await load();oldInventory.resolve({version:1});oldJobs.resolve({version:1});await old;assert.deepEqual(inventories,[{version:2}]);assert.deepEqual(jobs,[{version:2}]);
});
test('failed reads retain prior inventory; aborted or disposed reads never commit',async()=>{
 const values=['previous'],errors=[];const loader=(read)=>createWorkspaceLoader({read,inventory:v=>values.push(v),jobs:()=>{},inventoryError:()=>errors.push('inventory'),jobsError:()=>{}});
 await loader(async()=>{throw Error('Timeout')})();assert.deepEqual(values,['previous']);assert.deepEqual(errors,['inventory']);
 const d=deferred(),load=loader(()=>d.promise),controller=new AbortController();const work=load(controller.signal);controller.abort();d.resolve('aborted');await work;assert.deepEqual(values,['previous']);
 const e=deferred(),dispose=loader(()=>e.promise),second=dispose();dispose.invalidate();e.resolve('disposed');await second;assert.deepEqual(values,['previous']);
});
