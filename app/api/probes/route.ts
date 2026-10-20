import {AppError} from '@/lib/server/store.mjs';
import {probeURL,refreshWebProbe} from '@/lib/server/web-probes.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({probes:db.webProbes()})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){
 try{await guardRequest(request);const db=store();try{
  const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);
  db.takeAttempt('web_probes',10,60000);const body=await readBody(request);
  if(body.action==='configure')db.configureWebProbe({id:body.id,label:body.label,url:probeURL(body.url),enabled:body.enabled});
  else if(body.action==='remove')db.removeWebProbe(body.id);
  else if(body.action==='refresh'){await refreshWebProbe(db,body.id,{force:true});if(!db.authenticate(session))throw new AppError('La sesión caducó durante la comprobación.',401)}
  else throw new AppError('Acción no válida.');
  return response({probes:db.webProbes()});
 }finally{db.close()}}catch(e){return errorResponse(e)}
}
