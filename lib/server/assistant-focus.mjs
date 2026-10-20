import {createHash} from 'node:crypto';
import {AppError} from './store.mjs';
import {inventoryCatalog,topologyReport} from './topology.mjs';
import {organizationReport} from './organization.mjs';
import {declaredState} from '../observations.mjs';
import {resourceBackupsReport,anonymousBackupEvidence} from './resource-backups.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const resourceLimit=16,linkLimit=16,targetLimit=100;
const types=new Set(['application','service','database','standalone-postgresql','standalone-mysql','standalone-mariadb','standalone-mongodb','standalone-redis','standalone-clickhouse','standalone-keydb','standalone-dragonfly','zone','project','server','vps','A','AAAA','CNAME','TXT','MX','NS','SRV','CAA','PTR','SOA','HTTPS','SVCB','DNSKEY','DS','NAPTR','TLSA']);
const focused=scope=>scope==='resource'||scope==='project';
export const isAssistantFocus=focused;
function read(db,fn){db.db.exec('SAVEPOINT assistant_focus');try{const result=fn();db.db.exec('RELEASE assistant_focus');return result}catch(e){db.db.exec('ROLLBACK TO assistant_focus; RELEASE assistant_focus');throw e}}
function selection(db,{scope,target},now){
 if(!focused(scope)||typeof target!=='string'||(scope==='resource'?!/^[a-f0-9]{64}$/.test(target):!/^[a-f0-9-]{36}$/.test(target)))throw new AppError('Selecciona un recurso o proyecto del inventario actual.');
 const catalog=inventoryCatalog(db,now),organization=organizationReport(db,{now});
 const project=scope==='project'?organization.projects.find(p=>p.id===target):null;
 if(scope==='project'&&!project)throw new AppError('El proyecto seleccionado ya no está disponible.',409);
 if(scope==='resource'&&!catalog.byRef.has(target))throw new AppError('El recurso seleccionado ya no está disponible en esta conexión.',409);
 const assignments=scope==='project'?organization.assignments.filter(a=>a.projectId===target):[];
 const directRefs=new Set(scope==='resource'?[target]:assignments.map(a=>a.ref));
 const refs=new Set([...directRefs].filter(ref=>catalog.byRef.has(ref)));
 // Only observed containment expands a selection. DNS matches and declarations never pull in unrelated resources.
 const children=new Map();for(const e of catalog.edges)if(e.kind==='contained-in'){if(!children.has(e.toRef))children.set(e.toRef,[]);children.get(e.toRef).push(e.fromRef)}
 const queue=[...refs];for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])??[])if(!refs.has(child)){refs.add(child);queue.push(child)}
 const nodes=[...refs].map(ref=>catalog.byRef.get(ref)).sort((a,b)=>Number(directRefs.has(b.ref))-Number(directRefs.has(a.ref))||a.ref.localeCompare(b.ref));
 const topology=topologyReport(db,{now}),edges=topology.edges.filter(e=>refs.has(e.fromRef)||refs.has(e.toRef));
 const excluded=new Set();const c=db.coolifyConnection();for(const d of c?.snapshot?.serviceDetails??[])for(const r of d.components??[])if(r.excludedFromStatus){const n=nodes.find(n=>n.provider==='Coolify'&&n.kind==='component'&&n.parentId===d.serviceId&&n.id===r.id);if(n)excluded.add(n.ref)}
 const fingerprint=hash({scope,target,connection:organization.connectionRevision,projectRevision:project?.revision??null,assignments:assignments.map(a=>[a.ref,a.revision,a.missing]).sort(),nodes:nodes.map(n=>[n.ref,n.name,n.kind,n.type,excluded.has(n.ref)]),edges:edges.map(e=>[e.id,e.fromRef,e.toRef,e.kind,e.origin,e.revision,e.missing]).sort()});
 return {scope,target,binding:fingerprint,catalog,nodes,edges,refs,directRefs,assignments,excluded};
}

// Private selector metadata is returned to the owner's UI; it is never part of a model prompt.
/** @param {import('./store.mjs').Store} db @param {{scope?:unknown,query?:unknown,now?:number}} options */
export function assistantTargets(db,{scope='resource',query='',now=Date.now()}={}){
 if(!focused(scope)||typeof query!=='string'||query.length>100)throw new AppError('Búsqueda no válida. Usa hasta 100 caracteres.');
 return read(db,()=>{
  const c=inventoryCatalog(db,now),o=organizationReport(db,{now}),q=query.trim().normalize('NFC').toLocaleLowerCase('es');
  const rows=scope==='project'?o.projects.map(p=>({target:p.id,name:p.name,kind:'project',provider:'Organización local',assigned:o.assignments.filter(a=>a.projectId===p.id).length})):c.nodes.map(n=>({target:n.ref,name:n.name,kind:n.kind,type:n.type,provider:n.provider,checkedAt:n.checkedAt,stale:n.stale}));
  const matches=rows.filter(r=>!q||[r.name,r.provider,r.kind,r.type??''].join(' ').normalize('NFC').toLocaleLowerCase('es').includes(q)).sort((a,b)=>a.name.localeCompare(b.name)||a.target.localeCompare(b.target));
  return {scope,query,items:matches.slice(0,targetLimit),total:matches.length,omitted:Math.max(0,matches.length-targetLimit),catalogOmitted:c.omittedNodes,limit:targetLimit,checkedAt:now,localOnly:true};
 });
}
export function assistantSelectionBinding(db,value,now=Date.now()){
 if(value===null)return null;
 return read(db,()=>selection(db,value,now).binding);
}

export function focusedAssistantObservation(db,{scope,target,now=Date.now()}={}){
 return read(db,()=>{
  const s=selection(db,{scope,target},now),included=s.nodes.slice(0,resourceLimit),aliases=new Map(included.map((n,i)=>[n.ref,'R'+(i+1)])),sources=[],protection=resourceBackupsReport(db,{now}),backups=new Map(protection.items.map(i=>[i.ref,i]));
  const push=data=>sources.push({id:'S'+(sources.length+1),...data});
  const missing=s.assignments.filter(a=>a.missing).length;
  push({provider:'Organización local',kind:'selection',checkedAt:now,stale:false,directCount:s.directRefs.size,observedCount:s.nodes.length,containedCount:s.nodes.filter(n=>!s.directRefs.has(n.ref)).length,missingCount:missing,staleCount:s.nodes.filter(n=>n.stale).length,omittedResources:s.nodes.length-included.length,catalogOmitted:s.catalog.omittedNodes,coverage:'Selección local y pertenencias observadas; no implica dependencias ni salud.'});
  for(const n of included){const state=n.lifecycle?.state==='prepared'&&!n.stale&&now<=n.lifecycle.expiresAt?'prepared':declaredState(n.status).key;push({provider:n.provider,kind:'resource',alias:aliases.get(n.ref),resourceKind:n.kind,resourceType:types.has(n.type)?n.type:'other',checkedAt:n.checkedAt,stale:n.stale,states:n.kind==='dns'?undefined:{[state]:1},excludedFromStatus:s.excluded.has(n.ref),...(backups.has(n.ref)?{backup:anonymousBackupEvidence(backups.get(n.ref)),...(backups.get(n.ref).latest?{backupSampledAt:protection.sampledAt,backupStale:protection.status!=='observed'}:{})}:{}),coverage:n.kind==='dns'?'Configuración DNS observada; no comprueba destino, HTTPS ni aplicación.':'Estado declarado por API; sin prueba de transacciones ni versión ejecutada.'})}
  // Rich backup proofs share the same context budget; omissions remain explicit.
  while(included.length>1&&Buffer.byteLength(JSON.stringify(sources))>7000){const removed=included.pop();aliases.delete(removed.ref);sources.pop()}
  sources[0].omittedResources=s.nodes.length-included.length;
  const availableLinks=s.edges.filter(e=>aliases.has(e.fromRef)&&aliases.has(e.toRef)&&!e.missing);
  const links=availableLinks.slice(0,linkLimit).map(e=>({from:aliases.get(e.fromRef),to:aliases.get(e.toRef),kind:e.kind,origin:e.origin,checkedAt:e.checkedAt,stale:e.stale}));
  push({provider:'Inventario y declaraciones locales',kind:'relations',checkedAt:now,stale:s.edges.some(e=>e.stale),links,outsideSelectionCount:s.edges.filter(e=>!s.refs.has(e.fromRef)||!s.refs.has(e.toRef)).length,missingEndpointCount:s.edges.filter(e=>e.missing).length,omittedLinks:s.edges.length-links.length,catalogOmitted:s.catalog.omittedEdges,coverage:'Observada: relación de inventario, no disponibilidad. Declarada: asociación del administrador, sin comprobación del proveedor. No demuestra causa ni impacto real.'});
  const pulse=db.collectorStatus(),context={asOf:now,scope,localOnly:true,collector:{enabled:pulse.enabled,heartbeat:pulse.heartbeat??null,recent:Boolean(pulse.heartbeat&&now-pulse.heartbeat<90000)},sources,omittedSources:s.nodes.length-included.length,limits:'Referencias de conexión y asignaciones locales; solo hijos contenidos observados. Hasta 16 recursos/relaciones. Sin costos, sondas, logs ni transacciones. Copia/restauración local según comprobantes fechados; Drive no acredita recuperación externa por versión. Sin nombres, dominios, IP, identificadores, notas ni claves. Fechas locales no prueban frescura del proveedor.'};
  return {context,selection:{scope,target,binding:s.binding},labels:included.map(n=>({alias:aliases.get(n.ref),name:n.name,provider:n.provider,kind:n.kind}))};
 });
}
