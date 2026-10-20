import {AppError} from '@/lib/server/store.mjs';
import {platformsReport,savePlatform,archivePlatform} from '@/lib/server/platforms.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({platforms:platformsReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);db.takeAttempt('platforms',20,60000);if(body.action==='save')savePlatform(db,body.entry);else if(body.action==='archive')archivePlatform(db,{id:body.id,revision:body.revision,archived:body.archived});else throw new AppError('Acción no válida.');return response({platforms:platformsReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
