import {resourceBackupsReport} from '@/lib/server/resource-backups.mjs';
import {externalObserverReport} from '@/lib/server/external-observer.mjs';
import {backupProtectionReport} from '@/lib/server/backup-protection.mjs';
import {hostTelemetryReport} from '@/lib/server/host-telemetry.mjs';
import {billingReport} from '@/lib/server/billing.mjs';
import {platformsReport} from '@/lib/server/platforms.mjs';
import {AppError} from '@/lib/server/store.mjs';
import {reconcileIncidents,incidentReport} from '@/lib/server/incidents.mjs';
import {notificationReport} from '@/lib/server/notifications.mjs';
import {organizationReport} from '@/lib/server/organization.mjs';
import {topologyReport} from '@/lib/server/topology.mjs';
import {vercelScope,listVercelTeams} from '@/lib/server/vercel.mjs';
import {cloudflareScope} from '@/lib/server/cloudflare.mjs';
import {supabaseScope} from '@/lib/server/supabase.mjs';
import {hostingerScope,listHostingerServers} from '@/lib/server/hostinger.mjs';
import {refreshProvider} from '@/lib/server/provider-collector.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
const state=(db:ReturnType<typeof store>)=>{db.db.exec('SAVEPOINT infrastructure_state');try{const value={connection:db.coolifyConnection(),collector:db.collectorStatus(),history:db.observationHistory(),integrations:db.providerConnections(),logos:db.resourceLogoMetadata(),probes:db.webProbes(),incidents:incidentReport(db),notifications:notificationReport(db),topology:topologyReport(db),organization:organizationReport(db),billing:billingReport(db),platforms:platformsReport(db),hostTelemetry:hostTelemetryReport(db),externalObserver:externalObserverReport(db),backupProtection:backupProtectionReport(db),resourceBackups:resourceBackupsReport(db)};db.db.exec('RELEASE infrastructure_state');return value}catch(e){db.db.exec('ROLLBACK TO infrastructure_state; RELEASE infrastructure_state');throw e}};
export async function GET(){try{const db=store();try{if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);reconcileIncidents(db);return response(state(db))}finally{db.close()}}catch(e){return errorResponse(e)}}
export async function POST(request:Request){try{await guardRequest(request);const body=await readBody(request);const db=store();try{
 const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);
 if(!['Vercel','Cloudflare','Supabase','Hostinger'].includes(String(body.provider)))throw new AppError('Conector no disponible.');const provider=String(body.provider);
 if(body.action==='scopes'&&provider==='Vercel'){db.takeAttempt('vercel_scopes',5,60000);const token=typeof body.token==='string'&&body.token.trim()?body.token.trim():db.credential(provider);return response({teams:await listVercelTeams(token)})}
 if(body.action==='scopes'&&provider==='Hostinger'){db.takeAttempt('hostinger_scopes',5,60000);const token=typeof body.token==='string'&&body.token.trim()?body.token.trim():db.credential(provider);return response({servers:await listHostingerServers(token)})}
 if(body.action==='configure'){const scope=provider==='Vercel'?vercelScope(body.scope):provider==='Cloudflare'?cloudflareScope(body.scope):provider==='Supabase'?supabaseScope(body.scope):hostingerScope(body.scope);db.configureProvider(provider,scope,body.token);return response(state(db))}
 if(body.action==='refresh'){db.takeAttempt('refresh_'+provider,5,60000);const result=await refreshProvider(db,provider,{force:true});if(!db.authenticate(session))throw new AppError('La sesión caducó durante la consulta.',401);return response({...state(db),result})}
 throw new AppError('Acción no válida.');
 }finally{db.close()}}catch(e){return errorResponse(e)}}
