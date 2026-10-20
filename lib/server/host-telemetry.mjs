import {open,constants} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {coolifyURL,inspectCoolifyServer} from './coolify.mjs';
import {assertNoAssistantSecrets} from './assistant.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),file='/host-telemetry/host.json',ttl=180000;
export const hostTelemetryEnabled=()=>process.env.CONECTADOS_HOST_TELEMETRY==='1';
function tables(db){db.db.exec('CREATE TABLE IF NOT EXISTS host_telemetry_samples(scope TEXT NOT NULL,sampled INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,sampled)); CREATE TABLE IF NOT EXISTS host_telemetry_state(scope TEXT PRIMARY KEY,attempted INTEGER,error TEXT,server TEXT,lease TEXT,lease_expires INTEGER);')}
function connection(db){const c=db.coolifyConnection(),identity=db.credentialIdentity('Coolify');if(!c?.hasToken||!identity)throw new AppError('Conecta Coolify para vincular el agente con un servidor autorizado.',409);return {source:c.url,identity,scope:hash([c.url,identity])}}
export function normalizeHostSample(raw,{now=Date.now()}={}){
 const fail=()=>{throw new AppError('Muestra del agente de host no compatible. Se conserva la lectura anterior.',502)};
 const integer=(v,min=0,max=2**50)=>Number.isSafeInteger(v)&&v>=min&&v<=max,finite=(v,min=0,max=1e10)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
 if(!raw||raw.schema!==1||raw.agentVersion!=='1'||typeof raw.agentId!=='string'||!/^[a-f0-9]{64}$/.test(raw.agentId)||typeof raw.serverId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(raw.serverId))fail();
 let origin;try{origin=coolifyURL(raw.coolifyOrigin)}catch{fail()}if(origin!==raw.coolifyOrigin)fail();
 if(!integer(raw.sampledAt,1,now+30000)||now-raw.sampledAt>ttl||!integer(raw.windowMs,500,10000)||!integer(raw.cpuCount,1,4096)||!finite(raw.uptimeSeconds)||!Array.isArray(raw.load)||raw.load.length!==3||!raw.load.every(v=>finite(v,0,1e6)))fail();
 const c=raw.cpu,m=raw.memory,d=raw.disk;if(!c||!m||!d)fail();const cpuValues=[c.workPercent,c.stealPercent,c.ioWaitPercent];
 if(c.reason==='counter-reset'){if(cpuValues.some(v=>v!==null))fail()}else if(c.reason!=='sampled'||!cpuValues.every(v=>finite(v,0,100))||cpuValues.reduce((a,b)=>a+b,0)>100.01)fail();
 if(!integer(m.totalBytes,1)||!integer(m.availableBytes)||m.availableBytes>m.totalBytes||!integer(m.swapTotalBytes)||!integer(m.swapFreeBytes)||m.swapFreeBytes>m.swapTotalBytes)fail();
 if(d.path!=='/'||!integer(d.totalBytes,1)||!integer(d.freeBytes)||!integer(d.availableBytes)||d.availableBytes>d.freeBytes||d.freeBytes>d.totalBytes)fail();
 return {schema:1,agentVersion:'1',agentId:raw.agentId,coolifyOrigin:origin,serverId:raw.serverId,sampledAt:raw.sampledAt,windowMs:raw.windowMs,cpuCount:raw.cpuCount,cpu:{workPercent:c.workPercent,stealPercent:c.stealPercent,ioWaitPercent:c.ioWaitPercent,reason:c.reason},memory:{totalBytes:m.totalBytes,availableBytes:m.availableBytes,swapTotalBytes:m.swapTotalBytes,swapFreeBytes:m.swapFreeBytes},disk:{path:'/',totalBytes:d.totalBytes,freeBytes:d.freeBytes,availableBytes:d.availableBytes},load:[...raw.load],uptimeSeconds:raw.uptimeSeconds};
}
export async function readHostSample({opener=open}={}){
 let handle;try{handle=await opener(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await handle.stat();if(!info.isFile()||info.size>32768)throw Error();const buffer=Buffer.alloc(32769);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>32768)throw Error();return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'))}catch{throw new AppError('El archivo privado del agente no está disponible o no es válido.',502)}finally{await handle?.close()}
}
export function hostTelemetryReport(db,{now=Date.now(),enabled=hostTelemetryEnabled()}={}){
 tables(db);let c;try{c=connection(db)}catch{return {configured:enabled,status:'unconnected',latest:null,history:[],error:null,attempted:null,observing:db.collectorStatus().enabled}}
 const state=db.db.prepare('SELECT attempted,error,server FROM host_telemetry_state WHERE scope=?').get(c.scope),rows=db.db.prepare('SELECT payload FROM host_telemetry_samples WHERE scope=? ORDER BY sampled DESC LIMIT 60').all(c.scope),samples=rows.map(r=>JSON.parse(r.payload)),latest=samples[0]??null,observing=db.collectorStatus().enabled;
 return {configured:enabled,status:!enabled?'unconfigured':!observing?'paused':state?.error?'error':!latest?'waiting':(now-latest.sampledAt>ttl||latest.sampledAt>now+30000)?'stale':'sampled',latest,history:samples,server:state?.server?JSON.parse(state.server):null,error:state?.error??null,attempted:state?.attempted??null,observing,source:'Agente Linux local · archivo privado de solo lectura',expiresAt:latest?latest.sampledAt+ttl:null,coverage:'CPU del intervalo indicado, RAM disponible del kernel y sistema de archivos raíz. No mide transacciones, todas las bases, cuotas del proveedor ni detecta caídas desde fuera del VPS. Historial: siete días/hasta 10.080 muestras globales; 60 por vista. Sin llamadas de IA.'};
}
export async function refreshHostTelemetry(db,{enabled=hostTelemetryEnabled(),read=readHostSample,inspect=inspectCoolifyServer,now=Date.now}={}){
 if(!enabled)return {disabled:true};tables(db);const c=connection(db),at=now(),lease=randomUUID();db.db.prepare('INSERT OR IGNORE INTO host_telemetry_state(scope) VALUES(?)').run(c.scope);
 const acquired=db.db.prepare('UPDATE host_telemetry_state SET lease=?,lease_expires=? WHERE scope=? AND (lease IS NULL OR lease_expires<=?)').run(lease,at+30000,c.scope,at);if(!acquired.changes)return {busy:true};
 try{
  const sample=normalizeHostSample(await read(),{now:now()});if(sample.coolifyOrigin!==c.source)throw new AppError('El agente pertenece a otra instancia de Coolify.',409);
  assertNoAssistantSecrets(db,JSON.stringify(sample));const old=db.db.prepare('SELECT payload FROM host_telemetry_samples WHERE scope=? ORDER BY sampled DESC LIMIT 1').get(c.scope);
  if(old){const previous=JSON.parse(old.payload);if(previous.agentId!==sample.agentId||previous.serverId!==sample.serverId)throw new AppError('La identidad del host cambió. Usa una instalación separada o revisa su vinculación.',409);if(sample.sampledAt<previous.sampledAt)throw new AppError('El agente devolvió una muestra anterior.',409);if(sample.sampledAt===previous.sampledAt){if(hash(previous)!==hash(sample))throw new AppError('La muestra cambió sin una fecha nueva.',409);if(connection(db).scope!==c.scope||db.db.prepare('SELECT lease FROM host_telemetry_state WHERE scope=?').get(c.scope)?.lease!==lease||now()>at+30000)throw new AppError('La conexión cambió durante la lectura.',409);return {cached:true}}}
  const server=await inspect(c.source,db.credential('Coolify'),sample.serverId);assertNoAssistantSecrets(db,JSON.stringify(server));if(server.id!==sample.serverId||server.source!==c.source+'/api/v1/servers/'+sample.serverId)throw new AppError('El servidor comprobado no corresponde al agente.',502);
  db.db.exec('BEGIN IMMEDIATE');try{
   const current=connection(db);if(current.scope!==c.scope||db.db.prepare('SELECT lease FROM host_telemetry_state WHERE scope=?').get(c.scope)?.lease!==lease||now()>at+30000)throw new AppError('La conexión o revisión del agente cambió durante la lectura.',409);
   db.db.prepare('INSERT INTO host_telemetry_samples(scope,sampled,payload) VALUES(?,?,?)').run(c.scope,sample.sampledAt,JSON.stringify(sample));db.db.prepare('UPDATE host_telemetry_state SET attempted=?,error=NULL,server=? WHERE scope=?').run(now(),JSON.stringify(server),c.scope);db.db.prepare('DELETE FROM host_telemetry_samples WHERE sampled<?').run(now()-7*86400000);db.db.exec('DELETE FROM host_telemetry_samples WHERE rowid NOT IN (SELECT rowid FROM host_telemetry_samples ORDER BY sampled DESC LIMIT 10080)');db.db.exec('COMMIT');return {updated:true};
  }catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}
 }catch(e){const message=e instanceof AppError?e.message:'No se pudo comprobar el agente del host.';try{if(connection(db).scope===c.scope)db.db.prepare('UPDATE host_telemetry_state SET attempted=?,error=? WHERE scope=?').run(now(),message,c.scope)}catch{}throw e instanceof AppError?e:new AppError(message,502)}
 finally{db.db.prepare('UPDATE host_telemetry_state SET lease=NULL,lease_expires=NULL WHERE scope=? AND lease=?').run(c.scope,lease)}
}

export function recoverHostTelemetry(db){tables(db);db.db.exec("UPDATE host_telemetry_state SET lease=NULL,lease_expires=NULL");}
