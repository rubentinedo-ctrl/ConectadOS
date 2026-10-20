import {AppError} from '@/lib/server/store.mjs';
import {assistantReport,assistantContext,assistantObservation,assistantTargets,assistantKey,configureAssistant,removeAssistantKey,previewAssistant,askAssistant} from '@/lib/server/assistant.mjs';
import {chatAssistant} from '@/lib/server/assistant-chat.mjs';
import {listAssistantModels} from '@/lib/server/assistant-provider.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({assistant:assistantReport(db),context:assistantContext(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);db.takeAttempt('assistant_actions',15,60000);
 if(body.action==='configure')return response({assistant:configureAssistant(db,body)});
 if(body.action==='remove-key')return response({assistant:removeAssistantKey(db,body.revision)});
 if(body.action==='targets')return response({targets:assistantTargets(db,{scope:body.scope,query:body.query??''})});
 if(body.action==='local')return response(assistantObservation(db,{scope:typeof body.scope==='string'?body.scope:'all',target:body.target}));
 if(body.action==='preview')return response({preview:previewAssistant(db,body)});
 if(body.action==='models'){db.takeAttempt('assistant_models',3,60000);const c=assistantReport(db).config;const key=typeof body.key==='string'?body.key:body.provider===c.provider?assistantKey(db):null;const catalog=await listAssistantModels(body.provider,key,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)])});if(!db.authenticate(session))throw new AppError('La sesión ya no está activa.',401);return response({catalog})}
 if(body.action==='chat')return response({...await chatAssistant(db,body,{signal:request.signal,authorized:()=>db.authenticate(session)}),assistant:assistantReport(db)});
 if(body.action==='ask')return response({answer:await askAssistant(db,body,{signal:request.signal,authorized:()=>db.authenticate(session)}),assistant:assistantReport(db)});
 throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
