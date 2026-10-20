import test from 'node:test';import assert from 'node:assert/strict';import {buildDiagnostics} from '../lib/diagnostics.mjs';import {resourceNeedsAttention,resourceContainsDatabase,serviceDetailStale} from '../lib/observations.mjs';
const now=1791736800000;
test('diagnostics distinguish provider warnings, stale evidence and collector outage from application health',()=>{
 const data={connection:{hasToken:true,snapshot:{source:'https://panel.example',checkedAt:now,resources:[{id:'1',name:'Private name',status:'degraded:unhealthy'},{id:'2',name:'Running',status:'running:healthy'}]},error:null},integrations:[{provider:'Vercel',hasToken:true,snapshot:{source:'https://api.vercel.com',checkedAt:now-600000,resources:[{id:'3',name:'Private project',status:'deployment:ERROR'}]},error:'Token expired'}],collector:{enabled:true,heartbeat:now-100000}};
 const result=buildDiagnostics(data,now);assert.equal(result.readings.length,2);assert.equal(result.findings.length,4);assert.equal(result.findings[0].id,'collector');assert.equal(result.findings.find(f=>f.resourceId==='3').severity,'unknown');assert.equal(result.findings.some(f=>f.resourceId==='2'),false);assert.ok(result.findings.find(f=>f.id==='stale:Vercel').detail.includes('No permite concluir'));
 const privateReport=JSON.stringify(buildDiagnostics(data,now,true));assert.equal(privateReport.includes('Private name'),false);assert.equal(privateReport.includes('Private project'),false);assert.equal(privateReport.includes('https://panel.example'),false);
});
test('saved credentials without readings cannot establish healthy infrastructure',()=>{
 const report=buildDiagnostics({integrations:[{provider:'Hostinger',hasToken:true,snapshot:null}],collector:{enabled:false}},now);assert.equal(report.readings.length,0);assert.equal(report.findings[0].severity,'unknown');assert.equal(report.findings[0].checkedAt,null);assert.deepEqual(buildDiagnostics(null,now).findings,[]);
});

test('component coverage detects a stopped included database without confusing excluded initialization tasks or stale evidence',()=>{
 const resource={id:'parent',name:'Private service',type:'service',status:'running:healthy'};
 const detail={serviceId:'parent',source:'https://private.example/api/v1/services/parent',checkedAt:now,attemptedAt:now,expiresAt:now+900000,error:null,components:[{id:'job',name:'Private initialization',type:'application',status:'exited',excludedFromStatus:true}]};
 assert.equal(resourceNeedsAttention(resource,[detail]),false);assert.equal(resourceContainsDatabase(resource,[detail],now),false);assert.equal(resourceContainsDatabase(resource,[],now),true);assert.equal(serviceDetailStale(detail,now+900001),true);
 detail.components.push({id:'db',name:'Private DB',type:'database',status:'exited:unhealthy',excludedFromStatus:false});assert.equal(resourceNeedsAttention(resource,[detail]),true);assert.equal(resourceContainsDatabase(resource,[detail],now),true);
 const data={connection:{hasToken:true,snapshot:{source:'https://private.example',checkedAt:now,resources:[resource],serviceDetails:[detail]}},collector:{enabled:false}};const fresh=buildDiagnostics(data,now,true);assert.equal(fresh.findings.length,1);assert.equal(fresh.findings[0].severity,'warning');assert.equal(fresh.findings[0].resourceId,'parent');assert.equal(JSON.stringify(fresh).includes('Private'),false);
 detail.error='No permission';const failed=buildDiagnostics(data,now);assert.equal(failed.findings.length,2);assert.equal(failed.findings.every(f=>f.severity==='unknown'),true);assert.equal(failed.findings[0].checkedAt,now);
});

test('web findings distinguish expired evidence, HTTP restrictions, failures and near certificate expiry without leaking names',()=>{
 const result=(kind,httpStatus=200)=>({kind,httpStatus,checkedAt:now,expiresAt:now+300000,certificateExpiresAt:now+80*86400000});
 const probes=[{id:'1',label:'PRIVATE-WEB-NAME',url:'https://private.example',snapshot:result('redirect',302)},{id:'2',label:'PRIVATE-WEB-NAME',snapshot:result('protected',403)},{id:'3',label:'PRIVATE-WEB-NAME',snapshot:{...result('unreachable',null),lastResponse:{checkedAt:now-600000,httpStatus:200}}},{id:'4',label:'PRIVATE-WEB-NAME',snapshot:{...result('response'),expiresAt:now-1}},{id:'5',label:'PRIVATE-WEB-NAME',snapshot:{...result('response'),certificateExpiresAt:now+7*86400000}}];
 const report=buildDiagnostics({probes},now,true);assert.equal(report.findings.length,4);assert.equal(report.findings.some(f=>f.id==='probe:1:response'),false);assert.equal(report.findings.find(f=>f.id==='probe:2:coverage').severity,'unknown');assert.equal(report.findings.find(f=>f.id==='probe:3:response').severity,'warning');assert.equal(report.findings.find(f=>f.id==='probe:4:stale').severity,'unknown');assert.equal(report.findings.find(f=>f.id==='probe:5:certificate').severity,'warning');assert.equal(JSON.stringify(report).includes('PRIVATE-WEB-NAME'),false);assert.equal(JSON.stringify(report).includes('private.example'),false);
});
