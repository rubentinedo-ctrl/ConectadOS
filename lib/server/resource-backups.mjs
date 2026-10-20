import {open,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './store.mjs';
import {inventoryCatalog} from './topology.mjs';
import {hostTelemetryEnabled,hostTelemetryReport} from './host-telemetry.mjs';
import {assertNoAssistantSecrets} from './assistant.mjs';
import {readRecoveryChecks,verifiedRecoveryReceipt} from './recovery-checks.mjs';
const ttl=180000,day=86400000,limit=100,hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const file='/host-telemetry/resource-backups.json';
// Deliberately excludes names, identities, private paths, digests and worker text.
export function anonymousBackupEvidence(item){if(!item.latest)return {state:item.state,externalRestorationVerified:false};return {state:item.state,backupAt:item.latest?.backupAt??null,localRestored:item.latest?.restored??false,reportedAt:item.latest?.reportedAt??null,externalBundle:item.latest?.drive?{state:item.latest.drive.state,reportedAt:item.latest.drive.reportedAt}:null,externalRestorationVerified:false}}
function tables(db){db.db.exec('CREATE TABLE IF NOT EXISTS resource_backup_reports(scope TEXT PRIMARY KEY,payload TEXT,attempted INTEGER,error TEXT); CREATE TABLE IF NOT EXISTS resource_backup_receipts(scope TEXT NOT NULL,ref TEXT NOT NULL,backup INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,ref,backup));')}
function connection(db){const c=db.coolifyConnection(),identity=db.credentialIdentity('Coolify');return c?.hasToken&&identity?{source:c.url,scope:hash([c.url,identity])}:null}
const integer=(v,min=0,max=2**50)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function normalizeResourceBackupSample(raw,{now=Date.now()}={}){
 const fail=()=>{throw new AppError('Informe de respaldos no compatible; se conserva la evidencia anterior.',502)};
 if(!raw||raw.schema!==1||!integer(raw.sampledAt,1,now+30000)||now-raw.sampledAt>ttl||typeof raw.agentId!=='string'||!/^[a-f0-9]{64}$/.test(raw.agentId)||typeof raw.serverId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(raw.serverId)||typeof raw.coolifyOrigin!=='string'||!Array.isArray(raw.items)||raw.items.length>limit)fail();
 const refs=new Set();const items=raw.items.map(r=>{
  if(!r||typeof r.ref!=='string'||!/^[a-f0-9]{64}$/.test(r.ref)||refs.has(r.ref)||!['success','failed','running','missing','invalid'].includes(r.state))fail();refs.add(r.ref);
  if(!integer(r.reportedAt,1,now+30000)&&r.reportedAt!==null)fail();
  if(!integer(r.backupAt,1,now+30000)&&r.backupAt!==null)fail();
  if(typeof r.restored!=='boolean'||typeof r.source!=='string'||!r.source||r.source.length>100||/[\u0000-\u001f\u007f]/.test(r.source)||typeof r.coverage!=='string'||!r.coverage||r.coverage.length>240||/[\u0000-\u001f\u007f]/.test(r.coverage))fail();
  if(r.state==='success'&&(!r.backupAt||!r.reportedAt||r.reportedAt<r.backupAt||!integer(r.bytes,1)||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)))fail();
  if(r.restored&&r.state!=='success')fail();
  const drive=r.drive;
  if(drive!==null&&(!drive||!['included','not-confirmed','failed'].includes(drive.state)||!integer(drive.reportedAt,1,now+30000)||typeof drive.period!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(drive.period)))fail();
  return {ref:r.ref,state:r.state,backupAt:r.backupAt,reportedAt:r.reportedAt,restored:r.restored,bytes:r.state==='success'?r.bytes:null,sha256:r.state==='success'?r.sha256:null,source:r.source,coverage:r.coverage,drive:drive?{state:drive.state,reportedAt:drive.reportedAt,period:drive.period}:null};
 });
 return {schema:1,sampledAt:raw.sampledAt,agentId:raw.agentId,serverId:raw.serverId,coolifyOrigin:raw.coolifyOrigin,items};
}
export async function readResourceBackupSample(){
 let h;try{h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const st=await h.stat();if(!st.isFile()||st.size<1||st.size>65536)throw Error();const b=Buffer.alloc(65537);const {bytesRead}=await h.read(b,0,b.length,0);if(bytesRead!==st.size||bytesRead>65536)throw Error();return JSON.parse(b.subarray(0,bytesRead).toString('utf8'))}catch(e){if(e.code==='ENOENT')return null;throw new AppError('No se pudo leer el informe privado de respaldos. Revisa el publicador del host.',502)}finally{await h?.close()}
}
export async function refreshResourceBackups(db,{enabled=hostTelemetryEnabled(),read=readResourceBackupSample,host=hostTelemetryReport,now=Date.now}={}){
 if(!enabled)return {disabled:true};tables(db);const c=connection(db);if(!c)return {unconnected:true};
 try{
  const raw=await read();if(!raw)return {unconfigured:true};const sample=normalizeResourceBackupSample(raw,{now:now()}),h=host(db,{now:now(),enabled:true});
  if(!h.latest||h.status!=='sampled'||h.latest.agentId!==sample.agentId||h.latest.serverId!==sample.serverId||sample.coolifyOrigin!==c.source)throw new AppError('El informe no coincide con el host autorizado y vigente. Revisa su vinculación.',409);
  assertNoAssistantSecrets(db,JSON.stringify(sample));const catalog=inventoryCatalog(db,now());
  if(sample.items.some(r=>{const n=catalog.byRef.get(r.ref);return !n||n.provider!=='Coolify'||!(n.type==='database'||n.type.startsWith('standalone-'))||n.stale}))throw new AppError('Un respaldo apunta a una base o conexión no vigente. Revisa los identificadores exactos.',409);
  if(connection(db)?.scope!==c.scope)throw new AppError('La conexión cambió durante la lectura.',409);
  db.db.exec('SAVEPOINT resource_backup_read');try{
   const old=db.db.prepare('SELECT payload FROM resource_backup_reports WHERE scope=?').get(c.scope),previous=old?.payload?JSON.parse(old.payload):null;
   if(previous&&(previous.sampledAt>sample.sampledAt||previous.sampledAt===sample.sampledAt&&JSON.stringify(previous)!==JSON.stringify(sample)))throw new AppError('El informe retrocedió o cambió sin una nueva fecha.',409);
   const newReceipts=sample.items.filter(r=>r.state==='success'&&!db.db.prepare('SELECT 1 FROM resource_backup_receipts WHERE scope=? AND ref=? AND backup=?').get(c.scope,r.ref,r.backupAt)).length;
   if(db.db.prepare('SELECT count(*) n FROM resource_backup_receipts').get().n+newReceipts>3000)throw new AppError('El historial de 3.000 comprobantes requiere un plan de archivo; no se borró evidencia.',409);
   for(const item of sample.items.filter(r=>r.state==='success')){
    const oldReceipt=db.db.prepare('SELECT payload FROM resource_backup_receipts WHERE scope=? AND ref=? AND backup=?').get(c.scope,item.ref,item.backupAt);
    // Drive is a later observation of a daily bundle; it never changes the local restore proof.
    const proof={...item,drive:null};
    // A metadata publisher may publish the same immutable backup again. Keep
    // its first receipt; only the report's publication time may advance.
    if(oldReceipt){const previous=JSON.parse(oldReceipt.payload);if(JSON.stringify({...previous,reportedAt:null})!==JSON.stringify({...proof,reportedAt:null})||proof.reportedAt<previous.reportedAt)throw new AppError('La evidencia de una copia ya registrada cambió. Se conserva el recibo anterior.',409)}
    db.db.prepare('INSERT OR IGNORE INTO resource_backup_receipts VALUES(?,?,?,?)').run(c.scope,item.ref,item.backupAt,JSON.stringify(proof));
   }
   db.db.prepare('INSERT INTO resource_backup_reports VALUES(?,?,?,NULL) ON CONFLICT(scope) DO UPDATE SET payload=excluded.payload,attempted=excluded.attempted,error=NULL').run(c.scope,JSON.stringify(sample),now());
   db.db.exec('RELEASE resource_backup_read');return {updated:true};
  }catch(e){db.db.exec('ROLLBACK TO resource_backup_read; RELEASE resource_backup_read');throw e}
 }catch(e){const message=e instanceof AppError?e.message:'No se pudo consultar la evidencia de respaldos.';if(connection(db)?.scope===c.scope)db.db.prepare('INSERT INTO resource_backup_reports VALUES(?,NULL,?,?) ON CONFLICT(scope) DO UPDATE SET attempted=excluded.attempted,error=excluded.error').run(c.scope,now(),message);throw e instanceof AppError?e:new AppError(message,502)}
}
export function resourceBackupsReport(db,{now=Date.now()}={}){
 tables(db);const c=connection(db),catalog=inventoryCatalog(db,now),row=c?db.db.prepare('SELECT * FROM resource_backup_reports WHERE scope=?').get(c.scope):null,s=row?.payload?JSON.parse(row.payload):null;
 const fresh=!!s&&!row.error&&db.collectorStatus().enabled&&s.sampledAt<=now+30000&&now-s.sampledAt<=ttl;
 const current=new Map((s?.items??[]).map(i=>[i.ref,i])),recovery=readRecoveryChecks(db,{now});
 const items=catalog.nodes.filter(n=>n.provider==='Coolify'&&(n.type==='database'||n.type.startsWith('standalone-'))).map(n=>{
  let latest=current.get(n.ref)??null;
  const verified=verifiedRecoveryReceipt(latest,n.ref,recovery.jobs),proof=verified!==latest;
  // Separate proof for this exact archive; never rewrite the original worker receipt.
  latest=verified;
  const history=c?db.db.prepare('SELECT payload FROM resource_backup_receipts WHERE scope=? AND ref=? ORDER BY backup DESC LIMIT 5').all(c.scope,n.ref).map(r=>JSON.parse(r.payload)):[],lastRestored=proof?latest:history.find(r=>r.restored)??null;
  const state=!latest?'unknown':!fresh||n.stale?'stale':latest.state==='failed'||latest.state==='invalid'?'failed':latest.state==='running'?'working':latest.state==='missing'?'unknown':now-latest.backupAt>25*3600000?'overdue':latest.restored?'restored':'unverified';
  const parent=catalog.byRef.size?[...catalog.nodes].find(p=>p.provider==='Coolify'&&p.kind==='resource'&&p.id===n.parentId):null;
  return {ref:n.ref,name:parent?parent.name+' / '+n.name:n.name,parentId:n.parentId,parentRef:parent?.ref??null,resourceId:n.id,type:n.type,status:n.status,healthSource:n.source,healthCheckedAt:n.checkedAt,healthStale:n.stale,state,latest,lastRestored,history};
 });
 return {sampledAt:s?.sampledAt??null,expiresAt:s?s.sampledAt+ttl:null,attemptedAt:row?.attempted??null,status:!s?'unconfigured':!fresh?'stale':'observed',error:row?.error??null,items,counts:{total:items.length,restored:items.filter(i=>i.state==='restored').length,attention:items.filter(i=>['failed','overdue'].includes(i.state)).length,unknown:items.filter(i=>['unknown','stale','unverified'].includes(i.state)).length},coverage:'Lectura de informes de trabajadores existentes. Restauración local según su comprobante; no nueva restauración ni acceso a datos. Drive acredita inclusión en el lote diario, no restauración externa de esa versión individual.'};
}
