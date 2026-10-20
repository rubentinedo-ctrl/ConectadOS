import {store,guardRequest,readBody,response,errorResponse,setSession,sessionToken,clearSession} from '@/lib/server/security';
export const runtime='nodejs';
export async function POST(request:Request){
 try{await guardRequest(request);const body=await readBody(request);const db=store();try{
  if(body.action==='logout'){db.logout(await sessionToken());await clearSession();return response({ok:true})}
  if(body.action==='change-password'){await db.changePassword({token:await sessionToken(),password:body.password,newPassword:body.newPassword,confirmation:body.confirmation});await clearSession();return response({ok:true})}
  if(body.action==='recover'){await db.recoverPassword(body);await clearSession();return response({ok:true})}
  const token=body.action==='create'?await db.createOwner(body.token,body.username,body.password):body.action==='login'?await db.login(body.username,body.password):null;
  if(!token)return response({error:'Acción no válida.'},400);await setSession(token);return response({ok:true});
 }finally{db.close()}}catch(e){return errorResponse(e)}
}
