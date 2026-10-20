import {createHash,randomUUID} from 'node:crypto';
import {buildDiagnostics} from '../diagnostics.mjs';
import {observationStale,serviceDetailStale,applicationLifecycle} from '../observations.mjs';
import {AppError} from './store.mjs';
import {resourceBackupsReport} from './resource-backups.mjs';
import {billingReport} from './billing.mjs';
import {backupReport} from './backup-settings.mjs';
import {driveStatusReport} from './drive-status.mjs';
import {ownBackupHealth} from './own-backup-health.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function incidentContext(db,now=Date.now()){
 const collector=db.collectorStatus(),tracking=Boolean(db.db.prepare('SELECT enabled FROM incident_config WHERE id=1').get().enabled),monitoring=tracking&&collector.enabled;
 const connections=[...(db.coolifyConnection()?[{provider:'Coolify',...db.coolifyConnection()}]:[]),...db.providerConnections()],probes=db.webProbes(),scopes=new Map(),byProvider=new Map(),byProbe=new Map();
 const local=hash(['local',db.root]);scopes.set(local,{monitoring,fresh:collector.heartbeat!==null&&now-collector.heartbeat<=90000});
 for(const c of connections){if(!c.hasToken)continue;const scope=hash([c.provider,c.url??c.scope,db.credentialIdentity(c.provider)]);byProvider.set(c.provider,scope);scopes.set(scope,{monitoring,fresh:Boolean(c.snapshot)&&!observationStale(c,now),connection:c})}
 for(const p of probes){const scope=hash(['web',p.id,p.url]);byProbe.set(p.id,scope);scopes.set(scope,{monitoring:monitoring&&p.enabled,fresh:Boolean(p.snapshot&&now<=p.snapshot.expiresAt&&p.snapshot.httpStatus!==null),probe:p})}
 const report=buildDiagnostics({connection:connections.find(c=>c.provider==='Coolify')??null,integrations:connections.filter(c=>c.provider!=='Coolify'),collector,probes},now);
 const signals=monitoring?report.findings.flatMap(f=>{
  const probeId=f.id.startsWith('probe:')?f.id.split(':')[1]:null,scope=probeId?byProbe.get(probeId):f.provider?byProvider.get(f.provider):local;
  if(!scope||!scopes.get(scope)?.monitoring)return [];
  const payload={findingId:f.id,provider:f.provider??(probeId?'HTTPS':'Local'),resourceId:f.resourceId??null,probeId,title:f.title,detail:f.detail,severity:f.severity,observedAt:f.checkedAt??null};
  return [{scope,key:hash([scope,f.id]),signature:hash([payload.title,payload.detail,payload.severity]),payload}];
 }):[];
 const protection=resourceBackupsReport(db,{now});
 const own=backupReport(db),drive=driveStatusReport(db,{now});
 for(const item of ownBackupHealth(own,drive,now)){
  const scope=hash(['own-backup',own.revision,item.kind]);scopes.set(scope,{monitoring:monitoring&&item.monitoring,fresh:item.fresh});
  if(!monitoring||!item.monitoring||!item.problem)continue;
  const payload={findingId:'backup:conectados:'+item.kind,provider:'Local',resourceId:null,probeId:null,title:item.title,detail:item.detail,severity:'warning',observedAt:now};
  signals.push({scope,key:hash([scope,payload.findingId]),signature:hash([item.kind,item.problem]),payload});
 }
 for(const item of protection.items){
  const scope=hash(['backup',byProvider.get('Coolify'),item.ref]);scopes.set(scope,{monitoring,fresh:protection.status==='observed'&&!item.healthStale&&item.state!=='working'&&item.state!=='unknown'});
  if(!monitoring||!['failed','overdue'].includes(item.state))continue;
  const payload={findingId:'backup:'+item.ref,provider:'Coolify',resourceId:null,probeId:null,title:item.state==='failed'?'El último intento de respaldo informó un fallo':'Una base tiene una copia anterior a 25 horas',detail:'Revisa Protección de tus bases. La lectura no inicia una copia; una restauración anterior no acredita la recuperación de una copia nueva.',severity:'warning',observedAt:protection.sampledAt};
  signals.push({scope,key:hash([scope,payload.findingId]),signature:hash([item.state,item.latest?.backupAt]),payload});
 }
 for(const item of billingReport(db,{now}).items.filter(i=>!i.archived&&i.periodMonths>0)){
  const scope=hash(['renewal',item.id]);scopes.set(scope,{monitoring,fresh:!item.stale&&item.daysToRenewal!==null});
  if(!monitoring||item.stale||item.daysToRenewal===null||item.daysToRenewal>30)continue;
  const band=item.daysToRenewal<0?'past':item.daysToRenewal<=1?'one':item.daysToRenewal<=7?'seven':'thirty';
  const payload={findingId:'renewal:'+item.id,provider:item.provider,resourceId:null,probeId:null,title:band==='past'?'La fecha de renovación registrada ya pasó':`Renovación registrada en ${band==='one'?'un día o menos':band==='seven'?'siete días o menos':'treinta días o menos'}`,detail:`Fecha declarada: ${item.renewalDate}. Fuente: registro manual revisado el ${item.observedDate}. Revisa Costos y renovaciones; no acredita pago, impago ni renovación automática.`,severity:'warning',observedAt:Date.parse(item.observedDate+'T00:00:00Z')};
  signals.push({scope,key:hash([scope,payload.findingId]),signature:hash([item.renewalDate,band]),payload});
 }
 if(signals.length>10000)throw new AppError('El registro excede 10.000 observaciones por ciclo. Se conservaron los avisos anteriores.',503);
 return {tracking,monitoring,scopes,signals};
}
function event(db,id,kind,now){db.db.prepare('INSERT INTO incident_events(incident_id,event,created) VALUES(?,?,?)').run(id,kind,now);db.db.prepare('DELETE FROM incident_events WHERE incident_id=? AND id NOT IN (SELECT id FROM incident_events WHERE incident_id=? ORDER BY id DESC LIMIT 100)').run(id,id)}
export function reconcileIncidents(db,{now=Date.now()}={}){
 db.db.exec('BEGIN IMMEDIATE');try{
  const context=incidentContext(db,now),active=db.db.prepare("SELECT * FROM incidents WHERE state IN ('open','acknowledged')").all(),byKey=new Map(active.map(r=>[r.incident_key,r])),keys=new Set(context.signals.map(s=>s.key));
  for(const signal of context.signals){
   const old=byKey.get(signal.key),value=JSON.stringify(signal.payload);
   if(!old){const id=randomUUID();db.db.prepare('INSERT INTO incidents VALUES(?,?,?,?,?,?,?, ?,NULL,NULL,NULL)').run(id,signal.key,signal.scope,'open',signal.signature,value,now,now);event(db,id,'opened',now);db.record('incident_opened')}
   else if(old.signature!==signal.signature){db.db.prepare("UPDATE incidents SET state='open',signature=?,payload=?,last_seen=?,acknowledged=NULL WHERE id=?").run(signal.signature,value,now,old.id);event(db,old.id,'changed',now);db.record('incident_changed')}
   else db.db.prepare('UPDATE incidents SET payload=?,last_seen=? WHERE id=?').run(value,now,old.id);
  }
  for(const row of active){if(keys.has(row.incident_key))continue;const scope=context.scopes.get(row.scope),payload=JSON.parse(row.payload);let state,reason;
   if(!scope||!scope.monitoring){state='monitoring-ended';reason=!context.monitoring?'El seguimiento o los avisos se pausaron. No acredita recuperación.':'La conexión o la dirección cambió o se retiró. No acredita recuperación.'}
   else if(payload.resourceId&&!scope.connection?.snapshot?.resources.some(r=>r.id===payload.resourceId)&&scope.fresh){state='monitoring-ended';reason='El recurso ya no figura en el inventario observado. No acredita recuperación.'}
   else{
    const resource=scope.connection?.snapshot?.resources.find(r=>r.id===payload.resourceId);
    if(scope.fresh&&scope.connection?.provider==='Coolify'&&payload.findingId==='Coolify:'+payload.resourceId&&applicationLifecycle(resource,scope.connection.snapshot,now)){
     state='reclassified';reason='Reclasificada como preparada: una lectura actual confirma cero despliegues registrados. No se ejecutó una reparación ni se acredita recuperación.';
    }else{
    let verified=scope.fresh;
    if(payload.findingId.startsWith('components-'))verified=verified&&Boolean(scope.connection?.snapshot?.serviceDetails?.some(d=>d.serviceId===payload.resourceId&&!serviceDetailStale(d,now)));
    if(payload.findingId.endsWith(':certificate'))verified=verified&&Number.isSafeInteger(scope.probe?.snapshot?.certificateExpiresAt);
    if(!verified)continue;
    state='resolved';reason='La advertencia dejó de aparecer en una lectura actual. No acredita el funcionamiento completo de la aplicación.';
    }
   }
   db.db.prepare('UPDATE incidents SET state=?,closed=?,last_seen=?,close_reason=? WHERE id=?').run(state,now,now,reason,row.id);event(db,row.id,state,now);db.record(state==='resolved'?'incident_resolved':state==='reclassified'?'incident_reclassified':'incident_monitoring_ended');
  }
  db.db.prepare("DELETE FROM incidents WHERE state IN ('resolved','monitoring-ended','reclassified') AND closed<?").run(now-30*86400000);
  db.db.exec("DELETE FROM incidents WHERE state IN ('resolved','monitoring-ended','reclassified') AND id NOT IN (SELECT id FROM incidents WHERE state IN ('resolved','monitoring-ended','reclassified') ORDER BY closed DESC LIMIT 5000)");
  db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function incidentReport(db,{now=Date.now()}={}){
 const context=incidentContext(db,now),scopes=[...context.scopes.keys()],placeholders=scopes.map(()=>'?').join(','),counts={open:0,acknowledged:0,resolved:0,'monitoring-ended':0,reclassified:0};
 for(const r of db.db.prepare(`SELECT state,COUNT(*) n FROM incidents WHERE scope IN (${placeholders}) GROUP BY state`).all(...scopes))counts[r.state]=r.n;
 const pending=db.db.prepare(`SELECT id,signature FROM incidents WHERE scope IN (${placeholders}) AND state='open' ORDER BY id`).all(...scopes);
 const rows=[
  ...db.db.prepare(`SELECT * FROM incidents WHERE scope IN (${placeholders}) AND state='open' ORDER BY first_seen DESC,id LIMIT 200`).all(...scopes),
  ...db.db.prepare(`SELECT * FROM incidents WHERE scope IN (${placeholders}) AND state='acknowledged' ORDER BY acknowledged DESC,id LIMIT 200`).all(...scopes),
  ...db.db.prepare(`SELECT * FROM incidents WHERE scope IN (${placeholders}) AND state IN ('resolved','monitoring-ended','reclassified') ORDER BY closed DESC,id LIMIT 200`).all(...scopes),
 ];
 const items=rows.map(r=>({id:r.id,revision:r.signature,state:r.state,payload:JSON.parse(r.payload),firstSeen:r.first_seen,lastSeen:r.last_seen,acknowledgedAt:r.acknowledged,closedAt:r.closed,closeReason:r.close_reason,events:db.db.prepare('SELECT event,created FROM incident_events WHERE incident_id=? ORDER BY id DESC LIMIT 20').all(r.id).map(e=>({event:e.event,at:e.created}))}));
 return {inboxRevision:hash(pending),tracking:context.tracking,observing:context.monitoring,delivery:'local-only',counts,total:Object.values(counts).reduce((sum,n)=>sum+n,0),items};
}
export function acknowledgeIncident(db,id,{now=Date.now(),revision=''}={}){
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new AppError('Aviso no válido.');
 db.db.exec('BEGIN IMMEDIATE');try{const row=db.db.prepare('SELECT * FROM incidents WHERE id=?').get(id),context=incidentContext(db,now);if(!row||!context.scopes.has(row.scope))throw new AppError('Aviso no disponible para esta conexión.',404);if(!['open','acknowledged'].includes(row.state))throw new AppError('El aviso ya está cerrado.',409);if(typeof revision!=='string'||revision!==row.signature)throw new AppError('El aviso cambió. Revisa su contenido actual antes de reconocerlo.',409);if(row.state==='open'){db.db.prepare("UPDATE incidents SET state='acknowledged',acknowledged=? WHERE id=?").run(now,id);event(db,id,'acknowledged',now);db.record('incident_acknowledged')}db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
}
export function configureIncidentTracking(db,enabled){if(typeof enabled!=='boolean')throw new AppError('Indica si deseas registrar avisos nuevos.');db.db.prepare('UPDATE incident_config SET enabled=? WHERE id=1').run(Number(enabled));db.record(enabled?'incident_tracking_enabled':'incident_tracking_disabled')}

// Clear the inbox, never the observations: acknowledged warnings continue to be monitored.
/** @param {import('./store.mjs').Store} db @param {{revision?:unknown,now?:number}} options */
export function clearIncidentInbox(db,{revision,now=Date.now()}={}){
 if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw new AppError('Vuelve a cargar las alertas antes de limpiarlas.',409);
 db.db.exec('BEGIN IMMEDIATE');try{
  const report=incidentReport(db,{now});if(report.inboxRevision!==revision)throw new AppError('Las alertas cambiaron. Revisa la lista nueva antes de limpiarla.',409);
  const context=incidentContext(db,now),scopes=[...context.scopes.keys()],marks=scopes.map(()=>'?').join(',');
  const rows=db.db.prepare(`SELECT id FROM incidents WHERE scope IN (${marks}) AND state='open' ORDER BY id`).all(...scopes);
  for(const row of rows){db.db.prepare("UPDATE incidents SET state='acknowledged',acknowledged=? WHERE id=?").run(now,row.id);event(db,row.id,'inbox-cleared',now)}
  if(rows.length)db.record('incident_inbox_cleared');db.db.exec('COMMIT');return rows.length;
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
/** @param {import('./store.mjs').Store} db @param {unknown} id @param {{revision?:unknown,now?:number}} options */
export function restoreIncidentToInbox(db,id,{revision,now=Date.now()}={}){
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||typeof revision!=='string')throw new AppError('Alerta no válida.');
 db.db.exec('BEGIN IMMEDIATE');try{const row=db.db.prepare('SELECT * FROM incidents WHERE id=?').get(id),context=incidentContext(db,now);
 if(!row||!context.scopes.has(row.scope))throw new AppError('Alerta no disponible para esta conexión.',404);
 if(row.state!=='acknowledged'||row.signature!==revision)throw new AppError('La alerta cambió. Vuelve a cargarla.',409);
 db.db.prepare("UPDATE incidents SET state='open',acknowledged=NULL WHERE id=?").run(id);event(db,id,'inbox-restored',now);db.record('incident_inbox_restored');db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
