import {AppError} from '@/lib/server/store.mjs';
import {externalObserverReport,refreshExternalObserver} from '@/lib/server/external-observer.mjs';
import {configureObserver} from '@/lib/server/observer-config.mjs';
import {assertNoAssistantSecrets} from '@/lib/server/assistant.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({externalObserver:externalObserverReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);const body=await readBody(request);
 if(!['refresh','configure'].includes(String(body.action)))throw new AppError('Acción no permitida.');db.takeAttempt('external_observer',5,60000);
 let result;
 if(body.action==='refresh'){if(Object.keys(body).some(k=>k!=='action'))throw new AppError('No se aceptan direcciones ni parámetros de consulta.');result=await refreshExternalObserver(db,{force:true});}
 else{if(Object.keys(body).some(k=>!['action','revision','url','configurationHash','enabled','mailReadEnabled','readSecret'].includes(k)))throw new AppError('Configuración no permitida.');assertNoAssistantSecrets(db,String(body.url??''));result=configureObserver(db,{revision:body.revision,url:body.url,configurationHash:body.configurationHash,enabled:body.enabled,mailReadEnabled:body.mailReadEnabled,readSecret:body.readSecret});}
 if(!db.authenticate(session))throw new AppError('La sesión caducó durante la lectura.',401);return response({result,externalObserver:externalObserverReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
