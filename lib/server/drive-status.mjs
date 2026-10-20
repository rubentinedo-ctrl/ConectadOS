import {open,constants} from 'node:fs/promises';
import {AppError} from './store.mjs';
import {backupTables,backupDestination,backupEncryptionKey,backupHash,backupWorkerIdentity,backupAutomationReport} from './backup-settings.mjs';
import {assertNoAssistantSecrets} from './assistant.mjs';
import {randomUUID} from 'node:crypto';

const file='/drive-status/status.json',ttl=180000,copyAge=25*3600000;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,digest=/^[a-f0-9]{64}$/;
export const driveStatusEnabled=()=>process.env.CONECTADOS_DRIVE_STATUS==='1';
function tables(db){backupTables(db);db.db.exec('CREATE TABLE IF NOT EXISTS drive_status_state(binding TEXT PRIMARY KEY,payload TEXT,observed INTEGER,attempted INTEGER,error TEXT,lease TEXT,lease_expires INTEGER)')}
export function driveSourceBinding(db,{historical=false}={}){
 backupTables(db);const destination=historical?db.db.prepare('SELECT revision,key_hash FROM backup_destination WHERE id=1').get():backupDestination(db),owner=db.db.prepare('SELECT * FROM owner').get();
 if(!destination||!owner)throw new AppError('Configura y comprueba el destino de respaldos.',409);
 const keyHash=historical?destination.key_hash:backupHash(backupEncryptionKey(db));if(!digest.test(keyHash))throw new AppError('No se puede vincular el historial de respaldos.',409);
 const sourceBinding=backupHash(Buffer.from(JSON.stringify({owner:backupHash(Buffer.from(JSON.stringify(owner))),vault:backupHash(db.key),backupKey:keyHash,destination:destination.revision})));
 return {sourceBinding,revision:destination.revision};
}
function binding(db,{active=true}={}){
 const source=driveSourceBinding(db),runtimeIdentity=backupWorkerIdentity(db),worker=db.db.prepare('SELECT worker_hash FROM backup_automation WHERE id=1').get();
 if(!runtimeIdentity||active&&worker?.worker_hash!==runtimeIdentity)throw new AppError('Revisa la vinculación del lector después de instalar o recuperar ConectadOS.',409);
 return {...source,runtimeIdentity,active:worker?.worker_hash===runtimeIdentity,scope:backupHash(Buffer.from(JSON.stringify([source.sourceBinding,runtimeIdentity])))};
}
const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
function normalizeReceipt(raw,now){
 if(!raw||!uuid.test(raw.id)||!digest.test(raw.digest)||!integer(raw.bytes,1,64*1024*1024+48)||!integer(raw.created,1,now+30000)||!integer(raw.started,raw.created,now+30000)||raw.finished!==null&&!integer(raw.finished,raw.started,now+30000)||!['preparing','uploading','verified','failed','uncertain'].includes(raw.state)||typeof raw.restored!=='boolean'||raw.restored!==(raw.state==='verified')||raw.state==='verified'&&raw.finished===null)throw Error('Invalid receipt');
 return {id:raw.id,digest:raw.digest,bytes:raw.bytes,created:raw.created,started:raw.started,finished:raw.finished,state:raw.state,restored:raw.restored};
}
export function normalizeDriveStatus(raw,{now=Date.now()}={}){
 try{
  if(!raw||raw.schema!==1||!digest.test(raw.sourceBinding)||!digest.test(raw.runtimeIdentity)||!digest.test(raw.destinationIdentity)||!integer(raw.observedAt,1,now+30000)||now-raw.observedAt>ttl||!integer(raw.totalAttempts,0,512)||!Array.isArray(raw.receipts)||raw.receipts.length>30||raw.receipts.length!==Math.min(raw.totalAttempts,30))throw Error();
  const w=raw.worker;if(!w||typeof w.enabled!=='boolean'||typeof w.timerActive!=='boolean'||!['waiting','preparing','uploading','paused','failed','uncertain'].includes(w.state)||!['idle','running','failed'].includes(w.serviceState)||!integer(w.exitCode,0,255)||w.heartbeat!==null&&!integer(w.heartbeat,1,raw.observedAt+30000))throw Error();
  const receipts=raw.receipts.map(r=>normalizeReceipt(r,raw.observedAt)),lastVerified=raw.lastVerified===null?null:normalizeReceipt(raw.lastVerified,raw.observedAt);
  if(new Set(receipts.map(r=>r.id)).size!==receipts.length||lastVerified&&!lastVerified.restored||receipts.some(r=>r.restored&&(!lastVerified||r.created>lastVerified.created))||lastVerified&&receipts.some(r=>r.id===lastVerified.id&&JSON.stringify(r)!==JSON.stringify(lastVerified)))throw Error();
  return {schema:1,sourceBinding:raw.sourceBinding,runtimeIdentity:raw.runtimeIdentity,destinationIdentity:raw.destinationIdentity,observedAt:raw.observedAt,totalAttempts:raw.totalAttempts,worker:{enabled:w.enabled,timerActive:w.timerActive,state:w.state,serviceState:w.serviceState,exitCode:w.exitCode,heartbeat:w.heartbeat},receipts,lastVerified};
 }catch{throw new AppError('El informe de Drive no es válido o está vencido. Se conserva la lectura anterior con su fecha.',502)}
}
export async function readDriveStatus({opener=open}={}){
 let handle;try{handle=await opener(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await handle.stat();if(!info.isFile()||info.size>32768||info.uid!==0||info.gid!==1000||(info.mode&0o777)!==0o640)throw Error();const buffer=Buffer.alloc(32769);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>32768||bytesRead!==info.size)throw Error();return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'))}catch{throw new AppError('No se pudo leer el informe privado de Drive. Revisa su montaje y el publicador del host.',502)}finally{await handle?.close()}
}
function verifySources(db,sample,b){
 if(sample.sourceBinding!==b.sourceBinding||sample.runtimeIdentity!==b.runtimeIdentity)throw new AppError('El informe de Drive pertenece a otra instalación o activación de respaldos.',409);
 for(const receipt of [...sample.receipts,...(sample.lastVerified?[sample.lastVerified]:[])]){
  const source=db.db.prepare("SELECT id,created,bytes,digest FROM external_backup_runs WHERE id=? AND revision=? AND state='verified'").get(receipt.id,b.revision);
  if(!source||source.created!==receipt.created||source.bytes!==receipt.bytes||source.digest!==receipt.digest)throw new AppError('El recibo Drive no coincide con una copia R2 comprobada de esta instalación.',409);
 }
}
export async function refreshDriveStatus(db,{enabled=driveStatusEnabled(),read=readDriveStatus,now=Date.now,passive=false}={}){
 if(!enabled)return {disabled:true};tables(db);if(!db.collectorStatus().enabled||!backupAutomationReport(db).enabled){if(passive)return {paused:true};throw new AppError('La lectura de Drive está pausada. Revisa observación y programación antes de activarla.',409)}
 const b=binding(db),at=now(),lease=randomUUID();db.db.prepare('INSERT OR IGNORE INTO drive_status_state(binding) VALUES(?)').run(b.scope);
 const got=db.db.prepare('UPDATE drive_status_state SET lease=?,lease_expires=? WHERE binding=? AND (lease IS NULL OR lease_expires<=?)').run(lease,at+15000,b.scope,at);if(!got.changes)return {busy:true};
 try{
  const sample=normalizeDriveStatus(await read(),{now:now()});verifySources(db,sample,b);assertNoAssistantSecrets(db,JSON.stringify(sample));
  const old=db.db.prepare('SELECT observed,payload FROM drive_status_state WHERE binding=?').get(b.scope);
  if(old.observed!==null&&(sample.observedAt<old.observed||sample.observedAt===old.observed&&JSON.stringify(sample)!==old.payload))throw new AppError('El publicador devolvió una lectura anterior o cambió su contenido sin nueva fecha.',409);
  const current=binding(db);if(current.scope!==b.scope||!db.collectorStatus().enabled||!backupAutomationReport(db).enabled||now()>at+15000||db.db.prepare('SELECT lease FROM drive_status_state WHERE binding=?').get(b.scope)?.lease!==lease)throw new AppError('La vinculación o lectura cambió durante la consulta de Drive.',409);
  db.db.prepare('UPDATE drive_status_state SET payload=?,observed=?,attempted=?,error=NULL WHERE binding=? AND lease=?').run(JSON.stringify(sample),sample.observedAt,now(),b.scope,lease);return {updated:true};
 }catch(e){const message=e instanceof AppError?e.message:'No se pudo comprobar el informe del exportador de Drive.';try{if(binding(db).scope===b.scope)db.db.prepare('UPDATE drive_status_state SET attempted=?,error=? WHERE binding=? AND lease=?').run(now(),message,b.scope,lease)}catch{}throw new AppError(message,e instanceof AppError?e.status:502)}
 finally{db.db.prepare('UPDATE drive_status_state SET lease=NULL,lease_expires=NULL WHERE binding=? AND lease=?').run(b.scope,lease)}
}
const publicReceipt=r=>r?{id:r.id,bytes:r.bytes,createdAt:r.created,startedAt:r.started,finishedAt:r.finished,state:r.state,restored:r.restored}:null;
export function driveStatusReport(db,{enabled=driveStatusEnabled(),now=Date.now()}={}){
 tables(db);const base={configured:enabled,status:enabled?'unbound':'unconfigured',sampledAt:null,expiresAt:null,worker:null,lastVerified:null,history:[],totalAttempts:0,attemptedAt:null,error:null,pendingSourceAt:null,copyAgeLimitMs:copyAge,source:'Exportador Linux · recibos privados de solo lectura',coverage:'Solo ConectadOS. Descarga y restauración aislada en el VPS en la fecha del recibo. Un pulso no comprueba permisos actuales ni una recuperación en otra máquina. Vista: últimos 30 intentos; sin borrados.'};let b;
 let row,historical=false;
 try{b=binding(db,{active:false});row=db.db.prepare('SELECT * FROM drive_status_state WHERE binding=?').get(b.scope)}catch{
  try{const source=driveSourceBinding(db,{historical:true});row=db.db.prepare("SELECT * FROM drive_status_state WHERE json_extract(payload,'$.sourceBinding')=? ORDER BY observed DESC LIMIT 1").get(source.sourceBinding);historical=true}catch{return base}
 }
 let sample;try{sample=row?.payload?normalizeDriveStatus(JSON.parse(row.payload),{now:row.observed}):null}catch{base.status='error';base.error='El informe conservado no es válido. Revisa la copia y su integridad.';return base}
 if(sample){base.sampledAt=sample.observedAt;base.expiresAt=sample.observedAt+ttl;base.worker=sample.worker;base.lastVerified=publicReceipt(sample.lastVerified);base.history=sample.receipts.map(publicReceipt);base.totalAttempts=sample.totalAttempts}
 base.attemptedAt=row?.attempted??null;base.error=row?.error??null;
 if(!enabled)base.status='unconfigured';else if(historical)base.status='unbound';else if(!db.collectorStatus().enabled||!backupAutomationReport(db).enabled)base.status='paused';else if(!b?.active)base.status='unbound';else if(!sample)base.status=row?.error?'error':'waiting';else if(now>sample.observedAt+ttl||sample.observedAt>now+30000)base.status='stale';else if(row.error)base.status='error';else if(sample.worker.serviceState==='failed'||sample.worker.exitCode||sample.worker.state==='failed')base.status='failed';else if(sample.worker.state==='uncertain'||['uploading','preparing'].includes(sample.worker.state)&&sample.worker.serviceState!=='running')base.status='uncertain';else if(!sample.worker.enabled||!sample.worker.timerActive||sample.worker.state==='paused')base.status='paused';else if(!sample.worker.heartbeat||now-sample.worker.heartbeat>ttl||sample.worker.heartbeat>now+30000)base.status='stale';else if(['uploading','preparing'].includes(sample.worker.state))base.status='working';else{
  const latest=db.db.prepare("SELECT id,created,finished FROM external_backup_runs WHERE revision=? AND state='verified' ORDER BY created DESC LIMIT 1").get(b.revision);
  if(latest&&sample.lastVerified?.id!==latest.id){base.pendingSourceAt=latest.created;base.status=now-latest.finished<=300000?'pending':'lagging'}else if(!sample.lastVerified)base.status='unverified';else if(now-sample.lastVerified.created>copyAge)base.status='overdue';else base.status='verified';
 }
 return base;
}
export function recoverDriveStatus(db){tables(db);db.db.exec('UPDATE drive_status_state SET lease=NULL,lease_expires=NULL')}
