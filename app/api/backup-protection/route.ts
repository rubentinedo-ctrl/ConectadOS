import {AppError} from '@/lib/server/store.mjs';
import {backupProtectionReport} from '@/lib/server/backup-protection.mjs';
import {refreshDriveStatus} from '@/lib/server/drive-status.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({backupProtection:backupProtectionReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);const body=await readBody(request);if(body.action!=='refresh'||Object.keys(body).length!==1)throw new AppError('Acción no permitida.');db.takeAttempt('drive_status',5,60000);const result=await refreshDriveStatus(db);if(!db.authenticate(session))throw new AppError('La sesión caducó durante la lectura.',401);return response({result,backupProtection:backupProtectionReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
