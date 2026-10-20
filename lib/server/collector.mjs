import {refreshResourceBackups} from './resource-backups.mjs';
import {refreshDriveStatus} from './drive-status.mjs';
import {refreshExternalObserver} from './external-observer.mjs';
import {refreshHostTelemetry} from './host-telemetry.mjs';
import {collectCoolify} from './coolify.mjs';
import {AppError} from './store.mjs';
import {refreshProvider} from './provider-collector.mjs';
import {collectWebProbes} from './web-probes.mjs';
import {reconcileIncidents} from './incidents.mjs';
import {enqueueNotifications,deliverNotifications} from './notifications.mjs';

// Shared persistent lease: browser refresh and collector cannot overlap.
export async function refreshCoolify(db,{force=false,collect=collectCoolify}={}){
 const connection=db.coolifyConnection();
 if(!connection?.hasToken)throw new AppError('Configura primero el acceso a Coolify.',409);
 if(!force&&!connection.error&&connection.snapshot&&Date.now()-connection.snapshot.checkedAt<55000)return {cached:true};
 const lease=db.acquireCollection();if(!lease)return {busy:true};
 const identity=db.credentialIdentity('Coolify');
 try{
  const token=db.credential('Coolify');
  const snapshot=await collect(connection.url,token,{previous:connection.snapshot,forceDetails:force});
  if(db.coolifyConnection()?.url!==connection.url||db.credentialIdentity('Coolify')!==identity)throw new AppError('La conexión cambió durante la consulta.',409);
  db.saveCoolifySnapshot(connection.url,snapshot,identity);return {updated:true};
 }catch(e){
  const safe=e instanceof AppError?e.message:'No se pudo consultar Coolify.';
  if(db.coolifyConnection()?.url===connection.url&&db.credentialIdentity('Coolify')===identity)db.failCoolify(connection.url,safe);
  throw e instanceof AppError?e:new AppError(safe,502);
 }finally{db.releaseCollection(lease)}
}

export async function collectorTick(db,options={}){
 if(!db.collectorStatus().enabled){db.collectorHeartbeat();reconcileIncidents(db);await deliverNotifications(db);return {disabled:true}}
 const work=[];
 if(db.coolifyConnection()?.hasToken){work.push(refreshCoolify(db,options));work.push(refreshHostTelemetry(db,options.hostTelemetry??{}))}
 for(const row of db.providerConnections())if(row.hasToken)work.push(refreshProvider(db,row.provider));
 if(db.webProbes().some(p=>p.enabled))work.push(collectWebProbes(db));
 work.push(refreshExternalObserver(db,options.externalObserver??{}));
 work.push(refreshDriveStatus(db,{...options.driveStatus,passive:true}));
 const results=await Promise.allSettled(work);
 if(db.coolifyConnection()?.hasToken)results.push(...await Promise.allSettled([refreshResourceBackups(db,options.resourceBackups??{})]));
 const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason instanceof AppError?result.reason.message:'Fallo de observación.');
 db.collectorHeartbeat(errors.length?errors.join(' ').slice(0,500):null);
 reconcileIncidents(db);
 try{enqueueNotifications(db);await deliverNotifications(db)}catch{errors.push('No se pudieron procesar los avisos por correo.');db.collectorHeartbeat(errors.join(' ').slice(0,500))}
 return errors.length?{failed:true}:results[0]?.status==='fulfilled'?results[0].value:{idle:true};
}
