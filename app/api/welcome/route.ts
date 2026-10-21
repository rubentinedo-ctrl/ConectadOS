import {AppError} from '@/lib/server/store.mjs';
import {welcomeReport,changeWelcome} from '@/lib/server/welcome.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response(welcomeReport(db))}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const input=await readBody(request,4096);const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response(changeWelcome(db,input))}finally{db.close()}}catch(e){return errorResponse(e)}}
