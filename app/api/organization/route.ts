import {AppError} from '@/lib/server/store.mjs';
import {organizationReport,saveProject,removeProject,assignResource,removeAssignment} from '@/lib/server/organization.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({organization:organizationReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{
 if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);db.takeAttempt('organization_actions',20,60000);const body=await readBody(request);
 if(body.action==='save-project')saveProject(db,{id:body.id,revision:body.revision,name:body.name,description:body.description,color:body.color});
 else if(body.action==='remove-project')removeProject(db,body.id,body.revision);
 else if(body.action==='assign')assignResource(db,{ref:body.ref,revision:body.revision,projectId:body.projectId,tags:body.tags,connectionRevision:body.connectionRevision});
 else if(body.action==='remove-assignment')removeAssignment(db,{ref:body.ref,revision:body.revision,connectionRevision:body.connectionRevision});
 else throw new AppError('Acción no válida.');
 return response({organization:organizationReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
