import {cookies} from 'next/headers';
import {AppError} from '@/lib/server/store.mjs';
import {verifyGoogleCredential} from '@/lib/server/google.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken,setSession,origin,sessionPolicy} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({...db.googleStatus(),authorizedOrigin:await origin()})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){
 try{await guardRequest(request);const body=await readBody(request);const db=store();try{
  const token=await sessionToken(),policy=await sessionPolicy(),flowCookie=policy.google;
  if(body.action==='configure'||body.action==='unlink'){
   if(!db.authenticate(token))throw new AppError('Inicia sesión.',401);
   const stamp=await db.confirmOwner(body.password);
   db.db.exec('BEGIN IMMEDIATE');try{if(!db.authenticate(token)||db.ownerStamp()!==stamp)throw new AppError('El acceso cambió. Vuelve a entrar.',409);if(body.action==='configure')db.saveGoogleClient(body.clientId);else db.unlinkGoogle(token);db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
   return response(db.googleStatus());
  }
  if(body.action==='begin'){
   let stamp=null;if(body.mode==='link'){if(!db.authenticate(token))throw new AppError('Inicia sesión.',401);stamp=await db.confirmOwner(body.password)}
   db.db.exec('BEGIN IMMEDIATE');let flow;try{if(body.mode==='link'&&(!db.authenticate(token)||db.ownerStamp()!==stamp))throw new AppError('El acceso cambió. Vuelve a entrar.',409);flow=db.beginGoogle(body.mode,token);db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
   (await cookies()).set(flowCookie,flow.browser,{httpOnly:true,sameSite:'strict',secure:policy.secure,path:policy.googlePath,maxAge:300});
   return response({nonce:flow.nonce,clientId:flow.clientId});
  }
  if(body.action==='complete'){
   const flow=db.consumeGoogle(body.nonce,(await cookies()).get(flowCookie)?.value,token);
   (await cookies()).set(flowCookie,'',{httpOnly:true,sameSite:'strict',secure:policy.secure,path:policy.googlePath,maxAge:0});
   const config=db.googleConfig();if(!config)throw new AppError('Google no está configurado.',409);
   const identity=await verifyGoogleCredential(body.credential,config.client_id,body.nonce);
   // Re-read configuration after network verification; a concurrent change invalidates the flow.
   if(db.googleConfig()?.client_id!==config.client_id)throw new AppError('La configuración cambió. Vuelve a comenzar.',409);
   await setSession(db.finishGoogle(flow,identity));return response({ok:true});
  }
  throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}
}
