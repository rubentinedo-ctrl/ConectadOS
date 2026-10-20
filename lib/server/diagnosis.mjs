import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {topologyReport} from './topology.mjs';
import {organizationReport} from './organization.mjs';
import {resourceLabels} from '../resource-labels.mjs';
import {declaredState,applicationLifecycle} from '../observations.mjs';
import {refreshCoolify} from './collector.mjs';
import {collectCoolify} from './coolify.mjs';
import {refreshProvider} from './provider-collector.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Store the established conservative state for older releases. Current readers
// project the additional classification; returning to old code cannot imply health.
function encodeReport(report){return {...report,...(report.state==='prepared'?{state:'unknown',classification:'prepared'}:{}),checks:report.checks.map(c=>({...c,...(c.state==='prepared'?{state:'unknown',classification:'prepared'}:{})}))}}
function decodeReport(report){return {...report,...(report.state==='unknown'&&report.classification==='prepared'?{state:'prepared'}:{}),checks:report.checks.map(c=>({...c,...(c.state==='unknown'&&c.classification==='prepared'?{state:'prepared'}:{})}))}}
function tables(db){db.db.exec('CREATE TABLE IF NOT EXISTS diagnostic_runs(id TEXT PRIMARY KEY,binding TEXT NOT NULL,created INTEGER NOT NULL,report TEXT NOT NULL); CREATE INDEX IF NOT EXISTS diagnostic_binding ON diagnostic_runs(binding,created);')}
function selection(db,input){
 if(!['resource','project'].includes(input?.scope)||typeof input.target!=='string'||input.target.length>100)throw new AppError('Selecciona una aplicación o un recurso del inventario.');
 const topology=topologyReport(db),organization=organizationReport(db),nodes=topology.nodes,refs=new Set();let name,revision=null,missing=false;
 if(input.scope==='project'){
  const p=organization.projects.find(p=>p.id===input.target);if(!p)throw new AppError('La aplicación ya no está disponible.',404);name=p.name;revision=p.revision;
  for(const a of organization.assignments)if(a.projectId===p.id){if(a.missing)missing=true;else refs.add(a.ref)}
 }else{const n=nodes.find(n=>n.ref===input.target);if(!n)throw new AppError('El recurso o su conexión cambiaron. Vuelve al mapa.',409);refs.add(n.ref);name=n.name}
 for(let changed=true;changed;){changed=false;for(const e of topology.edges)if(e.kind==='contained-in'&&e.origin==='observed'&&!e.missing&&refs.has(e.toRef)&&!refs.has(e.fromRef)){refs.add(e.fromRef);changed=true}}
 const members=nodes.filter(n=>refs.has(n.ref)&&n.kind!=='dns');
 if(!members.length||members.length>100)throw new AppError('Selecciona de uno a cien recursos. Divide las aplicaciones grandes antes de diagnosticar.',409);
 const data={topology,organization},labels=resourceLabels(data);
 if(input.scope==='resource')name=labels.get(input.target)?.name??name;
 // References include credential identity and connection scope. Project revision prevents
 // comparing runs across edited assignments, even if their displayed names match.
 return {name,members,labels,missing,binding:hash([db.ownerStamp(),input.scope,input.target,revision,members.map(n=>n.ref).sort()])};
}
export function diagnosticHistory(db,input){tables(db);const s=selection(db,input);return {name:s.name,runs:db.db.prepare('SELECT report FROM diagnostic_runs WHERE binding=? AND created>=? ORDER BY created DESC,rowid DESC LIMIT 10').all(s.binding,Date.now()-30*86400000).map(r=>decodeReport(JSON.parse(r.report)))}}
export function compareChecks(checks,previous){
 return checks.map(c=>{const old=previous?.checks.find(p=>p.key===c.key),failureAt=old?.state==='fail'?old.checkedAt:old?.failureAt??null;return {...c,reclassified:c.state==='prepared'&&old?.state==='fail',recovered:c.state==='pass'&&old?.state!=='prepared'&&failureAt!==null&&c.checkedAt>failureAt,failureAt:c.state==='fail'?c.checkedAt:c.state==='unknown'?failureAt:null}});
}
/** @returns {boolean} */
function defaultAuthorization(){return true}
export async function runDiagnosis(db,input,{refresh=async(provider,ids)=>provider==='Coolify'?refreshCoolify(db,{force:true,collect:(url,token,options)=>collectCoolify(url,token,{...options,detailIds:ids})}):refreshProvider(db,provider,{force:true}),authorize=defaultAuthorization,now=Date.now}={}){
 tables(db);const before=selection(db,input),lease=db.acquireProvider('_diagnosis');if(!lease)throw new AppError('Hay un diagnóstico en curso. Espera a que termine.',409);
 const startedAt=now(),providers=[...new Set(before.members.map(n=>n.provider))],results=new Map(),busyProviders=new Set();
 try{
  await Promise.all(providers.map(async p=>{try{const ids=[...new Set(before.members.filter(n=>n.provider===p).map(n=>n.parentId??n.id))];const result=await refresh(p,ids);results.set(p,result?.updated===true);if(result?.busy)busyProviders.add(p)}catch{results.set(p,false)}}));
  if(!authorize())throw new AppError('La sesión caducó durante el diagnóstico. Vuelve a entrar.',401);
  const after=selection(db,input);if(before.binding!==after.binding)throw new AppError('La selección o su conexión cambió durante la lectura. Repite el diagnóstico desde el mapa.',409);
  const connections=[{provider:'Coolify',...db.coolifyConnection()},...db.providerConnections()],checks=[];
  for(const n of after.members){
   const c=connections.find(c=>c.provider===n.provider),detail=n.kind==='component'?c?.snapshot?.serviceDetails?.find(d=>d.serviceId===n.parentId):null;
   const fresh=results.get(n.provider)===true&&!n.stale&&n.checkedAt>=startedAt&&!c?.error&&(!detail||!detail.error),declared=declaredState(n.status),prepared=n.provider==='Coolify'&&n.kind==='resource'&&applicationLifecycle(c?.snapshot?.resources.find(r=>r.id===n.id),c?.snapshot,now());
   const excluded=input.scope==='project'||n.ref!==input.target?detail?.components.find(x=>x.id===n.id)?.excludedFromStatus===true:false;
   const state=!fresh?'unknown':excluded?'excluded':prepared?'prepared':['warning','stopped'].includes(declared.key)?'fail':declared.key==='healthy'?'pass':'unknown';
   checks.push({key:n.ref,name:after.labels.get(n.ref)?.name??n.name,provider:n.provider,state,reportedStatus:fresh?n.status:null,checkedAt:fresh?n.checkedAt:null,source:prepared?'GET /api/v1/resources + GET /api/v1/deployments/applications/{uuid}':n.provider==='Coolify'?(n.kind==='component'?'GET /api/v1/services/{uuid}':'GET /api/v1/resources'):'API de '+n.provider,
    finding:!fresh?'No se obtuvo una lectura nueva verificable; el dato anterior no confirma recuperación.':excluded?'Componente excluido del estado agregado en Coolify.':prepared?'Preparada · sin desplegar: cero despliegues registrados en Coolify.':declared.label,
    nextStep:busyProviders.has(n.provider)?'Otra lectura del proveedor está en curso. Espera y vuelve a comprobar.':!fresh?'Revisa acceso, permisos y disponibilidad del proveedor; vuelve a comprobar.':state==='prepared'?'Pendiente de lanzamiento. La publicación requiere aprobación; no se inicia desde el diagnóstico.':state==='fail'?(declared.key==='stopped'?'Confirma si la detención es intencional. Si debe estar activo, revisa sus registros antes de aprobar un reinicio.':'Revisa el healthcheck y los registros del componente para identificar la causa; cualquier reparación requiere aprobación.'):'No se ha ejecutado una reparación.'});
  }
  if(after.missing)checks.push({key:'missing-assignment',name:'Recursos asignados ausentes',provider:'Organización local',state:'unknown',checkedAt:null,source:'Asignaciones por referencia',finding:'Una parte de la aplicación ya no aparece en el inventario. No se confirma su recuperación.',nextStep:'Revisa la asignación del recurso ausente antes de dar la aplicación por verificada.'});
  const previous=db.db.prepare('SELECT report FROM diagnostic_runs WHERE binding=? AND created>=? ORDER BY created DESC,rowid DESC LIMIT 1').get(after.binding,startedAt-30*86400000),compared=compareChecks(checks,previous?decodeReport(JSON.parse(previous.report)):null),finishedAt=now();
  const report={id:randomUUID(),name:after.name,startedAt,finishedAt,previousAt:previous?JSON.parse(previous.report).finishedAt:null,state:compared.some(c=>c.state==='fail')?'warning':compared.some(c=>c.state==='unknown')||!compared.some(c=>['pass','prepared'].includes(c.state))?'unknown':compared.some(c=>c.state==='prepared')?'prepared':'clear',checks:compared,
   limits:'Solo lectura de estados declarados por el proveedor. Identifica el componente afectado; no determina la causa raíz sin registros. No consulta SQL, archivos, sesiones ni transacciones. Una recuperación confirma únicamente que el fallo observado en la comprobación anterior con fallo ya no aparece. No ejecuta reparaciones, reinicios, correos ni llamadas de IA.'};
  db.db.exec('BEGIN IMMEDIATE');try{
   db.db.prepare('INSERT INTO diagnostic_runs VALUES(?,?,?,?)').run(report.id,after.binding,finishedAt,JSON.stringify(encodeReport(report)));
   db.db.prepare('DELETE FROM diagnostic_runs WHERE created<?').run(finishedAt-30*86400000);
   db.db.exec('DELETE FROM diagnostic_runs WHERE id NOT IN (SELECT id FROM diagnostic_runs ORDER BY created DESC,rowid DESC LIMIT 1000)');
   db.record('diagnosis_read_only');db.db.exec('COMMIT');
  }catch(e){db.db.exec('ROLLBACK');throw e}
  return {name:after.name,runs:[report,...diagnosticHistory(db,input).runs.filter(r=>r.id!==report.id)].slice(0,10)};
 }finally{db.releaseProvider('_diagnosis',lease)}
}
