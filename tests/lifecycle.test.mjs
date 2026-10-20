import test from 'node:test';import assert from 'node:assert/strict';
import {applicationLifecycle} from '../lib/observations.mjs';
import {nodeHealth,healthItems} from '../lib/workspace-health.mjs';
import {buildDiagnostics} from '../lib/diagnostics.mjs';
const at=2000000,resource={id:'created-app',name:'A stopped app',type:'application',status:'exited:unhealthy'};
const evidence={applicationId:resource.id,count:0,source:'https://panel.example/api/v1/deployments/applications/created-app?skip=0&take=1',checkedAt:at,expiresAt:at+300000,error:null};
function data(){return {connection:{hasToken:true,error:null,url:'https://panel.example',snapshot:{source:'https://panel.example',checkedAt:at,resources:[{...resource}],applicationDeployments:[{...evidence}]}},topology:{nodes:[{...resource,ref:'app-ref',provider:'Coolify',kind:'resource',parentId:null,checkedAt:at,stale:false,source:'fixture'}],edges:[]},collector:{enabled:false},organization:{projects:[],assignments:[]},incidents:{items:[]}}}
test('Prepared requires current zero-deployment evidence for the exact application and source',()=>{
 const d=data(),s=d.connection.snapshot;assert.equal(applicationLifecycle(resource,s,at).state,'prepared');
 for(const patch of [{applicationId:'other'},{count:1},{count:null},{error:'No permission'},{checkedAt:at-1},{checkedAt:at+1},{source:'https://other.example/api/v1/deployments/applications/created-app?skip=0&take=1'},{expiresAt:at+999999}])assert.equal(applicationLifecycle(resource,{...s,applicationDeployments:[{...evidence,...patch}]},at),null,JSON.stringify(patch));
 assert.equal(applicationLifecycle(resource,s,at+300001),null);
 for(const status of ['running:healthy','running:unhealthy','degraded:unhealthy'])assert.equal(applicationLifecycle({...resource,status},s,at),null);
 assert.equal(applicationLifecycle({...resource,type:'service'},s,at),null);assert.equal(applicationLifecycle(resource,{...s,applicationDeployments:[]},at),null);
});
test('Prepared is distinct from healthy, warnings and unknown; failed or expired reads do not hide a real stop',()=>{
 const d=data(),n=d.topology.nodes[0];assert.equal(nodeHealth(d,n,at),'prepared');assert.equal(healthItems(d,at).resources[0].state,'prepared');assert.equal(buildDiagnostics(d,at).findings.length,0);
 d.connection.snapshot.applicationDeployments[0].count=1;assert.equal(nodeHealth(d,n,at),'warning');assert.equal(buildDiagnostics(d,at).findings.length,1);
 d.connection.snapshot.applicationDeployments[0].count=0;d.connection.snapshot.applicationDeployments[0].error='Fixture denied';assert.equal(nodeHealth(d,n,at),'warning');
 d.connection.error='Fixture failed';assert.equal(nodeHealth(d,n,at),'unknown');assert.ok(buildDiagnostics(d,at).findings.length);
});
