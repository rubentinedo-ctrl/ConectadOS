import {randomUUID} from 'node:crypto';
import {backupTables,backupWorkerIdentity} from './backup-settings.mjs';
import {runExternalBackup} from './external-backup.mjs';
const DAY=24*60*60*1000;
/** @param {import('./store.mjs').Store} db @param {{run?:typeof runExternalBackup,authorize?:()=>boolean}} options */
export async function automaticBackupTick(db,{run=runExternalBackup,authorize=()=>true}={}){
 backupTables(db);const now=Date.now();db.db.prepare('UPDATE backup_automation SET worker_at=? WHERE id=1').run(now);
 let policy=db.db.prepare('SELECT * FROM backup_automation WHERE id=1').get();
 if(policy.state==='running'){
  if(policy.run_expires>now)return {busy:true};
  // The durable external receipt is committed before any remote request. Only
  // an expired claim with no receipt can be retried, once, on this installation.
  db.db.exec('BEGIN IMMEDIATE');try{
   policy=db.db.prepare('SELECT * FROM backup_automation WHERE id=1').get();
   if(policy.state!=='running'||policy.run_expires>now){db.db.exec('COMMIT');return {busy:true}}
   // Compare durable insertion order, not wall-clock timestamps. Clock changes
   // and manual copies must never turn a possible upload into a safe retry.
   const latest=db.db.prepare('SELECT id FROM external_backup_runs ORDER BY rowid DESC LIMIT 1').get();
   const unchanged=(latest?.id??null)===policy.run_baseline_id;
   const destination=db.db.prepare('SELECT revision FROM backup_destination WHERE id=1').get();
   if(unchanged&&policy.enabled&&policy.last_result!=='retry-before-upload'&&policy.worker_hash&&backupWorkerIdentity(db)===policy.worker_hash&&destination?.revision===policy.destination_revision){
    db.db.prepare("UPDATE backup_automation SET state='waiting',last_result='retry-before-upload',next_due=?,run_owner=NULL,run_expires=NULL,error=NULL WHERE id=1").run(now);
    db.record('backup_automation_recovered_before_upload');db.db.exec('COMMIT');return {retryBeforeUpload:true};
   }
  db.db.prepare("UPDATE backup_automation SET enabled=0,state='uncertain',error='El trabajo anterior terminó sin resultado comprobado. Haz una copia manual y revisa antes de reactivar.',run_owner=NULL,run_expires=NULL WHERE id=1 AND revision=? AND state='running'").run(policy.revision);
  db.db.prepare("UPDATE external_backup_runs SET state='uncertain',error='El trabajador automático terminó sin resultado comprobado.' WHERE revision=? AND trigger='automatic' AND created>=? AND state IN ('preparing','uploaded')").run(policy.destination_revision,policy.last_attempt);db.record('backup_automation_interrupted');db.db.exec('COMMIT');return {paused:true};
  }catch(e){db.db.exec('ROLLBACK');throw e}
 }
 if(!policy.enabled)return {disabled:true};
 if(!policy.worker_hash||backupWorkerIdentity(db)!==policy.worker_hash){db.db.prepare("UPDATE backup_automation SET enabled=0,state='paused',error='Falta la identidad original del trabajador. Una copia restaurada no puede continuar la programación anterior. Revisa y activa desde esta instalación.' WHERE id=1 AND revision=?").run(policy.revision);return {paused:true}}if(policy.next_due>now)return {waiting:true};
 const destination=db.db.prepare('SELECT revision FROM backup_destination WHERE id=1').get();
 if(!destination||destination.revision!==policy.destination_revision){db.db.prepare("UPDATE backup_automation SET enabled=0,state='paused',error='Cambió el destino. Comprueba una copia y activa de nuevo la programación.' WHERE id=1 AND revision=?").run(policy.revision);return {paused:true}}
 const owner=randomUUID();
 db.db.exec('BEGIN IMMEDIATE');try{
  policy=db.db.prepare('SELECT * FROM backup_automation WHERE id=1').get();
  if(!policy.enabled||policy.state==='running'||policy.next_due>Date.now()){db.db.exec('COMMIT');return {busy:true}}
  if(db.db.prepare('SELECT expires FROM external_backup_lease WHERE id=1').get()?.expires>Date.now()){db.db.exec('COMMIT');return {busy:true}}
  if(db.db.prepare('SELECT revision FROM backup_destination WHERE id=1').get()?.revision!==policy.destination_revision){db.db.exec('COMMIT');return {changed:true}}
  const baseline=db.db.prepare('SELECT id FROM external_backup_runs ORDER BY rowid DESC LIMIT 1').get()?.id??null;
  db.db.prepare("UPDATE backup_automation SET state='running',last_attempt=?,next_due=?,error=NULL,run_owner=?,run_expires=?,run_baseline_id=? WHERE id=1").run(now,now+DAY,owner,now+180000,baseline);db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
 function authorized(){const p=db.db.prepare('SELECT enabled,revision,run_owner FROM backup_automation WHERE id=1').get();return authorize()&&p.enabled===1&&p.revision===policy.revision&&p.run_owner===owner&&backupWorkerIdentity(db)===policy.worker_hash}
 try{
  const result=await run(db,{expectedRevision:policy.destination_revision,authorize:authorized,trigger:'automatic'});
  if(!authorized())return {changed:true};
  const receipt=db.db.prepare('SELECT state,revision,trigger FROM external_backup_runs WHERE id=?').get(result.id);
  if(!result.restored||!result.downloadMatched||receipt?.state!=='verified'||receipt.revision!==policy.destination_revision||receipt.trigger!=='automatic')throw new Error('La copia no tiene comprobante de restauración.');
  const updated=db.db.prepare("UPDATE backup_automation SET state='waiting',last_finished=?,last_result='verified',last_run_id=?,error=NULL,run_owner=NULL,run_expires=NULL WHERE id=1 AND revision=? AND run_owner=?").run(Date.now(),result.id,policy.revision,owner);if(!updated.changes)return {changed:true};db.record('backup_automatic_verified');return {verified:true,id:result.id};
 }catch{
  const updated=db.db.prepare("UPDATE backup_automation SET enabled=0,state='paused',last_finished=?,last_result='unconfirmed',error='La copia no terminó comprobada. No se reintentará automáticamente. Revisa el resultado y realiza una copia manual antes de reactivar.',run_owner=NULL,run_expires=NULL WHERE id=1 AND revision=? AND run_owner=?").run(Date.now(),policy.revision,owner);if(updated.changes){db.record('backup_automatic_paused');return {paused:true}}return {changed:true};
 }
}
