import {AppError} from '@/lib/server/store.mjs';
import {voiceReport,previewVoice,transcribeVoice} from '@/lib/server/voice.mjs';
import {configureVoice,removeVoiceKey} from '@/lib/server/voice-config.mjs';
import {store,sessionToken,guardRequest,readBody,response,errorResponse} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({voice:voiceReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);db.takeAttempt('voice_actions',12,60000);const body=await readBody(request,1300000,15000);
 if(body.action==='configure'){configureVoice(db,body);return response({voice:voiceReport(db)})}
 if(body.action==='remove-key'){removeVoiceKey(db,body.revision);return response({voice:voiceReport(db)})}
 if(body.action==='preview')return response({preview:previewVoice(db,body)});
 if(body.action==='transcribe')return response({transcript:await transcribeVoice(db,body,{signal:request.signal,authorized:()=>db.authenticate(session)}),voice:voiceReport(db)});
 throw new AppError('Acción de voz no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
