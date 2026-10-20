import test from 'node:test';import assert from 'node:assert/strict';
import {hostingerDashboard} from '../lib/hostinger-dashboard.mjs';
import {incidentPresentation} from '../lib/incident-presentation.mjs';
const now=Date.now(),snapshot={checkedAt:now,expiresAt:now+900000,resources:[{type:'server',memoryMB:16384,diskMB:204800,bandwidthMB:16384000}],metrics:[['cpu_usage','%',27],['ram_usage','bytes',8*1024**3],['disk_space','bytes',76*1024**3],['incoming_traffic','bytes',37.5*1024**2]].map(([name,unit,value])=>({name,unit,points:[{at:now-60000,value}]}))};
test('main VPS metrics use the provider samples and capacity, not Linux available memory or calculated monthly transfer',()=>{
 const h=hostingerDashboard({hasToken:true,snapshot,error:null},now);assert.equal(h.cpu.last.value,27);assert.equal(h.ramPercent,50);assert.equal(h.diskPercent,38);assert.equal(h.totalDisk,200*1024**3);assert.equal(h.bandwidthTB,16);assert.equal(h.incoming.last.value,37.5*1024**2);assert.equal(h.outgoing.current,false);assert.equal(h.monthlyTraffic,undefined);
 const old=hostingerDashboard({hasToken:true,snapshot,error:null},now+1000000);assert.equal(old.cpu.current,false);assert.equal(old.ramPercent,null);
 const failed=hostingerDashboard({hasToken:true,snapshot,error:'Fixture permission failure'},now);assert.equal(failed.cpu.current,false);assert.equal(failed.ramPercent,null);
 const spaced=structuredClone(snapshot);spaced.metrics[0].points[0].at=now-20*60000;assert.equal(hostingerDashboard({hasToken:true,snapshot:spaced,error:null},now).cpu.current,true);spaced.metrics[0].points[0].at=now-61*60000;assert.equal(hostingerDashboard({hasToken:true,snapshot:spaced,error:null},now).cpu.current,false);
 const wrong=structuredClone(snapshot);wrong.metrics[1].unit='%';assert.equal(hostingerDashboard({hasToken:true,snapshot:wrong,error:null},now).ramPercent,null);assert.equal(hostingerDashboard(null,now).cpu.current,false);
});
test('alert explanations distinguish unknown, intentionally possible pauses, component warnings and a billing reminder',()=>{
 const make=(findingId,provider,detail,severity='warning')=>incidentPresentation({payload:{findingId,provider,detail,title:'Fixture',severity}});
 assert.match(make('Supabase:x','Supabase','project:INACTIVE').issue,/pausado/);assert.match(make('Coolify:x','Coolify','exited:unhealthy').meaning,/intencional/);assert.match(make('components-attention:x','Coolify','9 componentes').issue,/9 componentes/);assert.match(make('stale:Coolify','Coolify','Old','unknown').meaning,/no significa que esté caído/);assert.match(make('renewal:x','Hostinger','Due').meaning,/no demuestra un cobro/);
});

// Historical explanations must come from that snapshot, with one count per resource.
import {dashboardHistorySample} from '../lib/dashboard-history.mjs';
test('warning timeline explains dated resources, ignores excluded components and never exposes raw errors',()=>{
 const s={source:'https://fixture.invalid',checkedAt:1000,resources:[{id:'a',name:'Paused fixture',type:'service',status:'exited:unhealthy'},{id:'b',name:'Parts fixture',type:'service',status:'running:healthy'},{id:'c',name:'Read fixture',type:'service',status:'running:healthy'}],serviceDetails:[{serviceId:'b',checkedAt:900,expiresAt:2000,error:null,components:[{name:'db',status:'exited'},{name:'rest',status:'running:unhealthy'},{name:'init',status:'exited',excludedFromStatus:true}]},{serviceId:'c',error:'PRIVATE ERROR',components:[]}]};
 const result=dashboardHistorySample(s);assert.equal(result.attention,3);assert.deepEqual(result.warnings.map(w=>w.kind),['stopped','components','reading']);assert.equal(result.warnings[1].components.length,2);assert.equal(result.warnings[1].detailStale,false);assert.equal(result.warnings[2].detailStale,true);assert.ok(!JSON.stringify(result).includes('PRIVATE ERROR'));
 const later=structuredClone(s);later.resources[0].name='Later name';later.resources[0].status='running:healthy';assert.equal(dashboardHistorySample(later).attention,2);assert.equal(result.warnings[0].name,'Paused fixture');
});
test('warning history excludes prepared apps only with identity bound evidence at the historical time',()=>{
 const s={source:'https://fixture.invalid',checkedAt:1000,resources:[{id:'app',name:'Prepared',type:'application',status:'exited'}],applicationDeployments:[{applicationId:'app',count:0,source:'https://fixture.invalid/api/v1/deployments/applications/app?skip=0&take=1',checkedAt:1100,expiresAt:301100,error:null}]};
 assert.equal(dashboardHistorySample(s).attention,0);s.applicationDeployments[0].source='https://wrong.invalid';assert.equal(dashboardHistorySample(s).attention,1);
});
