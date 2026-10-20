import {backupReport} from './backup-settings.mjs';
import {driveStatusReport} from './drive-status.mjs';
export function backupProtectionReport(db,options={}){
 const r2=backupReport(db),receipt=run=>run?{id:run.id,createdAt:run.created,finishedAt:run.finished,bytes:run.bytes,state:run.state,trigger:run.trigger}:null;
 const verified=db.db.prepare("SELECT * FROM external_backup_runs WHERE revision=? AND state='verified' ORDER BY created DESC LIMIT 1").get(r2.revision);
 return {scope:'ConectadOS',r2:{configured:Boolean(r2.destination),enabled:r2.automation.enabled,workerFresh:r2.automation.workerFresh,nextDue:r2.automation.nextDue,lastVerified:receipt(verified),lastAttempt:receipt(r2.runs[0]),sourceByteLimit:r2.sourceByteLimit,byteLimit:r2.byteLimit},drive:driveStatusReport(db,options)};
}
