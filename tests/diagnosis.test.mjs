import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {Store} from '../lib/server/store.mjs';import {topologyReport} from '../lib/server/topology.mjs';
import {saveProject,assignResource,organizationReport} from '../lib/server/organization.mjs';
import {runDiagnosis,diagnosticHistory,compareChecks} from '../lib/server/diagnosis.mjs';
const source='https://panel.example',secret='DIAGNOSIS_FIXTURE_SECRET_ONLY';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-diagnosis-')),db=new Store(root);try{
 await db.createOwner((await readFile(path.join(root,'.keys/setup-token'),'utf8')).trim(),'fixture-owner','ISOLATED_PASSWORD_1234567890');db.configureCoolify(source,secret);
 let clock=Date.now();const write=(status='running:unhealthy',options={})=>{clock=Date.now();db.saveCoolifySnapshot(source,{source,checkedAt:clock,resources:[{id:'service',name:'Fixture Application',type:'service',status:'running:healthy'}],serviceDetails:[{serviceId:'service',source:source+'/api/v1/services/service',components:options.missing?[]:[{id:'db',name:'db',type:'database',status,image:'postgres:17',excludedFromStatus:options.excluded??false}],checkedAt:clock,attemptedAt:clock,expiresAt:clock+900000,error:options.error??null}]},db.credentialIdentity('Coolify'))};
 write();const input={scope:'resource',target:topologyReport(db).nodes.find(n=>n.id==='db').ref};await fn({db,write,input});
 }finally{db.close();await rm(root,{recursive:true,force:true})}}
test('Fresh read-only diagnosis records the failing component and confirms comparable recovery',()=>fixture(async({db,write,input})=>{
 const calls=[];const refresh=async(p,ids)=>{calls.push([p,ids]);write();return {updated:true}};
 const first=(await runDiagnosis(db,input,{refresh})).runs[0];assert.equal(first.state,'warning');assert.equal(first.checks[0].state,'fail');assert.deepEqual(calls,[['Coolify',['service']]]);assert.equal(first.checks[0].recovered,false);assert.equal(JSON.stringify(first).includes(secret),false);
 // Ensure a distinct reading time without a sleep.
 const original=db.db.prepare('SELECT report FROM diagnostic_runs WHERE id=?').get(first.id);const prior=JSON.parse(original.report);prior.checks[0].checkedAt-=1;db.db.prepare('UPDATE diagnostic_runs SET report=? WHERE id=?').run(JSON.stringify(prior),first.id);
 const second=(await runDiagnosis(db,input,{refresh:async()=>{write('running:healthy');return {updated:true}}})).runs[0];assert.equal(second.state,'clear');assert.equal(second.checks[0].recovered,true);assert.equal(diagnosticHistory(db,input).runs.length,2);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM diagnostic_runs").get().n,2);
 assert.equal(db.db.prepare("SELECT COUNT(*) n FROM audit WHERE event='diagnosis_read_only'").get().n,2);
}));
test('Failed, busy, stale and incomplete reads never assert recovery or leak thrown secrets',()=>fixture(async({db,write,input})=>{
 for(const refresh of [async()=>{throw Error(secret)},async()=>({busy:true}),async()=>({updated:true}),async()=>{write('running:healthy',{error:'Incomplete fixture'});return {updated:true}}]){
 const result=(await runDiagnosis(db,input,{refresh,now:()=>Date.now()+1000})).runs[0];assert.equal(result.state,'unknown');assert.equal(result.checks[0].recovered,false);assert.equal(result.checks[0].checkedAt,null);assert.equal(JSON.stringify(result).includes(secret),false);
 }
}));
test('A vanished resource or replaced credential cannot be treated as a repaired resource',()=>fixture(async({db,write,input})=>{
 await assert.rejects(runDiagnosis(db,input,{refresh:async()=>{write('running:healthy',{missing:true});return {updated:true}}}),/recurso|conexión/);
 assert.equal(db.db.prepare('SELECT COUNT(*) n FROM diagnostic_runs').get().n,0);
 write();await assert.rejects(runDiagnosis(db,input,{refresh:async()=>{db.configureCoolify(source,'REPLACED_FIXTURE_ACCESS');return {updated:true}}}),/recurso|conexión/);
 assert.throws(()=>diagnosticHistory(db,input),/recurso|conexión/);
}));
test('Session revocation during a read saves no receipt; arbitrary targets are rejected',()=>fixture(async({db,input})=>{
 await assert.rejects(runDiagnosis(db,input,{refresh:async()=>({updated:true}),authorize:()=>false}),/sesión/);
 assert.equal(db.db.prepare('SELECT COUNT(*) n FROM diagnostic_runs').get().n,0);
 for(const value of [{scope:'url',target:source},{scope:'resource',target:'https://127.0.0.1'},{scope:'execute',target:'db'}])assert.throws(()=>diagnosticHistory(db,value));
}));
test('Recovery survives an inconclusive read but cannot be inferred from an unknown, excluded or older sample',()=>{
 const fail={checks:[{key:'a',state:'fail',checkedAt:100}]};
 const unknown=compareChecks([{key:'a',state:'unknown',checkedAt:null}],fail);assert.equal(unknown[0].recovered,false);
 assert.equal(compareChecks([{key:'a',state:'pass',checkedAt:200}],{checks:unknown})[0].recovered,true);
 for(const c of [{key:'a',state:'pass',checkedAt:90},{key:'different',state:'pass',checkedAt:200},{key:'a',state:'excluded',checkedAt:200}])assert.equal(compareChecks([c],fail)[0].recovered,false);
});
test('Reclassification is not a recovery and never carries an old failure across the prepared state',()=>{
 const prior={checks:[{key:'app',state:'fail',checkedAt:100}]},prepared=compareChecks([{key:'app',state:'prepared',checkedAt:200}],prior);
 assert.equal(prepared[0].reclassified,true);assert.equal(prepared[0].recovered,false);assert.equal(prepared[0].failureAt,null);
 assert.equal(compareChecks([{key:'app',state:'pass',checkedAt:300}],{checks:prepared})[0].recovered,false);
});
test('Prepared receipts keep a conservative state for older code and are projected correctly by current readers',()=>fixture(async({db})=>{
 const write=()=>{const now=Date.now();db.saveCoolifySnapshot(source,{source,checkedAt:now,resources:[{id:'new-app',name:'New app',type:'application',status:'exited:unhealthy'}],serviceDetails:[],applicationDeployments:[{applicationId:'new-app',count:0,source:source+'/api/v1/deployments/applications/new-app?skip=0&take=1',checkedAt:now,expiresAt:now+300000,error:null}]},db.credentialIdentity('Coolify'))};write();
 const input={scope:'resource',target:topologyReport(db).nodes[0].ref};const result=(await runDiagnosis(db,input,{refresh:async()=>{write();return {updated:true}}})).runs[0];
 assert.equal(result.state,'prepared');assert.equal(result.checks[0].state,'prepared');assert.equal(result.checks[0].recovered,false);
 const stored=JSON.parse(db.db.prepare('SELECT report FROM diagnostic_runs WHERE id=?').get(result.id).report);assert.equal(stored.state,'unknown');assert.equal(stored.checks[0].state,'unknown');assert.equal(stored.classification,'prepared');
 assert.equal(diagnosticHistory(db,input).runs[0].state,'prepared');assert.equal(diagnosticHistory(db,input).runs[0].checks[0].state,'prepared');
}));
test('Excluded children remain visible and are checked explicitly when selected alone',()=>fixture(async({db,write,input})=>{
 const refresh=async()=>{write('exited:unhealthy',{excluded:true});return {updated:true}};
 const service={scope:'resource',target:topologyReport(db).nodes.find(n=>n.id==='service').ref};
 const aggregate=(await runDiagnosis(db,service,{refresh})).runs[0];assert.equal(aggregate.state,'clear');assert.equal(aggregate.checks.find(c=>c.name.includes('db')).state,'excluded');
 assert.equal((await runDiagnosis(db,input,{refresh})).runs[0].state,'warning');
 const failedDetail=async()=>{write('running:healthy',{excluded:true,error:'Detail unavailable'});return {updated:true}};
 assert.equal((await runDiagnosis(db,service,{refresh:failedDetail})).runs[0].state,'unknown');
}));
test('Editing project assignments during a read invalidates comparison and saves no result',()=>fixture(async({db,write,input})=>{
 const projectId=saveProject(db,{name:'Fixture Project'}),o=organizationReport(db);
 assignResource(db,{ref:input.target,connectionRevision:o.connectionRevision,projectId});
 await assert.rejects(runDiagnosis(db,{scope:'project',target:projectId},{refresh:async()=>{
  write('running:healthy');const current=organizationReport(db),p=current.projects[0];saveProject(db,{id:p.id,revision:p.revision,name:'Renamed fixture'});return {updated:true};
 }}),/selección|conexión/);
 assert.equal(db.db.prepare('SELECT COUNT(*) n FROM diagnostic_runs').get().n,0);
}));
