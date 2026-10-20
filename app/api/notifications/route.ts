import {configureNotificationPolicy} from '@/lib/server/notification-policy.mjs';
import {AppError} from '@/lib/server/store.mjs';
import {notificationReport,configureNotifications,activateNotifications,muteNotifications,enqueueTestNotification,deliverNotifications} from '@/lib/server/notifications.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);return response({notifications:notificationReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);db.takeAttempt('notification_actions',10,60000);const body=await readBody(request),revision=typeof body.revision==='string'?body.revision:'';
 if(body.action==='configure')configureNotifications(db,{sender:body.sender,recipient:body.recipient,includeDetails:body.includeDetails,dailyLimit:body.dailyLimit,revision});
 else if(body.action==='policy')configureNotificationPolicy(db,body.policy,{revision:typeof body.policyRevision==='string'?body.policyRevision:''});
 else if(body.action==='enabled')activateNotifications(db,body.enabled,{revision});
 else if(body.action==='mute')muteNotifications(db,body.minutes);
 else if(body.action==='test'){db.takeAttempt('notification_tests',3,3600000);const id=enqueueTestNotification(db,body.id,{revision});await deliverNotifications(db,{onlyId:id})}
 else throw new AppError('Acción no válida.');
 if(!db.authenticate(session))throw new AppError('La sesión caducó durante la prueba.',401);
 return response({notifications:notificationReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
