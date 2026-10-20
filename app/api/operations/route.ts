import {AppError} from '@/lib/server/store.mjs';
import {operationsReport,planOperation,executeOperation,cancelOperation,reconcileOperation,reviewOperation} from '@/lib/server/operations.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse,origin} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({operations:operationsReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);const body=await readBody(request),deps={signal:request.signal,ownOrigin:await origin()};db.takeAttempt('operations',8,60000);
 if(body.action==='plan')return response({operations:await planOperation(db,{...body,session},deps)});
 if(body.action==='execute')return response({operations:await executeOperation(db,{...body,session},deps)});
 if(body.action==='cancel')return response({operations:cancelOperation(db,{...body,session})});
 if(body.action==='review')return response({operations:reviewOperation(db,{...body,session})});
 if(body.action==='reconcile')return response({operations:await reconcileOperation(db,{...body,session},deps)});
 throw new AppError('Operación no permitida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
