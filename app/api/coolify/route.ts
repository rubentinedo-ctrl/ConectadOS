import {AppError} from '@/lib/server/store.mjs';
import {coolifyURL} from '@/lib/server/coolify.mjs';
import {refreshCoolify} from '@/lib/server/collector.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
const state=(db:ReturnType<typeof store>)=>({connection:db.coolifyConnection(),collector:db.collectorStatus(),history:db.observationHistory()});
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response(state(db))}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);
 if(body.action==='configure'){db.configureCoolify(coolifyURL(body.url),body.token);return response(state(db))}
 if(body.action==='collector'){db.configureCollector(body.enabled);return response(state(db))}
 if(body.action==='refresh'){
  const connection=db.coolifyConnection();if(!connection)throw new AppError('Configura primero la dirección de Coolify.',409);
  db.takeAttempt('coolify_refresh',5,60000);
  const result=await refreshCoolify(db,{force:true});if(!db.authenticate(session))throw new AppError('La sesión caducó durante la consulta.',401);
  return response({...state(db),result});
 }
 throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
