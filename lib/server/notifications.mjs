import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './store.mjs';
import {incidentContext} from './incidents.mjs';
import {effectiveNotificationConfig,notificationPolicy,notificationCategories,notificationProviders,setNotificationActivation,notificationEligibility,recordNotificationIntent,notificationCategory,notificationIntervalReady} from './notification-policy.mjs';
import {emailAddress,sendResend} from './resend.mjs';
const hour=3600000,day=24*hour,windowMs=20*hour;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config=effectiveNotificationConfig;
function ready(db,c){return Boolean(c.sender&&c.recipient&&db.hasCredential('Resend')&&c.test_accepted&&c.test_identity===db.credentialIdentity('Resend'))}
function cancelQueued(db,reason){db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error=? WHERE state='queued' AND kind='warning'").run(reason)}
export function notificationReport(db,{now=Date.now()}={}){
 const c=config(db),counts={queued:0,sending:0,accepted:0,failed:0,uncertain:0,cancelled:0};
 for(const row of db.db.prepare('SELECT state,COUNT(*) n FROM notification_outbox GROUP BY state').all())counts[row.state]=row.n;
 const used=db.db.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE first_attempt>=?').get(now-day).n;
 const policy=notificationPolicy(db);return {policy:{categories:policy.categories,providers:policy.providers,minimumMinutes:policy.minimumMinutes,intervalMinutes:policy.intervalMinutes,repeatHours:policy.repeatHours,maxPerDay:policy.maxPerDay,revision:policy.revision,configured:policy.configured,categoriesAvailable:notificationCategories,providersAvailable:notificationProviders},provider:'Resend',revision:c.generation,sender:c.sender,recipient:c.recipient,includeDetails:Boolean(c.include_details),dailyLimit:c.daily_limit,enabled:Boolean(c.enabled),hasToken:db.hasCredential('Resend'),ready:ready(db,c),testAcceptedAt:c.test_accepted,testNeedsRenewal:!ready(db,c),mutedUntil:c.muted_until,observing:db.collectorStatus().enabled,remainingToday:Math.max(0,Math.min(c.daily_limit,policy.maxPerDay)-used),counts,deliveries:db.db.prepare('SELECT id,kind,state,created,attempts,accepted,error,generation FROM notification_outbox ORDER BY created DESC,id LIMIT 50').all().map(r=>({id:r.id,currentConfiguration:r.generation===c.generation,kind:r.kind,state:r.state,createdAt:r.created,attempts:r.attempts,acceptedAt:r.accepted,error:r.error})),scope:'local-process'};
}
export function configureNotifications(db,{sender,recipient,includeDetails,dailyLimit,revision}){
 sender=emailAddress(sender);recipient=emailAddress(recipient);
 if(typeof includeDetails!=='boolean'||!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new AppError('Indica el contenido y un límite de 1 a 100 correos por 24 horas.');
 db.db.exec('BEGIN IMMEDIATE');try{const c=config(db);if(revision!==c.generation)throw new AppError('La configuración cambió. Vuelve a cargarla antes de guardar.',409);if(c.sender!==sender||c.recipient!==recipient||c.include_details!==Number(includeDetails)||c.daily_limit!==dailyLimit){db.db.prepare('UPDATE notification_config SET sender=?,recipient=?,include_details=?,daily_limit=?,enabled=0,generation=?,started=NULL,muted_until=NULL,test_identity=NULL,test_accepted=NULL WHERE id=1').run(sender,recipient,Number(includeDetails),dailyLimit,randomUUID());cancelQueued(db,'La configuración de correo cambió.');db.record('notification_configured')}db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
}
export function activateNotifications(db,enabled,{now=Date.now(),revision=''}={}){
 if(typeof enabled!=='boolean')throw new AppError('Indica si deseas activar los avisos por correo.');
 db.db.exec('BEGIN IMMEDIATE');try{const c=config(db);if(enabled&&revision!==c.generation)throw new AppError('La configuración cambió. Revisa el destinatario antes de activar.',409);if(enabled&&!ready(db,c))throw new AppError('Primero guarda una clave limitada de Resend y comprueba el correo de prueba con esta configuración.',409);if(Boolean(c.enabled)!==enabled){setNotificationActivation(db,enabled,c,now);if(!enabled)cancelQueued(db,'Los avisos por correo se desactivaron.');db.record(enabled?'notification_enabled':'notification_disabled')}db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
}
export function muteNotifications(db,minutes,{now=Date.now()}={}){
 if(!Number.isInteger(minutes)||minutes<0||minutes>10080)throw new AppError('Silencio no válido; máximo siete días.');
 db.db.exec('BEGIN IMMEDIATE');try{db.db.prepare('UPDATE notification_config SET muted_until=? WHERE id=1').run(minutes?now+minutes*60000:null);if(minutes)cancelQueued(db,'Los avisos por correo se silenciaron.');db.record(minutes?'notification_muted':'notification_unmuted');db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
}
function insert(db,c,{dedupKey,incidentId=null,revision=null,kind,text,now,category=null}){
 if(db.db.prepare('SELECT dedup_key FROM notification_seen WHERE dedup_key=?').get(dedupKey))return null;
 if(db.db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE state IN ('queued','sending')").get().n>=500)throw new AppError('La cola de correo está llena. Los avisos locales se conservan.',409);
 const id=randomUUID(),body=JSON.stringify({from:c.sender,to:[c.recipient],subject:kind==='test'?'ConectadOS · prueba de correo':'ConectadOS · '+(notificationCategories[category]??'advertencia para revisar'),text});
 db.db.prepare('INSERT INTO notification_outbox(id,dedup_key,generation,credential_identity,incident_id,revision,kind,payload,created,expires,next_attempt) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,dedupKey,c.generation,db.credentialIdentity('Resend'),incidentId,revision,kind,body,now,now+windowMs,now);
 db.db.prepare('INSERT INTO notification_seen VALUES(?,?,?,?)').run(dedupKey,incidentId,c.generation,now);db.record('notification_queued');return id;
}
export function enqueueTestNotification(db,clientId,{now=Date.now(),revision=''}={}){
 if(typeof clientId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId))throw new AppError('Identificador de prueba no válido.');
 db.db.exec('BEGIN IMMEDIATE');try{const c=config(db);if(revision!==c.generation)throw new AppError('La configuración cambió. Revisa el destinatario antes de probar.',409);if(!c.sender||!c.recipient||!db.hasCredential('Resend'))throw new AppError('Guarda remitente, destinatario y una clave limitada de Resend.',409);const dedupKey=hash([c.generation,db.credentialIdentity('Resend'),'test',clientId]);const old=db.db.prepare('SELECT id FROM notification_outbox WHERE dedup_key=?').get(dedupKey);const id=old?.id??insert(db,c,{dedupKey,kind:'test',text:'Esta es una prueba solicitada desde ConectadOS. No contiene nombres de recursos, direcciones de infraestructura ni credenciales.\n\nQue Resend la acepte no confirma su recepción. Comprueba tu bandeja de entrada antes de activar los avisos.\n\nEl seguimiento actual depende de que el proceso local esté abierto.',now});db.db.exec('COMMIT');return id}catch(e){db.db.exec('ROLLBACK');throw e}
}
export function enqueueNotifications(db,{now=Date.now()}={}){
 db.db.exec('BEGIN IMMEDIATE');try{const c=config(db),context=incidentContext(db,now);let added=0;
 if(c.enabled&&ready(db,c)&&!(c.muted_until>now)&&context.monitoring){
  const current=new Map(context.signals.map(s=>[s.key,s]));
  for(const row of db.db.prepare("SELECT * FROM incidents WHERE state='open'").all()){
   const signal=current.get(row.incident_key);if(!signal||signal.signature!==row.signature||signal.payload.severity!=='warning')continue;
   const change=db.db.prepare("SELECT MAX(created) at FROM incident_events WHERE incident_id=? AND event IN ('opened','changed')").get(row.id).at;
   if(change<c.started||!notificationEligibility(db,c,signal,row,now))continue;
   const p=signal.payload;
   const text=['ConectadOS · '+notificationCategories[notificationCategory(p)]+'.',`Proveedor: ${p.provider}.`,`Lectura de origen: ${p.observedAt?new Date(p.observedAt).toISOString():'sin fecha confirmada'}.`,c.include_details?`\nRecurso u observación: ${p.title}\n${p.detail}`:'\nEl contenido de la infraestructura se mantiene fuera de este correo. Abre el panel privado para ver el detalle.','\nLa advertencia conserva su alcance y fecha. No demuestra una caída general ni una causa concreta. El seguimiento actual depende del proceso local.'].join('\n');
   const dedupKey=hash([c.generation,db.credentialIdentity('Resend'),row.id,row.signature]);if(db.db.prepare('SELECT dedup_key FROM notification_seen WHERE dedup_key=?').get(dedupKey))continue;
   if(db.db.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE state IN ('queued','sending')").get().n>=500)break;
   const id=insert(db,c,{dedupKey,incidentId:row.id,revision:row.signature,kind:'warning',text,now,category:notificationCategory(p)});if(id){recordNotificationIntent(db,id,signal,c.policy);added++}
  }
 }
 db.db.prepare("DELETE FROM notification_outbox WHERE state NOT IN ('queued','sending') AND created<?").run(now-30*day);
 db.db.prepare('DELETE FROM notification_seen WHERE generation!=? OR (incident_id IS NULL AND created<?)').run(c.generation,now-30*day);
 db.db.exec('COMMIT');return {added};
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
function warningCurrent(db,row,c,now,context){
 if(!c.enabled||!ready(db,c)||c.muted_until>now)return false;
 if(!context?.monitoring)return false;
 const incident=db.db.prepare('SELECT * FROM incidents WHERE id=?').get(row.incident_id);
 return Boolean(incident?.state==='open'&&incident.signature===row.revision&&context.signals.some(s=>s.key===incident.incident_key&&s.signature===row.revision&&notificationEligibility(db,c,s,incident,now,{delivery:row})));
}
export async function deliverNotifications(db,{send=sendResend,now=Date.now(),onlyId=''}={}){
 const lease=db.acquireProvider('_notification_delivery');if(!lease)return {busy:true};let row;
 try{
  db.db.exec('BEGIN IMMEDIATE');try{
   const c=config(db),identity=db.credentialIdentity('Resend'),context=c.enabled&&ready(db,c)&&!(c.muted_until>now)?incidentContext(db,now):null;
   db.db.prepare("UPDATE notification_outbox SET state='queued',lease_until=NULL WHERE state='sending' AND lease_until<=?").run(now);
   db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'failed' END,error='La ventana de reintentos terminó. No se enviará otra solicitud.' WHERE state='queued' AND expires<=?").run(now);
   db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error='Cambió la configuración o el acceso de correo; no se harán más intentos.' WHERE state='queued' AND (generation!=? OR credential_identity!=?)").run(c.generation,identity??'');
   const pending=db.db.prepare("SELECT * FROM notification_outbox WHERE state='queued' AND next_attempt<=? AND (?='' OR id=?) ORDER BY created,id LIMIT 500").all(now,onlyId,onlyId);
   for(const candidate of pending){if(candidate.kind==='warning'&&!warningCurrent(db,candidate,c,now,context)){db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error='La advertencia cambió, se reconoció, dejó de observarse o se pausó el canal; no se harán más intentos.' WHERE id=?").run(candidate.id);continue}if(candidate.kind==='warning'&&candidate.first_attempt===null&&!notificationIntervalReady(db,c,now,candidate.id))continue;row=candidate;break}
   if(row){const used=db.db.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE first_attempt>=?').get(now-day).n;if(row.first_attempt===null&&used>=Math.min(c.daily_limit,c.policy.maxPerDay)){row=null}else{db.db.prepare("UPDATE notification_outbox SET state='sending',attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),lease_until=? WHERE id=?").run(now,now+35000,row.id)}}
   db.db.exec('COMMIT');
  }catch(e){db.db.exec('ROLLBACK');throw e}
  if(!row)return {idle:true};
  // Capture the credential under the same write lock as the final eligibility check.
  // An already dispatched request can finish; a claimed row must never use a new key.
  let token,dispatch=false;
  db.db.exec('BEGIN IMMEDIATE');try{
   const identity=db.credentialIdentity('Resend');
   if(identity===row.credential_identity)token=db.credential('Resend');
   const c=config(db),current=db.db.prepare('SELECT state FROM notification_outbox WHERE id=?').get(row.id);
   dispatch=Boolean(token&&identity===row.credential_identity&&db.credentialIdentity('Resend')===identity&&c.generation===row.generation&&current?.state==='sending'&&(row.kind==='test'||warningCurrent(db,row,c,now,incidentContext(db,now))));
   if(!dispatch){db.db.prepare("UPDATE notification_outbox SET state=?,attempts=?,first_attempt=?,lease_until=NULL,error='La configuración, el acceso o el aviso cambió antes del envío; no se harán más intentos.' WHERE id=?").run(row.attempts?'uncertain':'cancelled',row.attempts,row.first_attempt,row.id);db.record('notification_cancelled_before_send')}
   db.db.exec('COMMIT');
  }catch(e){db.db.exec('ROLLBACK');throw e}
  if(!dispatch)return {cancelled:true};
  let result;try{result=await send(token,row.payload,'conectados/'+row.id)}catch(e){result={accepted:false,retryable:false,ambiguous:!(e instanceof AppError),error:e instanceof AppError?'La configuración o el correo no permiten enviar.':'No se pudo confirmar el resultado del envío.'}}
  const finishedAt=Date.now();
  db.db.exec('BEGIN IMMEDIATE');try{
   if(result.accepted){db.db.prepare("UPDATE notification_outbox SET state='accepted',accepted=?,provider_id=?,error=NULL,lease_until=NULL WHERE id=?").run(finishedAt,result.providerId,row.id);const c=config(db);if(row.kind==='test'&&c.generation===row.generation&&db.credentialIdentity('Resend')===row.credential_identity)db.db.prepare('UPDATE notification_config SET test_identity=?,test_accepted=? WHERE id=1').run(row.credential_identity,finishedAt);db.record('notification_accepted')}
   else{
    const attempts=row.attempts+1,retry=Boolean(result.retryable&&attempts<4&&finishedAt<row.expires),state=retry?'queued':result.ambiguous?'uncertain':'failed';
    const message=['No se pudo confirmar la respuesta de Resend.','Resend rechazó el acceso. Revisa la clave limitada y el dominio remitente.','Resend alcanzó su límite de solicitudes o cuota.','Resend no pudo confirmar el envío.','Resend rechazó el correo. Revisa remitente, destinatario y verificación del dominio.','La respuesta de Resend no permite confirmar el envío.','Resend devolvió una respuesta vacía.','La respuesta de Resend excedió el límite.','No se pudo leer la confirmación de Resend.','Otro intento del mismo correo sigue en curso.','Resend detectó un conflicto con el correo preparado. No se creó otra solicitud.','Resend respondió sin una confirmación válida.','La configuración o el correo no permiten enviar.','No se pudo confirmar el resultado del envío.'].includes(result.error)?result.error:'No se pudo confirmar el resultado del envío.';
    db.db.prepare('UPDATE notification_outbox SET state=?,error=?,next_attempt=?,lease_until=NULL WHERE id=?').run(state,message,finishedAt+Math.max(60000,Math.min(3600000,result.retryAfterMs??60000*2**row.attempts)),row.id);db.record(retry?'notification_retry_scheduled':state==='uncertain'?'notification_uncertain':'notification_failed');
   }
   db.db.exec('COMMIT');
  }catch(e){db.db.exec('ROLLBACK');throw e}
  return {processed:true,accepted:Boolean(result.accepted)};
 }finally{db.releaseProvider('_notification_delivery',lease)}
}
