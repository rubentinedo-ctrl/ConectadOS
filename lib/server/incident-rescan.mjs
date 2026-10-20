import {AppError} from './store.mjs';
import {refreshCoolify} from './collector.mjs';
import {refreshProvider} from './provider-collector.mjs';
import {refreshWebProbe} from './web-probes.mjs';
import {refreshHostTelemetry} from './host-telemetry.mjs';
import {refreshExternalObserver} from './external-observer.mjs';
import {refreshDriveStatus} from './drive-status.mjs';
import {refreshResourceBackups} from './resource-backups.mjs';
import {reconcileIncidents,incidentReport} from './incidents.mjs';
// Explicit read-only scan. Never enqueues mail, clears notification keys, starts a
// backup, activates monitoring or changes the observed resources.
/** @param {import('./store.mjs').Store} db @param {{authorized?:Function,refresh?:Function,readers?:Record<string,Function>}} options */
export async function rescanIncidents(db,{authorized=()=>true,refresh=async(provider,id)=>provider==='Coolify'?refreshCoolify(db,{force:true}):provider==='Web'?refreshWebProbe(db,id,{force:true}):refreshProvider(db,provider,{force:true}),readers={host:refreshHostTelemetry,observer:refreshExternalObserver,drive:refreshDriveStatus,backups:refreshResourceBackups}}={}){
 if(!incidentReport(db).tracking||!db.collectorStatus().enabled)throw new AppError('Activa el registro y el recolector antes de reescanear. No se cambiaron tus preferencias.',409);
 const lease=db.acquireProvider('_incident_rescan');if(!lease)throw new AppError('Ya hay un reescaneo en curso. Espera a que termine.',409);
 db.db.prepare('UPDATE provider_collection_lease SET expires=? WHERE provider=? AND owner=?').run(Date.now()+180000,'_incident_rescan',lease);
 const before=incidentReport(db).items.filter(i=>['open','acknowledged'].includes(i.state)),startedAt=Date.now(),checks=[];
 async function check(label,fn){try{const r=await fn();checks.push({source:label,state:r?.busy?'busy':r?.updated?'updated':r?.cached?'cached':'skipped'})}catch{checks.push({source:label,state:'failed'})}}
 try{
  const work=[];
  if(db.coolifyConnection()?.hasToken)work.push(check('Coolify',()=>refresh('Coolify')));
  for(const c of db.providerConnections())if(c.hasToken)work.push(check(c.provider,()=>refresh(c.provider)));
  for(const p of db.webProbes())if(p.enabled)work.push(check('Comprobación web',()=>refresh('Web',p.id)));
  if(db.coolifyConnection()?.hasToken)work.push(check('Servidor',()=>readers.host(db)));
  work.push(check('Observador externo',()=>readers.observer(db,{force:true})),check('Réplica Drive',()=>readers.drive(db,{passive:true})));
  await Promise.all(work);
  if(db.coolifyConnection()?.hasToken)await check('Evidencia de respaldos',()=>readers.backups(db));
  if(!authorized())throw new AppError('La sesión caducó durante la lectura. Vuelve a entrar.',401);
  const failed=checks.filter(c=>c.state==='failed'||c.state==='busy');
  db.collectorHeartbeat(failed.length?'El reescaneo no completó todas las lecturas. Revisa las conexiones.':null);
  reconcileIncidents(db);const report=incidentReport(db),after=new Map(report.items.map(i=>[i.id,i]));
  const archived=before.filter(i=>after.has(i.id)&&!['open','acknowledged'].includes(after.get(i.id).state)).length;
  db.record('incidents_rescanned');
  return {startedAt,finishedAt:Date.now(),archived,active:report.counts.open+report.counts.acknowledged,partial:failed.length>0,checks};
 }finally{db.releaseProvider('_incident_rescan',lease)}
}
