import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/server/store.mjs';
import {rescanIncidents} from '../lib/server/incident-rescan.mjs';
import {incidentReport,reconcileIncidents} from '../lib/server/incidents.mjs';
const readers={host:async()=>({disabled:true}),observer:async()=>({unconfigured:true}),drive:async()=>({disabled:true}),backups:async()=>({disabled:true})};
function reading(db,status){const now=Date.now();db.saveCoolifySnapshot('https://fixture.example',{source:'https://fixture.example',checkedAt:now,expiresAt:now+300000,resources:[{id:'fixture',name:'Fixture app',type:'application',status}]})}
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'rescan-fixture-'));const db=new Store(root);try{db.configureCoolify('https://fixture.example','ISOLATED_SCAN_TOKEN');db.configureCollector(true);db.collectorHeartbeat();reading(db,'exited:unhealthy');reconcileIncidents(db);await fn(db)}finally{db.close();await rm(root,{recursive:true,force:true})}}
test('rescan archives only cleared findings, preserves ongoing episodes and never resets notification state',()=>fixture(async db=>{
 const before=incidentReport(db).items[0],mail=()=>db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'notification%' ORDER BY name").all().map(({name})=>[name,db.db.prepare(`SELECT * FROM ${name}`).all()]);const initial=mail();
 const same=await rescanIncidents(db,{readers,refresh:async()=>{reading(db,'exited:unhealthy');return {updated:true}}});assert.equal(same.archived,0);assert.equal(same.active,1);assert.equal(incidentReport(db).items.find(i=>i.id===before.id).state,'open');
 const cleared=await rescanIncidents(db,{readers,refresh:async()=>{reading(db,'running:healthy');return {updated:true}}});assert.equal(cleared.archived,1);assert.equal(cleared.active,0);assert.equal(incidentReport(db).items.find(i=>i.id===before.id).state,'resolved');assert.deepEqual(mail(),initial);
}));
test('partial or overlapping scans never erase unverified faults or activate paused monitoring',()=>fixture(async db=>{
 const id=incidentReport(db).items[0].id;
 const failed=await rescanIncidents(db,{readers,refresh:async()=>{db.failCoolify('https://fixture.example','Isolated read failure');throw Error('private raw error')}});assert.equal(failed.partial,true);assert.equal(incidentReport(db).items.find(i=>i.id===id).state,'open');assert.equal(JSON.stringify(failed).includes('private raw'),false);
 const lease=db.acquireProvider('_incident_rescan');await assert.rejects(rescanIncidents(db,{readers}),{status:409});db.releaseProvider('_incident_rescan',lease);
 db.configureCollector(false);await assert.rejects(rescanIncidents(db,{readers}),{status:409});assert.equal(db.collectorStatus().enabled,false);
}));
