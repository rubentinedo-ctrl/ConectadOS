import {AppError} from '@/lib/server/store.mjs';
import {billingReport,saveBillingEntry,archiveBillingEntry} from '@/lib/server/billing.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({billing:billingReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);
 if(body.action==='save')saveBillingEntry(db,body.entry);
 else if(body.action==='archive')archiveBillingEntry(db,{id:body.id,revision:body.revision,archived:body.archived});
 else throw new AppError('Acción no válida.');
 return response({billing:billingReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
