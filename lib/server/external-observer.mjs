import {randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {observerConnection,observerScope,observerKey,observerTables} from './observer-config.mjs';
import {readExport} from '../../deploy/observer/lib/client.mjs';
import {recoverExport} from '../../deploy/observer/lib/recovery.mjs';
import {report} from '../../deploy/observer/lib/monitor.mjs';
import {assertNoAssistantSecrets} from './assistant.mjs';
import {readMailReport,validateMailReport} from '../../deploy/observer/lib/mail-reader.mjs';
function normalize(value,connection,db,now){
 if(!value||typeof value.text!=='string')throw new AppError('Informe externo no compatible.',502);
 assertNoAssistantSecrets(db,value.text);const recovered=recoverExport(value.text),raw=JSON.parse(value.text);
 if(recovered.config.hash!==connection.configurationHash||raw.exportedAt>now+30000||now-raw.exportedAt>120000)throw new AppError('La configuración o la fecha del observador cambió. Revisa su origen.',409);
 return {backupVersion:1,exportedAt:raw.exportedAt,configuration:raw.configuration,state:recovered.state};
}
function normalizeMail(value,db,now){
 if(!value||typeof value.text!=='string'||Buffer.byteLength(value.text)>32768)throw new AppError('Estado de correo externo no compatible.',502);
 assertNoAssistantSecrets(db,value.text);return validateMailReport(JSON.parse(value.text),{now});
}
function mailObservation(db,connection,scope,{now,observing,coreStatus}){
 const cached=scope?db.db.prepare('SELECT payload,attempted,error FROM observer_mail_reader_state WHERE scope=?').get(scope):null;
 let value=null,error=cached?.error??null;try{if(cached?.payload)value=validateMailReport(JSON.parse(cached.payload),{now:cached.attempted??now})}catch{error='El estado de correo guardado no es compatible. Revisa el observador.'}
 const status=!connection.hasKey?'unconfigured':!connection.mailReadEnabled?'disabled':!observing?'paused':error?'error':!value?'waiting':coreStatus!=='observed'||cached.attempted===null||cached.attempted>now+30000||now-cached.attempted>180000||value.status==='muted'&&value.mutedUntil<=now?'stale':'observed';
 return {status,attempted:cached?.attempted??null,error,source:connection.hasKey?connection.url+'/api/mail-report':null,report:value};
}
export function externalObserverReport(db,{now=Date.now()}={}){
 observerTables(db);const connection=observerConnection(db),scope=observerScope(db),state=scope?db.db.prepare('SELECT payload,attempted,error FROM observer_reader_state WHERE scope=?').get(scope):null;
 const observing=connection.enabled&&connection.activated&&db.collectorStatus().enabled;
 let observation=null;
 if(state?.payload){const saved=JSON.parse(state.payload),recovered=recoverExport(state.payload);observation=report(recovered.state,recovered.config,now);observation.exportedAt=saved.exportedAt;}
 const status=!connection.hasKey?'unconfigured':!observing?'paused':state?.error?'error':!observation?'waiting':observation.status==='stale'||state.attempted>now+30000||now-state.attempted>180000?'stale':'observed';
 if(observation&&status!=='observed')observation={...observation,status:'stale',targets:observation.targets.map(t=>({...t,current:'unknown'}))};
 return {connection,status,observing,attempted:state?.attempted??null,error:state?.error??null,source:connection.hasKey?connection.url+'/api/export':null,observation,mail:mailObservation(db,connection,scope,{now,observing,coreStatus:status}),coverage:'Observador independiente en Vercel. HTTPS HEAD público; no prueba acceso, transacciones ni estado interno de las bases. Lector local cada minuto; cron externo según el intervalo informado. La política de correo y sus resultados se consultan por separado; un evento no acredita envío ni recepción.'};
}
export async function refreshExternalObserver(db,{read=readExport,readMail=readMailReport,now=Date.now,force=false}={}){
 observerTables(db);const connection=observerConnection(db);if(!connection.hasKey)return {unconfigured:true};if(!connection.enabled||!connection.activated)return {paused:true};
 const scope=observerScope(db),at=now(),revision=connection.revision,lease=randomUUID();db.db.prepare('INSERT OR IGNORE INTO observer_reader_state(scope) VALUES(?)').run(scope);
 const prior=db.db.prepare('SELECT attempted FROM observer_reader_state WHERE scope=?').get(scope);if(!force&&prior.attempted!==null&&at-prior.attempted<55000)return {cached:true};
 if(!db.db.prepare('UPDATE observer_reader_state SET lease=?,lease_expires=? WHERE scope=? AND (lease IS NULL OR lease_expires<=?)').run(lease,at+20000,scope,at).changes)return {busy:true};
 const stillCurrent=()=>observerScope(db)===scope&&observerConnection(db).revision===revision&&db.db.prepare('SELECT lease FROM observer_reader_state WHERE scope=?').get(scope)?.lease===lease&&now()<=at+20000;
 try{
  const reader={url:connection.url,readSecret:observerKey(db)},requests=await Promise.allSettled([read(reader),...(connection.mailReadEnabled?[readMail(reader)]:[])]);
  if(requests[0].status==='rejected')throw requests[0].reason;
  const value=normalize(requests[0].value,connection,db,now());
  if(!stillCurrent())throw new AppError('La conexión del observador cambió durante la lectura.',409);
  const previous=db.db.prepare('SELECT payload FROM observer_reader_state WHERE scope=?').get(scope)?.payload;
  if(previous){const old=JSON.parse(previous);if((value.state.lastAttemptAt??0)<(old.state.lastAttemptAt??0)||(value.state.completedAt??0)<(old.state.completedAt??0))throw new AppError('El observador devolvió una lectura anterior. Se conserva la evidencia guardada.',409);
   if(value.state.completedAt!==null&&value.state.completedAt===old.state.completedAt&&JSON.stringify([value.state.history,value.state.targets,value.state.events])!==JSON.stringify([old.state.history,old.state.targets,old.state.events]))throw new AppError('El historial externo cambió sin una ronda nueva.',409);}
  let mailStatus='disabled',metadata=null,mailError=null;if(connection.mailReadEnabled){try{if(requests[1].status==='rejected')throw requests[1].reason;metadata=normalizeMail(requests[1].value,db,now());mailStatus='observed'}catch{mailError='No se pudo validar el estado del correo externo. Se conserva su historial anterior.';mailStatus='error'}}
  db.db.exec('BEGIN IMMEDIATE');try{
   if(!stillCurrent())throw new AppError('La conexión del observador cambió durante la lectura.',409);
   db.db.prepare('UPDATE observer_reader_state SET payload=?,attempted=?,error=NULL WHERE scope=? AND lease=?').run(JSON.stringify(value),now(),scope,lease);
   if(connection.mailReadEnabled)db.db.prepare('INSERT INTO observer_mail_reader_state(scope,payload,attempted,error) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET payload=COALESCE(excluded.payload,observer_mail_reader_state.payload),attempted=excluded.attempted,error=excluded.error').run(scope,metadata?JSON.stringify(metadata):null,now(),mailError);
   db.db.exec('COMMIT');
  }catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}
  return {updated:true,...(connection.mailReadEnabled?{mailStatus}:{})};
 }catch(e){if(stillCurrent())db.db.prepare('UPDATE observer_reader_state SET attempted=?,error=? WHERE scope=? AND lease=?').run(now(),'No se pudo validar la lectura externa. Se conserva el historial anterior.',scope,lease);throw e instanceof AppError?e:new AppError('No se pudo validar la lectura externa. Revisa dirección, acceso, certificado y configuración.',502)}
 finally{db.db.prepare('UPDATE observer_reader_state SET lease=NULL,lease_expires=NULL WHERE scope=? AND lease=?').run(scope,lease)}
}
