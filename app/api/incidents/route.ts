import {rescanIncidents} from '@/lib/server/incident-rescan.mjs';
import {AppError} from '@/lib/server/store.mjs';
import {clearIncidentInbox,restoreIncidentToInbox,reconcileIncidents,incidentReport,acknowledgeIncident,configureIncidentTracking} from '@/lib/server/incidents.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);reconcileIncidents(db);return response({incidents:incidentReport(db)})}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);db.takeAttempt('incident_actions',20,60000);const body=await readBody(request);reconcileIncidents(db);
 if(body.action==='rescan'){db.takeAttempt('incident_rescan',1,60000);const scan=await rescanIncidents(db,{authorized:()=>db.authenticate(session)});return response({incidents:incidentReport(db),scan})}
 if(body.action==='clear'){const cleared=clearIncidentInbox(db,{revision:body.revision});return response({incidents:incidentReport(db),cleared})}
 if(body.action==='restore'){restoreIncidentToInbox(db,body.id,{revision:body.revision});return response({incidents:incidentReport(db)})}
 if(body.action==='acknowledge')acknowledgeIncident(db,body.id,{revision:typeof body.revision==='string'?body.revision:''});else if(body.action==='tracking')configureIncidentTracking(db,body.enabled);else throw new AppError('Acción no válida.');
 reconcileIncidents(db);return response({incidents:incidentReport(db)});
 }finally{db.close()}}catch(e){return errorResponse(e)}}
