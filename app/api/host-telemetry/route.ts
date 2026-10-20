import {AppError} from '@/lib/server/store.mjs';
import {hostTelemetryReport,refreshHostTelemetry} from '@/lib/server/host-telemetry.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({hostTelemetry:hostTelemetryReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);const body=await readBody(request);if(body.action!=='refresh')throw new AppError('Acción no permitida.');db.takeAttempt('host_telemetry',5,60000);const result=await refreshHostTelemetry(db);if(!db.authenticate(session))throw new AppError('La sesión caducó durante la lectura.',401);return response({result,hostTelemetry:hostTelemetryReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
