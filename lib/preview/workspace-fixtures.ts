/** Public design examples. No owner inventory, keys, probes, or private metadata. */
import type {CoolifyState,InventoryProject,TopologyNode,TopologyEdge,ProviderConnection,ObservedProvider} from '../infrastructure-types';
import {dashboardHistorySample} from '../dashboard-history.mjs';
import type {ResourceBackupItem} from '../resource-backup-types';
export const previewAt=Date.UTC(2026,9,13,16,0);
const names=['Atlas','Nova','Clinic Demo','Files Demo','Support Demo','Studio Demo','Shop Demo','Learn Demo'];
const colors:InventoryProject['color'][]=['cyan','blue','amber','mint','coral','blue','mint','cyan'];
export function workspaceFixture(at=previewAt):CoolifyState{
 const projects:InventoryProject[]=names.map((name,i)=>({id:`demo-project-${i}`,name,description:'Proyecto ficticio para explorar el diseño',color:colors[i],revision:'demo',createdAt:at,updatedAt:at}));
 const nodes:TopologyNode[]=[],edges:TopologyEdge[]=[];
 for(const [i,name] of names.entries()){
  const provider:ObservedProvider=i===7?'Supabase':'Vercel';
  const app:TopologyNode={ref:`demo-app-${i}`,provider,kind:'resource',id:`demo-web-${i}`,parentId:null,name:name+' · Web',type:provider==='Supabase'?'cloud-project':'application',status:provider==='Supabase'?'project:ACTIVE_HEALTHY':'deployment:READY',source:'Ejemplo de diseño',checkedAt:i===5?at-600000:at,stale:i===5};
  const db:TopologyNode={ref:`demo-db-${i}`,provider:'Coolify',kind:'resource',id:`demo-db-${i}`,parentId:null,name:name+' · Datos',type:'standalone-postgresql',status:i===2?'running:unhealthy':'running:healthy',source:'Ejemplo de diseño',checkedAt:at,stale:false};
  nodes.push(app,db);
  edges.push({id:`demo-link-${i}`,fromRef:app.ref,toRef:db.ref,kind:'depends-on',origin:'declared',evidence:'Relación ficticia de la demostración',source:'Ejemplo',checkedAt:at,stale:false,missing:false,note:'No corresponde a una aplicación real',revision:'demo',createdAt:at,updatedAt:at});
 }
 nodes.push({ref:'demo-zone',provider:'Cloudflare',kind:'resource',id:'demo-zone',parentId:null,name:'example.test',type:'zone',status:'zone:active',source:'Ejemplo de diseño',checkedAt:at,stale:false},{ref:'demo-host',provider:'Hostinger',kind:'resource',id:'demo-host',parentId:null,name:'VPS de ejemplo',type:'server',status:'server:running',source:'Ejemplo de diseño',checkedAt:at,stale:false});
 const snapshot=(provider:ObservedProvider)=>({resources:nodes.filter(n=>n.provider===provider).map(n=>({id:n.id,name:n.name,type:n.type,status:n.status})),source:'Ejemplo de diseño',checkedAt:at,expiresAt:at+300000,coverage:'Datos ficticios'});
 const integrations:ProviderConnection[]=(['Vercel','Cloudflare','Hostinger','Supabase'] as const).map(provider=>({provider,scope:'example.test',snapshot:snapshot(provider),error:null,attempted:at,hasToken:true}));
 const databases=nodes.filter(n=>n.provider==='Coolify');
 const backups:ResourceBackupItem[]=databases.map((n,i)=>{
  const receipt=i===5?null:{ref:n.ref,state:'success' as const,backupAt:at-3600000,reportedAt:at-3000000,restored:true,bytes:2345000,sha256:null,source:'Copia de ejemplo',coverage:'Restauración local ficticia',drive:{state:'included' as const,reportedAt:at-2400000,period:'2026-10-13'}};
  return {ref:n.ref,name:n.name,resourceId:n.id,parentId:null,parentRef:null,type:n.type,status:n.status,healthSource:n.source,healthCheckedAt:at,healthStale:false,state:receipt?'restored':'unknown',latest:receipt,lastRestored:receipt,history:receipt?[receipt]:[]};
 });
 const copy={id:'demo-copy',bytes:250000,createdAt:at-3600000,finishedAt:at-3000000,state:'success',restored:true};
 const data:CoolifyState={
  connection:{url:'https://coolify.example.test',snapshot:snapshot('Coolify'),error:null,attempted:at,hasToken:true},integrations,collector:{enabled:true,heartbeat:at,error:null,intervalMs:60000},history:[],
  topology:{revision:'demo',nodes,edges,coverage:{nodeLimit:500,edgeLimit:500,manualLimit:100,omittedNodes:0,omittedEdges:0},scope:'local-inventory'},
  organization:{connectionRevision:'demo',projects,assignments:nodes.filter(n=>n.provider!=='Hostinger'&&n.provider!=='Cloudflare').map(n=>({ref:n.ref,projectId:`demo-project-${Number(n.id.split('-').at(-1))}`,tags:[],revision:'demo',updatedAt:at,missing:false,stale:false})),limits:{projects:50,annotations:500,tagsPerResource:8},scope:'local-organization'},
  incidents:{tracking:true,observing:true,delivery:'local-only',counts:{open:1,acknowledged:0,resolved:0,'monitoring-ended':0,reclassified:0},total:1,items:[{id:'demo-alert',revision:'demo',state:'open',payload:{findingId:'demo-db-health',provider:'Coolify',resourceId:'demo-db-2',probeId:null,title:'Clinic Demo · la base requiere revisión',detail:'Ejemplo: el proveedor reporta un contenedor running:unhealthy. El siguiente paso es revisar su lectura y registros antes de reiniciarlo.',severity:'warning',observedAt:at},firstSeen:at,lastSeen:at,acknowledgedAt:null,closedAt:null,closeReason:null,events:[]}]},
  resourceBackups:{sampledAt:at,expiresAt:at+300000,attemptedAt:at,status:'observed',error:null,items:backups,counts:{total:8,restored:7,attention:0,unknown:1},coverage:'Recibos ficticios para explorar el diseño'},
  backupProtection:{scope:'ConectadOS',r2:{configured:true,enabled:true,workerFresh:true,nextDue:at+86400000,lastVerified:copy,lastAttempt:copy,sourceByteLimit:64000000,byteLimit:64000000},drive:{configured:true,status:'verified',sampledAt:at,expiresAt:at+300000,worker:null,lastVerified:copy,history:[copy],totalAttempts:1,attemptedAt:at,error:null,pendingSourceAt:null,copyAgeLimitMs:172800000,source:'Ejemplo de diseño',coverage:'Réplica ficticia'}},
  hostTelemetry:{configured:true,status:'sampled',latest:{schema:1,agentVersion:'1',agentId:'demo-host',coolifyOrigin:'https://coolify.example.test',serverId:'demo-host',sampledAt:at,windowMs:60000,cpuCount:4,cpu:{workPercent:24,stealPercent:0,ioWaitPercent:0,reason:'Ejemplo'},memory:{totalBytes:16000000000,availableBytes:9280000000,swapTotalBytes:0,swapFreeBytes:0},disk:{path:'/',totalBytes:200000000000,freeBytes:150000000000,availableBytes:150000000000},load:[.4,.5,.6],uptimeSeconds:10000},history:[],error:null,attempted:at,observing:true,expiresAt:at+300000}
 };
 const host=data.integrations!.find(c=>c.provider==='Hostinger')!.snapshot!;
 Object.assign(host.resources[0],{plan:'KVM 4',cpuCount:4,memoryMB:16384,diskMB:204800,bandwidthMB:16384000,osTemplate:'Ubuntu 24.04 con Coolify · ejemplo',addresses:['192.0.2.10']});
 host.accountServers=[{id:'demo-host',name:'VPS de ejemplo'},{id:'demo-host-2',name:'VPS de pruebas · solo inventario'}];
 host.metrics=['cpu_usage','ram_usage','disk_space','incoming_traffic','outgoing_traffic'].map((name,j)=>({name,unit:j===0?'%':'bytes',points:Array.from({length:12},(_,i)=>({at:at-(11-i)*300000,value:j===0?24+Math.sin(i)*4:j===1?(42+Math.sin(i)*4)/100*16*1024**3:j===2?(25+Math.sin(i)*2)/100*200*1024**3:1000000+i*235000}))}));
 const cloud=data.integrations!.find(c=>c.provider==='Supabase')!.snapshot!;cloud.resources.forEach(r=>{r.databaseVersion='PostgreSQL 17.4 · ejemplo'});
 const domains=data.integrations!.find(c=>c.provider==='Cloudflare')!.snapshot!;
 domains.records=[{id:'demo-dns-1',zoneId:'demo-zone',name:'example.test',type:'A',value:'192.0.2.10',valueRedacted:false,proxied:true,ttl:1,priority:null},{id:'demo-dns-2',zoneId:'demo-zone',name:'atlas.example.test',type:'CNAME',value:'example.test',valueRedacted:false,proxied:true,ttl:1,priority:null},{id:'demo-dns-3',zoneId:'demo-zone',name:'clinic.example.test',type:'CNAME',value:'example.test',valueRedacted:false,proxied:true,ttl:1,priority:null},{id:'demo-dns-4',zoneId:'demo-zone',name:'example.test',type:'TXT',value:null,valueRedacted:true,proxied:false,ttl:3600,priority:null}];
 data.history=Array.from({length:10},(_,i)=>{const snap=snapshot('Coolify');snap.checkedAt=at-(9-i)*300000;snap.resources=snap.resources.map((r,n)=>({...r,status:n<[0,0,1,2,1,0,0,1,1,1][i]?(n===0?'exited':'running:unhealthy'):'running:healthy'}));return dashboardHistorySample(snap)});
 data.platforms={scope:'manual-register',limit:200,checkedAt:at,items:[{id:'00000000-0000-4000-8000-000000000001',name:'Resend',category:'email',accountUrl:'https://resend.com/overview',description:'Ejemplo de correo transaccional para aplicaciones.',projectId:'demo-project-0',revision:'demo',archived:false,createdAt:at,updatedAt:at},{id:'00000000-0000-4000-8000-000000000002',name:'GoHighLevel',category:'crm',accountUrl:'https://app.gohighlevel.com/',description:'Ejemplo de CRM y automatización. Conexión API pendiente.',projectId:null,revision:'demo',archived:false,createdAt:at,updatedAt:at}]};
 data.billing={items:[],totals:[],activeCount:0,unknownAmountCount:0,archivedCount:0,upcomingCount:0,pastDueCount:0,unknownRenewalCount:0,limit:500,checkedAt:at,coverage:'manual-register',projects:projects.map(p=>({id:p.id,name:p.name}))};
 data.billing.items=[['VPS de ejemplo','Hostinger','USD','18.00','contract'],['Correo de ejemplo','Resend','USD','5.00','estimate'],['CRM de ejemplo','Otro','EUR',null,'contract']].map(([label,provider,currency,amount,kind],i)=>({id:'demo-cost-'+i,label:label!,provider:provider!,currency:currency!,amount,periodMonths:1,kind:kind as 'contract'|'estimate',source:'Importe ficticio, no corresponde a tu factura',observedDate:'2026-10-13',renewalDate:'2026-11-01',renewalMode:'unknown',projectId:null,projectName:null,projectMissing:false,revision:'demo',archived:false,createdAt:at,updatedAt:at,stale:false,daysToRenewal:19}));
 data.billing.totals=[{currency:'USD',documentedMonthly:'18.000000',estimatedMonthly:'5.000000',recurringCount:2,documentedCount:1,estimatedCount:1,staleCount:0}];data.billing.activeCount=3;data.billing.unknownAmountCount=1;data.billing.upcomingCount=3;
 // Fictional component set for testing the explanatory resource UI.
 const parent:TopologyNode={ref:'demo-service-atlas',id:'demo-service-atlas',provider:'Coolify',kind:'resource',parentId:null,name:'atlas-supabase',type:'service',status:'running:healthy',source:'Ejemplo de diseño',checkedAt:at,stale:false};
 nodes.push(parent);data.connection!.snapshot!.resources.push({id:parent.id,name:parent.name,type:parent.type,status:parent.status});
 const components=['auth','storage','api-gw','rest'].map(name=>({id:'demo-component-'+name,name,type:'application' as const,status:'running:healthy',image:null,excludedFromStatus:false}));
 data.connection!.snapshot!.serviceDetails=[{serviceId:parent.id,components,source:'Ejemplo de diseño',checkedAt:at,expiresAt:at+300000,attemptedAt:at,error:null}];
 data.organization!.assignments.push({ref:parent.ref,projectId:'demo-project-0',tags:[],revision:'demo',updatedAt:at,missing:false,stale:false});
 for(const c of components){const ref='demo-ref-'+c.id;nodes.push({...parent,ref,id:c.id,name:c.name,type:c.type,kind:'component',parentId:parent.id});edges.push({id:'demo-contains-'+c.id,fromRef:ref,toRef:parent.ref,kind:'contained-in',origin:'observed',evidence:'Contención ficticia para revisar la interfaz',source:'Ejemplo de diseño',checkedAt:at,stale:false,missing:false,note:'',revision:'demo',createdAt:at,updatedAt:at})}
 return data;
}
