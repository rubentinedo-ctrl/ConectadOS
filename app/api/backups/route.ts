import {AppError} from '@/lib/server/store.mjs';
import {backupReport,configureBackup,configureBackupAutomation} from '@/lib/server/backup-settings.mjs';import {runExternalBackup} from '@/lib/server/external-backup.mjs';
import {retentionPreview} from '@/lib/server/backup-retention.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response(backupReport(db))}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{const token=await sessionToken();if(!db.authenticate(token))throw new AppError('Inicia sesión.',401);const body=await readBody(request);
 if(body.action==='retention-preview'){db.takeAttempt('retention_preview',5,60000);return response({retention:retentionPreview(db,{days:body.days,keepVerified:body.keepVerified})})}
 if(body.action==='configure'){configureBackup(db,{accountId:body.accountId,bucket:body.bucket,accessKeyId:body.accessKeyId,secretAccessKey:body.secretAccessKey,revision:body.revision});return response(backupReport(db))}
 if(body.action==='automation'){return response(configureBackupAutomation(db,{enabled:body.enabled,revision:body.revision,destinationRevision:body.destinationRevision}))}
 if(body.action==='backup'){db.takeAttempt('external_backups',2,3600000);const result=await runExternalBackup(db,{expectedRevision:body.revision,authorize:()=>db.authenticate(token)});if(!db.authenticate(token))throw new AppError('La sesión caducó durante la copia.',401);return response({...backupReport(db),result})}
 throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
