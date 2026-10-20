import {diagnosticHistory,runDiagnosis} from '@/lib/server/diagnosis.mjs';
import {AppError} from '@/lib/server/store.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(request:Request){try{const db=store();try{
 if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);
 const url=new URL(request.url);return response(diagnosticHistory(db,{scope:url.searchParams.get('scope'),target:url.searchParams.get('target')}));
 }finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);
 if(body.action!=='check')throw new AppError('Solo se admite comprobar. No hay reparaciones en este diagnóstico.');
 db.takeAttempt('diagnosis',3,60000);
 return response(await runDiagnosis(db,{scope:body.scope,target:body.target},{authorize:()=>db.authenticate(session)}));
 }finally{db.close()}}catch(e){return errorResponse(e)}}
