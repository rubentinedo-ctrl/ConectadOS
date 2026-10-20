import {AppError} from '@/lib/server/store.mjs';
import {emailRecoveryReport,beginEmailVerification,confirmEmailVerification,disableEmailRecovery,requestEmailRecovery} from '@/lib/server/email-recovery.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({recovery:emailRecoveryReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{
 await guardRequest(request);const body=await readBody(request,2048),db=store();try{
  if(body.action==='request'){await requestEmailRecovery(db);return response({ok:true,message:'Si la recuperación por correo está habilitada y hay cupo, recibirás un código. Revisa tu bandeja y spam. Si ya pediste uno, usa ese código o espera 15 minutos.'})}
  const token=await sessionToken();if(!db.authenticate(token))throw new AppError('Inicia sesión.',401);
  if(body.action==='begin'){const stamp=await db.confirmOwner(body.password);await beginEmailVerification(db,{token,stamp,recipient:body.recipient,confirm:body.confirm})}
  else if(body.action==='confirm')confirmEmailVerification(db,{token,code:body.code,confirm:body.confirm});
  else if(body.action==='disable')disableEmailRecovery(db);
  else throw new AppError('Acción no válida.');
  if(!db.authenticate(token))throw new AppError('La sesión caducó. Vuelve a entrar.',401);
  return response({recovery:emailRecoveryReport(db)});
 }finally{db.close()}
}catch(e){return errorResponse(e)}}
