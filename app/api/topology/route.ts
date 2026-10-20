import {AppError} from '@/lib/server/store.mjs';
import {topologyReport,saveRelation,removeRelation} from '@/lib/server/topology.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({topology:topologyReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{
 if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);db.takeAttempt('topology_actions',20,60000);const body=await readBody(request);
 if(body.action==='save'){
  if(body.id!==undefined&&typeof body.id!=='string'||body.revision!==undefined&&typeof body.revision!=='string'||body.note!==undefined&&typeof body.note!=='string')throw new AppError('La declaración contiene campos no válidos.');
  saveRelation(db,{id:body.id??'',revision:body.revision??'',fromRef:body.fromRef,toRef:body.toRef,kind:body.kind,note:body.note??''});
 }
 else if(body.action==='remove')removeRelation(db,body.id,body.revision);
 else throw new AppError('Acción no válida.');
 return response({topology:topologyReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
