import test from 'node:test';
import assert from 'node:assert/strict';
import {healthItems,nodeHealth,actionLabel} from '../lib/workspace-health.mjs';
const now=2000000;
function fixture(){
 const app={ref:'app-ref',provider:'Coolify',kind:'resource',id:'app',parentId:null,name:'Same name',type:'service',status:'running:healthy',source:'fixture',checkedAt:now,stale:false};
 const db={...app,ref:'db-ref',id:'db',parentId:'app',kind:'component',type:'database',status:'running:unhealthy'};
 return {connection:{hasToken:true,error:null,snapshot:{checkedAt:now,expiresAt:now+1000,resources:[{id:'app'}],serviceDetails:[{serviceId:'app',checkedAt:now,expiresAt:now+1000,error:null,components:[{id:'db',excludedFromStatus:false}]}]}},topology:{revision:'source-1',nodes:[app,db],edges:[{kind:'contained-in',origin:'observed',missing:false,fromRef:'db-ref',toRef:'app-ref'}]},organization:{connectionRevision:'source-1',projects:[{id:'project',name:'Test',color:'cyan'}],assignments:[{ref:'app-ref',projectId:'project',missing:false,stale:false}]},incidents:{items:[]}};
}
test('A child database warning propagates through observed containment, without name matching',()=>{
 const d=fixture();assert.equal(healthItems(d,now).projects[0].state,'warning');
 d.topology.nodes[1].parentId='elsewhere';d.topology.edges=[];assert.equal(healthItems(d,now).projects[0].state,'healthy');
});
test('Excluded components do not turn service state red; their individual state remains visible',()=>{
 const d=fixture();d.connection.snapshot.serviceDetails[0].components[0].excludedFromStatus=true;
 assert.equal(healthItems(d,now).projects[0].state,'healthy');assert.equal(nodeHealth(d,d.topology.nodes[1],now),'warning');
});
test('Stale provider reads, stale assignments and changed identities cannot appear healthy',()=>{
 const d=fixture();d.topology.nodes[1].status='running:healthy';assert.equal(healthItems(d,now).projects[0].state,'healthy');
 assert.equal(healthItems(d,now+2000).projects[0].state,'unknown');
 d.organization.assignments[0].stale=true;assert.equal(healthItems(d,now).projects[0].state,'unknown');
 d.organization.assignments[0].stale=false;d.organization.connectionRevision='source-2';assert.equal(healthItems(d,now).projects[0].state,'unknown');
 d.connection.snapshot.resources=[];assert.equal(nodeHealth(d,d.topology.nodes[0],now),'unknown');
});
test('Missing members are disclosed, and a null-resource incident is not attached to every app',()=>{
 const d=fixture();d.topology.nodes[1].status='running:healthy';
 d.incidents.items=[{id:'global',state:'open',payload:{provider:'Coolify',resourceId:null,findingId:'connection-failed',severity:'warning'}}];
 assert.equal(healthItems(d,now).projects[0].alerts.length,0);assert.equal(healthItems(d,now).projects[0].state,'healthy');
 d.organization.assignments.push({ref:'gone',projectId:'project',missing:true});assert.equal(healthItems(d,now).projects[0].state,'unknown');
});
test('Job accepted or uncertain is never described as an ongoing repair',()=>{
 for(const state of ['planned','queued','dispatched','uncertain','reviewed'])assert.doesNotMatch(actionLabel({state}),/en curso/);
 assert.match(actionLabel({state:'queued',observation:{job:{state:'in_progress',checkedAt:now}}},now),/en curso/);
 assert.doesNotMatch(actionLabel({state:'queued',observation:{job:{state:'in_progress',checkedAt:now-300001}}},now),/en curso/);
 assert.match(actionLabel({state:'queued',observation:{job:{state:'finished'}}}),/falta revisión/);
});
