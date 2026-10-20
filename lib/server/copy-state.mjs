import {recoverObserver} from './observer-config.mjs';
import {backupTables} from './backup-settings.mjs';
import {recoverOperations} from './operations.mjs';
import {recoverDriveStatus} from './drive-status.mjs';
import {randomUUID} from 'node:crypto';
import {recoverEmailRecovery} from './email-recovery.mjs';
export function pauseCopiedEffects(db,event){
 backupTables(db);recoverOperations(db);recoverObserver(db);recoverDriveStatus(db);recoverEmailRecovery(db);db.db.exec('BEGIN IMMEDIATE');try{
  db.db.prepare("UPDATE backup_automation SET enabled=0,revision=?,state='disabled',next_due=NULL,worker_at=NULL,run_owner=NULL,run_expires=NULL,error=NULL WHERE id=1").run(randomUUID());
  db.db.exec('UPDATE collector_config SET enabled=0,heartbeat=NULL,error=NULL');
  db.db.prepare('UPDATE notification_config SET enabled=0,test_identity=NULL,test_accepted=NULL,generation=?,started=NULL,muted_until=NULL').run(randomUUID());
  db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error='Copia aislada: envío pendiente detenido; resultado anterior conservado.' WHERE state IN ('queued','sending')").run();
  db.record(event);db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
