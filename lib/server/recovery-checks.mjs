import {readFileSync,lstatSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {hostTelemetryReport} from './host-telemetry.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function readRecoveryChecks(db,{file='/host-telemetry/recovery-checks.json',now=Date.now(),host=hostTelemetryReport}={}){
 const empty={available:false,instance:null,refs:[],jobs:[],sampledAt:null};
 try{
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>131072)return empty;
  const x=JSON.parse(readFileSync(file,'utf8')),h=host(db),c=db.coolifyConnection();
  if(x.schema!==1||!Number.isSafeInteger(x.sampledAt)||now-x.sampledAt>180000||x.sampledAt>now+30000||!hex(x.instance)||!h.latest||h.status!=='sampled'||x.agentId!==h.latest.agentId||x.serverId!==h.latest.serverId||x.coolifyOrigin!==c?.url||x.identity!==db.credentialIdentity('Coolify')||!Array.isArray(x.refs)||x.refs.length>100||!x.refs.every(hex)||!Array.isArray(x.jobs)||x.jobs.length>80)return empty;
  const jobs=x.jobs.filter(j=>j&&typeof j.id==='string'&&/^[a-f0-9-]{36}$/.test(j.id)&&x.refs.includes(j.ref)&&hex(j.sha256)&&['queued','running','success','failed'].includes(j.state)&&Number.isSafeInteger(j.createdAt)&&j.createdAt<=now+30000&&Number.isSafeInteger(j.backupAt)&&j.backupAt<=j.createdAt&&(j.finishedAt===null&&['queued','running'].includes(j.state)||Number.isSafeInteger(j.finishedAt)&&j.finishedAt>=j.createdAt&&j.finishedAt<=now+30000)&&Number.isSafeInteger(j.tables)&&j.tables>=0&&j.tables<=10000).map(j=>({id:j.id,ref:j.ref,sha256:j.sha256,backupAt:j.backupAt,createdAt:j.createdAt,finishedAt:j.finishedAt,state:j.state,tables:j.tables}));
  return {available:true,instance:x.instance,refs:x.refs,jobs,sampledAt:x.sampledAt};
 }catch{return empty}
}
export function verifiedRecoveryReceipt(latest,ref,jobs){
 const proof=latest?.state==='success'?jobs.findLast(j=>j.ref===ref&&j.sha256===latest.sha256&&j.backupAt===latest.backupAt&&j.state==='success'&&j.finishedAt>=latest.backupAt):null;
 return proof?{...latest,restored:true,reportedAt:proof.finishedAt,source:'Ejecutor de verificación aislada',coverage:'PostgreSQL restaurado sin red: datos y secuencias coinciden con el archivo; roles separados y objetos restaurados sin omitir propietarios ni permisos. No acredita Storage, configuración de servicios ni recuperación completa de la aplicación.'}:latest;
}
export function recoveryRevision(report,item){return hash([report.instance,item.ref,item.latest?.sha256,item.latest?.backupAt]);}
export function queueRecoveryCheck(db,item,revision,{report=readRecoveryChecks(db),now=Date.now()}={}){
 if(!report.available||!report.refs.includes(item?.ref))throw new AppError('Esta base no tiene un ejecutor aislado vinculado.',409);
 if(!item.latest||item.latest.state!=='success'||!hex(item.latest.sha256)||['stale','unknown','working'].includes(item.state))throw new AppError('Actualiza una copia válida antes de solicitar la prueba.',409);
 if(revision!==recoveryRevision(report,item))throw new AppError('La copia o el ejecutor cambiaron. Revisa la prueba de nuevo.',409);
 const dir=join(db.root,'.data','recovery-requests');mkdirSync(dir,{recursive:true,mode:0o700});if(lstatSync(dir).isSymbolicLink())throw new AppError('La cola requiere revisión.',409);
 const file=join(dir,item.ref+'.json');
 try{const prior=JSON.parse(readFileSync(file,'utf8'));if(prior.expiresAt>now&&!report.jobs.some(j=>j.id===prior.id&&['success','failed'].includes(j.state)))throw new AppError('Ya hay una prueba solicitada para esta base.',409)}catch(e){if(e instanceof AppError)throw e;if(e.code!=='ENOENT')throw new AppError('La solicitud anterior requiere revisión.',409)}
 if(report.jobs.some(j=>j.ref===item.ref&&['running','queued'].includes(j.state)))throw new AppError('Ya hay una prueba en curso.',409);
 const job={schema:1,id:randomUUID(),ref:item.ref,sha256:item.latest.sha256,backupAt:item.latest.backupAt,instance:report.instance,createdAt:now,expiresAt:now+300000};
 const temp=join(dir,'.'+job.id);try{writeFileSync(temp,JSON.stringify(job),{mode:0o600,flag:'wx'});renameSync(temp,file)}finally{try{unlinkSync(temp)}catch{}}
 db.record('recovery_check_approved');return {id:job.id,state:'queued'};
}
