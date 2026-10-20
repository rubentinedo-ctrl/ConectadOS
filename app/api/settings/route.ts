import {AppError} from '@/lib/server/store.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({settings:db.settings(),credentials:db.listCredentials(),audit:db.audit()})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);
 if(body.action==='preferences')return response({settings:db.saveSettings(body.value)});
 if(body.action==='credential'){db.saveCredential(body.provider,body.label,body.secret);return response({credentials:db.listCredentials()})}
 if(body.action==='deleteCredential'){db.deleteCredential(body.provider);return response({credentials:db.listCredentials()})}
 throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
