import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,timingSafeEqual,scrypt,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {dashboardHistorySample} from '../dashboard-history.mjs';
import {STATE_FORMAT,assertStateFormat} from './state-format.mjs';
const derive=promisify(scrypt);
const hash=(value)=>createHash('sha256').update(value).digest('hex');
export class AppError extends Error {constructor(message,status=400){super(message);this.status=status}}
export const providerNames=['Coolify','Cloudflare','Vercel','Hostinger','Supabase','Google Drive','Resend'];
const ttl=8*60*60*1000;
function equal(a,b){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}
async function passwordHash(password,salt){return (await derive(password,salt,64,{N:131072,r:8,p:1,maxmem:160*1024*1024})).toString('hex')}
function validPassword(value){if(typeof value!=='string'||value.length<15||value.length>128)throw new AppError('Usa una contraseña de 15 a 128 caracteres.');return value}
function ownerStamp(owner){return owner?hash(JSON.stringify([owner.username,owner.salt,owner.password_hash])):null}
export class Store {
 constructor(root){
  this.root=root;const data=path.join(root,'.data');const keys=path.join(root,'.keys');
  mkdirSync(data,{recursive:true,mode:0o700});mkdirSync(keys,{recursive:true,mode:0o700});
  const dbPath=path.join(data,'conectados.sqlite');const keyPath=path.join(keys,'vault.key');
  if(existsSync(dbPath)&&!existsSync(keyPath))throw new AppError('Falta la clave de cifrado original. Restaura .keys antes de continuar.',503);
  if(!existsSync(keyPath)){try{writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}}
  this.key=readFileSync(keyPath);if(this.key.length!==32)throw new AppError('La clave de cifrado no es válida.',503);
  this.db=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);
  try{this.db.exec('PRAGMA busy_timeout=5000');assertStateFormat(this.db)}catch(e){this.db.close();throw new AppError(e.message,503)}
  this.db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS account_recovery(id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL,owner_stamp TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS credentials(provider TEXT PRIMARY KEY,label TEXT NOT NULL,sealed TEXT NOT NULL,updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS credential_crypto_identity(provider TEXT PRIMARY KEY REFERENCES credentials(provider) ON DELETE CASCADE,identity TEXT NOT NULL,sealed_hash TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,event TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS attempts(kind TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS google_auth(id INTEGER PRIMARY KEY CHECK(id=1),client_id TEXT NOT NULL,subject TEXT,email TEXT,revision INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE IF NOT EXISTS google_flows(nonce_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,mode TEXT NOT NULL,owner_session TEXT,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS coolify_connection(id INTEGER PRIMARY KEY CHECK(id=1),url TEXT NOT NULL,snapshot TEXT,error TEXT,attempted INTEGER);
   CREATE TABLE IF NOT EXISTS collector_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,heartbeat INTEGER,error TEXT);
   INSERT OR IGNORE INTO collector_config(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS collection_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS observation_history(id INTEGER PRIMARY KEY,source TEXT NOT NULL,checked INTEGER NOT NULL,snapshot TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS provider_connections(provider TEXT PRIMARY KEY,scope TEXT NOT NULL,snapshot TEXT,error TEXT,attempted INTEGER);
   CREATE TABLE IF NOT EXISTS provider_collection_lease(provider TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS resource_logos(ref TEXT PRIMARY KEY,provider TEXT NOT NULL,resource_id TEXT NOT NULL,digest TEXT NOT NULL,content BLOB NOT NULL,updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS web_probes(id TEXT PRIMARY KEY,label TEXT NOT NULL,url TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,snapshot TEXT);
   CREATE TABLE IF NOT EXISTS web_probe_history(id INTEGER PRIMARY KEY,probe_id TEXT NOT NULL REFERENCES web_probes(id) ON DELETE CASCADE,checked INTEGER NOT NULL,snapshot TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS web_probe_history_resource ON web_probe_history(probe_id,id);
   CREATE TABLE IF NOT EXISTS incident_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 1);
   INSERT OR IGNORE INTO incident_config(id) VALUES(1);
   CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,incident_key TEXT NOT NULL,scope TEXT NOT NULL,state TEXT NOT NULL,signature TEXT NOT NULL,payload TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,acknowledged INTEGER,closed INTEGER,close_reason TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS incident_active_key ON incidents(incident_key) WHERE state IN ('open','acknowledged');
   CREATE INDEX IF NOT EXISTS incident_scope ON incidents(scope,state,last_seen);
   CREATE TABLE IF NOT EXISTS incident_events(id INTEGER PRIMARY KEY,incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,event TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS incident_events_parent ON incident_events(incident_id,id);
   CREATE TABLE IF NOT EXISTS notification_config(id INTEGER PRIMARY KEY CHECK(id=1),sender TEXT,recipient TEXT,include_details INTEGER NOT NULL DEFAULT 0,daily_limit INTEGER NOT NULL DEFAULT 10,enabled INTEGER NOT NULL DEFAULT 0,generation TEXT NOT NULL,started INTEGER,muted_until INTEGER,test_identity TEXT,test_accepted INTEGER);
   INSERT OR IGNORE INTO notification_config(id,generation) VALUES(1,lower(hex(randomblob(16))));
   CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,dedup_key TEXT NOT NULL UNIQUE,generation TEXT NOT NULL,credential_identity TEXT NOT NULL,incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,revision TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER,next_attempt INTEGER NOT NULL,lease_until INTEGER,accepted INTEGER,provider_id TEXT,error TEXT);
   CREATE INDEX IF NOT EXISTS notification_pending ON notification_outbox(state,next_attempt);
   CREATE TABLE IF NOT EXISTS notification_seen(dedup_key TEXT PRIMARY KEY,incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE,generation TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS topology_relations(id TEXT PRIMARY KEY,from_ref TEXT NOT NULL,to_ref TEXT NOT NULL,from_scope TEXT NOT NULL,to_scope TEXT NOT NULL,kind TEXT NOT NULL,note TEXT NOT NULL,revision TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(from_ref,to_ref,kind));
   CREATE TABLE IF NOT EXISTS inventory_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,description TEXT NOT NULL,color TEXT NOT NULL,revision TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS inventory_annotations(ref TEXT PRIMARY KEY,scope TEXT NOT NULL,project_id TEXT REFERENCES inventory_projects(id) ON DELETE SET NULL,tags TEXT NOT NULL,revision TEXT NOT NULL,updated INTEGER NOT NULL);
   INSERT OR IGNORE INTO settings VALUES(1,'{"providers":[],"ai":"none","voice":false}');`);
  this.db.exec(`PRAGMA user_version=${STATE_FORMAT}`);
  if(!this.hasOwner()){
   const tokenPath=path.join(keys,'setup-token');
   if(!existsSync(tokenPath)){try{writeFileSync(tokenPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}}
  }
 }
 close(){this.db.close()}
 webProbes(){
  return this.db.prepare('SELECT * FROM web_probes ORDER BY label').all().map(p=>({id:p.id,label:p.label,url:p.url,enabled:Boolean(p.enabled),revision:p.revision,snapshot:p.snapshot?JSON.parse(p.snapshot):null,history:this.db.prepare('SELECT snapshot FROM web_probe_history WHERE probe_id=? ORDER BY id DESC LIMIT 60').all(p.id).map(r=>JSON.parse(r.snapshot))}));
 }
 configureWebProbe({id,label,url,enabled}){
  if(id!==undefined&&(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw new AppError('Identificador de comprobación no válido.');
  if(typeof label!=='string'||!label.trim()||label.length>100||typeof enabled!=='boolean')throw new AppError('Indica un nombre de hasta 100 caracteres y si quieres observarlo automáticamente.');
  try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!['','/'].includes(parsed.pathname)||parsed.origin!==url||!parsed.hostname.includes('.')||!/[a-z]/i.test(parsed.hostname)||parsed.hostname.startsWith('['))throw Error()}catch{throw new AppError('Dirección HTTPS principal no válida.')}
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=id?this.db.prepare('SELECT * FROM web_probes WHERE id=?').get(id):null;
   if(id&&!old)throw new AppError('Comprobación no encontrada.',404);
   if(this.db.prepare('SELECT id FROM web_probes WHERE url=? AND id!=?').get(url,id??''))throw new AppError('Esta dirección ya tiene una comprobación.',409);
   if(!old&&this.db.prepare('SELECT COUNT(*) n FROM web_probes').get().n>=20)throw new AppError('Esta instalación admite hasta 20 direcciones.',409);
   const key=id??randomUUID();
   if(old){if(old.url!==url)this.db.prepare('DELETE FROM web_probe_history WHERE probe_id=?').run(key);this.db.prepare('UPDATE web_probes SET label=?,url=?,enabled=?,revision=revision+1,snapshot=CASE WHEN url=? THEN snapshot ELSE NULL END WHERE id=?').run(label.trim(),url,Number(enabled),url,key)}
   else this.db.prepare('INSERT INTO web_probes VALUES(?,?,?,?,1,NULL)').run(key,label.trim(),url,Number(enabled));
   this.record('web_probe_configured');this.db.exec('COMMIT');return key;
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 removeWebProbe(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new AppError('Identificador de comprobación no válido.');const result=this.db.prepare('DELETE FROM web_probes WHERE id=?').run(id);if(!result.changes)throw new AppError('Comprobación no encontrada.',404);this.record('web_probe_removed')}
 saveWebProbeResult(id,revision,result){
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare('SELECT * FROM web_probes WHERE id=?').get(id);
   if(!row||row.revision!==revision)throw new AppError('La comprobación cambió durante la consulta.',409);
   const kinds=['response','redirect','protected','unsupported','http-error','unreachable','blocked'];
   if(result.source!==row.url||result.method!=='HEAD'||!kinds.includes(result.kind)||!Number.isSafeInteger(result.checkedAt)||Math.abs(result.checkedAt-Date.now())>30000||result.expiresAt!==result.checkedAt+300000)throw new AppError('Resultado de comprobación no compatible.',502);
   const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
   const current={source:row.url,method:'HEAD',checkedAt:result.checkedAt,expiresAt:result.expiresAt,kind:result.kind,httpStatus:integer(result.httpStatus,599),durationMs:integer(result.durationMs,30000),certificateExpiresAt:integer(result.certificateExpiresAt,8640000000000000),error:result.kind==='blocked'?'El destino no resuelve únicamente a IPv4 públicas. No se contactó.':result.kind==='unreachable'?'No se obtuvo una respuesta HTTPS válida. Revisa DNS, certificado y conectividad.':null};
   if((current.httpStatus===null)!==['unreachable','blocked'].includes(current.kind)||current.httpStatus!==null&&current.httpStatus<100)throw new AppError('Código HTTP no compatible.',502);
   if(current.httpStatus!==null){const code=current.httpStatus,expected=code>=200&&code<300?'response':code>=300&&code<400?'redirect':code===401||code===403?'protected':code===405?'unsupported':'http-error';if(current.kind!==expected||current.durationMs===null)throw new AppError('Clasificación HTTP no compatible.',502)}
   const old=row.snapshot?JSON.parse(row.snapshot):null;
   current.lastResponse=current.httpStatus!==null?{checkedAt:current.checkedAt,httpStatus:current.httpStatus,durationMs:current.durationMs}:old?.lastResponse??null;
   const value=JSON.stringify(current);this.db.prepare('UPDATE web_probes SET snapshot=? WHERE id=?').run(value,id);this.db.prepare('INSERT INTO web_probe_history(probe_id,checked,snapshot) VALUES(?,?,?)').run(id,current.checkedAt,value);
   this.db.prepare('DELETE FROM web_probe_history WHERE checked<?').run(Date.now()-7*86400000);
   this.db.prepare('DELETE FROM web_probe_history WHERE probe_id=? AND id NOT IN (SELECT id FROM web_probe_history WHERE probe_id=? ORDER BY id DESC LIMIT 10080)').run(id,id);
   if(old?.kind!==current.kind||old?.httpStatus!==current.httpStatus)this.record('web_probe_status_changed');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 resourceLogoBinding(provider,resourceId){
  if(!['Coolify','Cloudflare','Vercel','Supabase','Hostinger'].includes(provider)||typeof resourceId!=='string'||!resourceId||resourceId.length>100)throw new AppError('Recurso no válido.');
  const connection=provider==='Coolify'?this.coolifyConnection():this.providerConnections().find(c=>c.provider===provider);
  if(!connection?.hasToken||!connection.snapshot?.resources.some(r=>r.id===resourceId))throw new AppError('El recurso no está en el inventario autorizado de esta conexión.',404);
  const ref=hash(JSON.stringify([provider,provider==='Coolify'?connection.url:connection.scope,connection.snapshot.source,resourceId]));
  return ref;
 }
 resourceLogoMetadata(){
  return this.db.prepare('SELECT ref,provider,resource_id,digest,updated FROM resource_logos ORDER BY updated DESC').all().filter(row=>{
   try{return this.resourceLogoBinding(row.provider,row.resource_id)===row.ref}catch{return false}
  }).map(row=>({ref:row.ref,provider:row.provider,resourceId:row.resource_id,revision:row.digest,updatedAt:row.updated}));
 }
 resourceLogo(ref){
  if(typeof ref!=='string'||!/^[a-f0-9]{64}$/.test(ref))throw new AppError('Logo no encontrado.',404);
  const row=this.db.prepare('SELECT * FROM resource_logos WHERE ref=?').get(ref);
  if(!row||this.resourceLogoBinding(row.provider,row.resource_id)!==ref)throw new AppError('Logo no disponible para esta conexión.',404);
  return Buffer.from(row.content);
 }
 saveResourceLogo(provider,resourceId,content,expectedRef){
  if(!Buffer.isBuffer(content)||content.length<8||content.length>100000||!content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new AppError('El logo debe estar convertido a PNG.');
  this.db.exec('BEGIN IMMEDIATE');try{
   const ref=this.resourceLogoBinding(provider,resourceId);
   if(ref!==expectedRef)throw new AppError('La conexión cambió durante la carga. Selecciona de nuevo el recurso.',409);
   const existing=this.db.prepare('SELECT digest FROM resource_logos WHERE ref=?').get(ref),digest=hash(content);
   if(existing?.digest!==digest){
    if(!existing&&this.db.prepare('SELECT COUNT(*) AS n FROM resource_logos').get().n>=500)throw new AppError('Se alcanzó el límite de 500 logos guardados.',409);
    this.db.prepare('INSERT INTO resource_logos VALUES(?,?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET digest=excluded.digest,content=excluded.content,updated=excluded.updated').run(ref,provider,resourceId,digest,content,Date.now());this.record('resource_logo_saved');
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 deleteResourceLogo(provider,resourceId){
  this.db.exec('BEGIN IMMEDIATE');try{
   const ref=this.resourceLogoBinding(provider,resourceId);
   if(this.db.prepare('DELETE FROM resource_logos WHERE ref=?').run(ref).changes)this.record('resource_logo_removed');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 hasOwner(){return Boolean(this.db.prepare('SELECT id FROM owner WHERE id=1').get())}
 record(event){this.db.prepare('INSERT INTO audit(event,created) VALUES(?,?)').run(event,Date.now())}
 takeAttempt(kind,limit=5,window=15*60*1000){
  const now=Date.now();const row=this.db.prepare('SELECT count,until FROM attempts WHERE kind=?').get(kind);
  if(row&&row.until>now&&row.count>=limit)throw new AppError('Demasiados intentos. Espera antes de volver a probar.',429);
  this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(kind) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END,until=CASE WHEN until<=? THEN ? ELSE until END').run(kind,now+window,now,now,now+window);
 }
 clearAttempts(kind){this.db.prepare('DELETE FROM attempts WHERE kind=?').run(kind)}
 async confirmOwner(password){
  this.takeAttempt('reauth');
  const owner=this.db.prepare('SELECT * FROM owner WHERE id=1').get();
  if(!owner||typeof password!=='string'||password.length>128||!equal(await passwordHash(password,owner.salt),owner.password_hash))throw new AppError('La contraseña actual no es correcta.',401);
  if(ownerStamp(owner)!==this.ownerStamp())throw new AppError('El acceso cambió mientras se verificaba. Vuelve a entrar.',409);
  this.clearAttempts('reauth');return ownerStamp(owner);
 }
 ownerStamp(){return ownerStamp(this.db.prepare('SELECT * FROM owner WHERE id=1').get())}
 commitPassword(salt,digest,event,unlinkGoogle=false){
  this.db.prepare('UPDATE owner SET salt=?,password_hash=? WHERE id=1').run(salt,digest);
  this.db.exec('DELETE FROM sessions; DELETE FROM google_flows; DELETE FROM account_recovery');
  this.db.exec(unlinkGoogle?'UPDATE google_auth SET subject=NULL,email=NULL,revision=revision+1 WHERE id=1':'UPDATE google_auth SET revision=revision+1 WHERE id=1');
  this.clearAttempts('login');this.clearAttempts('recovery');this.record(event);
 }
 async changePassword({token,password,newPassword,confirmation}){
  if(!this.authenticate(token))throw new AppError('Inicia sesión.',401);
  const stamp=this.ownerStamp();await this.confirmOwner(password);
  if(newPassword!==confirmation)throw new AppError('Las contraseñas nuevas deben coincidir.');
  const salt=randomBytes(16).toString('hex'),digest=await passwordHash(validPassword(newPassword),salt);
  this.db.exec('BEGIN IMMEDIATE');try{
   if(!this.authenticate(token)||stamp!==this.ownerStamp())throw new AppError('El acceso cambió. Vuelve a entrar.',409);
   this.commitPassword(salt,digest,'owner_password_changed');this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 /** @param {Record<string,unknown>} input */
 async recoverPassword({code,newPassword,confirmation,unlinkGoogle=false}){
  this.takeAttempt('recovery');
  const row=this.db.prepare('SELECT * FROM account_recovery WHERE id=1').get(),stamp=this.ownerStamp();
  if(typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code)||!row||row.expires<=Date.now()||row.owner_stamp!==stamp||!equal(row.token_hash,hash(code)))throw new AppError('El código de recuperación no es válido o ya caducó.',403);
  if(typeof unlinkGoogle!=='boolean'||newPassword!==confirmation)throw new AppError('Revisa las contraseñas nuevas y la opción de Google.');
  const salt=randomBytes(16).toString('hex'),digest=await passwordHash(validPassword(newPassword),salt);
  this.db.exec('BEGIN IMMEDIATE');try{
   const latest=this.db.prepare('SELECT * FROM account_recovery WHERE id=1').get();
   if(!latest||latest.token_hash!==row.token_hash||latest.expires<=Date.now()||stamp!==this.ownerStamp())throw new AppError('El código de recuperación no es válido o ya caducó.',403);
   this.commitPassword(salt,digest,'owner_password_recovered',unlinkGoogle);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 googleConfig(){return this.db.prepare('SELECT client_id,subject,email,revision FROM google_auth WHERE id=1').get()??null}
 googleStatus(){const config=this.googleConfig();return {configured:Boolean(config),linked:Boolean(config?.subject),clientId:config?.client_id??'',email:config?.email??null}}
 saveGoogleClient(clientId){
  if(typeof clientId!=='string'||clientId.length>250||!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))throw new AppError('Introduce el Client ID de un cliente OAuth web de Google.');
  const config=this.googleConfig();if(config?.subject&&config.client_id!==clientId)throw new AppError('Desvincula tu cuenta antes de cambiar el cliente de Google.',409);
  this.db.prepare('INSERT INTO google_auth(id,client_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,revision=revision+1').run(clientId);
  this.db.exec('DELETE FROM google_flows');this.record('google_configured');
 }
 beginGoogle(mode,token){
  const config=this.googleConfig();
  if(!config||!this.hasOwner())throw new AppError('Primero configura el acceso con Google desde tu cuenta local.',409);
  if(!['link','login'].includes(mode))throw new AppError('Acción no válida.');
  if(mode==='link'&&!this.authenticate(token))throw new AppError('Inicia sesión para vincular Google.',401);
  if(mode==='login'&&!config.subject)throw new AppError('El administrador todavía no ha vinculado su cuenta Google.',409);
  this.takeAttempt('google_'+mode);
  const nonce=randomBytes(32).toString('base64url');const browser=randomBytes(32).toString('base64url');
  this.db.prepare('DELETE FROM google_flows WHERE expires<=?').run(Date.now());
  this.db.prepare('INSERT INTO google_flows VALUES(?,?,?,?,?)').run(hash(nonce),hash(browser),mode,mode==='link'?hash(token):null,Date.now()+5*60*1000);
  return {nonce,browser,clientId:config.client_id};
 }
 consumeGoogle(nonce,browser,token){
  if(typeof nonce!=='string'||nonce.length>100||typeof browser!=='string'||browser.length>100)throw new AppError('Solicitud de Google no válida. Vuelve a comenzar.',403);
  const flow=this.db.prepare('SELECT * FROM google_flows WHERE nonce_hash=?').get(hash(nonce));
  if(!flow||flow.expires<=Date.now()||!equal(flow.browser_hash,hash(browser)))throw new AppError('Solicitud de Google vencida o de otro navegador. Vuelve a comenzar.',403);
  this.db.prepare('DELETE FROM google_flows WHERE nonce_hash=?').run(hash(nonce));
  if(flow.mode==='link'&&(!this.authenticate(token)||!equal(flow.owner_session,hash(token))))throw new AppError('La sesión usada para vincular Google ya no está activa.',403);
  return {mode:flow.mode,ownerSession:flow.owner_session,configRevision:this.googleConfig().revision};
 }
 finishGoogle(flow,identity){
  this.db.exec('BEGIN IMMEDIATE');try{
  const config=this.googleConfig();
  if(!config||config.revision!==flow.configRevision)throw new AppError('La configuración de Google cambió. Vuelve a comenzar.',409);
  if(flow.mode==='link'){
   if(!this.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').get(flow.ownerSession,Date.now()))throw new AppError('La sesión de vinculación caducó.',403);
   if(config.subject&&config.subject!==identity.sub)throw new AppError('Ya hay otra cuenta Google vinculada. Desvincúlala antes de continuar.',409);
   this.db.prepare('UPDATE google_auth SET subject=?,email=? WHERE id=1').run(identity.sub,identity.email);this.record('google_linked');
  }else if(!config?.subject||config.subject!==identity.sub){this.record('google_denied');throw new AppError('Esta cuenta Google no está autorizada para esta instalación.',403)}
  this.clearAttempts('google_'+flow.mode);this.record('google_login');const session=this.session();this.db.exec('COMMIT');return session;
  }catch(e){this.db.exec('ROLLBACK');this.record('google_denied');throw e}
 }
 unlinkGoogle(token){
  this.db.prepare('UPDATE google_auth SET subject=NULL,email=NULL,revision=revision+1 WHERE id=1').run();this.db.exec('DELETE FROM google_flows');
  this.db.prepare('DELETE FROM sessions WHERE token_hash!=?').run(hash(token));this.record('google_unlinked');
 }
 hasCredential(provider){return Boolean(this.db.prepare('SELECT provider FROM credentials WHERE provider=?').get(provider))}
 credentialIdentity(provider){const row=this.db.prepare('SELECT c.sealed,i.identity,i.sealed_hash FROM credentials c LEFT JOIN credential_crypto_identity i ON i.provider=c.provider WHERE c.provider=?').get(provider);if(!row)return null;const fingerprint=hash(row.sealed);return row.sealed_hash===fingerprint?row.identity:fingerprint}
 coolifyConnection(){const row=this.db.prepare('SELECT * FROM coolify_connection WHERE id=1').get();return row?{url:row.url,snapshot:row.snapshot?JSON.parse(row.snapshot):null,error:row.error,attempted:row.attempted,hasToken:this.hasCredential('Coolify')}:null}
 configureCoolify(url,token){
  const old=this.coolifyConnection();
  if(typeof token==='string'&&token.trim())this.saveCredential('Coolify','ConectadOS · lectura',token.trim());else if(!old||old.url!==url||!old.hasToken)throw new AppError('Pega un token dedicado de lectura para esta dirección.',409);
  this.db.prepare('INSERT INTO coolify_connection(id,url) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot=CASE WHEN url=excluded.url THEN snapshot ELSE NULL END,error=NULL,url=excluded.url').run(url);this.record('coolify_configured');
 }
 saveCoolifySnapshot(url,snapshot,expectedIdentity){
  if(this.coolifyConnection()?.url!==url)throw new AppError('La dirección cambió durante la consulta. Vuelve a actualizar.',409);
  const old=this.coolifyConnection()?.snapshot;const value=JSON.stringify(snapshot);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(this.coolifyConnection()?.url!==url||(expectedIdentity!==undefined&&this.credentialIdentity('Coolify')!==expectedIdentity))throw new AppError('La conexión cambió durante la consulta.',409);
   this.db.prepare('UPDATE coolify_connection SET snapshot=?,error=NULL,attempted=? WHERE id=1').run(value,Date.now());
   this.db.prepare('INSERT INTO observation_history(source,checked,snapshot) VALUES(?,?,?)').run(url,snapshot.checkedAt,value);
   this.db.prepare('DELETE FROM observation_history WHERE checked<? OR id NOT IN(SELECT id FROM observation_history ORDER BY id DESC LIMIT 10080)').run(Date.now()-7*24*60*60*1000);
   const detailState=value=>(value?.serviceDetails??[]).map(d=>({serviceId:d.serviceId,components:d.components,error:d.error}));
   if(!old||JSON.stringify(old.resources)!==JSON.stringify(snapshot.resources)||JSON.stringify(detailState(old))!==JSON.stringify(detailState(snapshot)))this.record('coolify_refreshed');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 collectorStatus(){const row=this.db.prepare('SELECT * FROM collector_config WHERE id=1').get();return {enabled:Boolean(row.enabled),heartbeat:row.heartbeat,error:row.error,intervalMs:60000}}
 configureCollector(enabled){if(typeof enabled!=='boolean')throw new AppError('Elige si deseas activar la observación.');this.db.prepare('UPDATE collector_config SET enabled=? WHERE id=1').run(Number(enabled));this.record(enabled?'collector_enabled':'collector_disabled')}
 collectorHeartbeat(error=null){this.db.prepare('UPDATE collector_config SET heartbeat=?,error=? WHERE id=1').run(Date.now(),error)}
 acquireCollection(){const owner=randomBytes(16).toString('hex');const now=Date.now();const result=this.db.prepare('INSERT INTO collection_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<=?').run(owner,now+30000,now);return result.changes?owner:null}
 releaseCollection(owner){this.db.prepare('DELETE FROM collection_lease WHERE owner=?').run(owner)}
 observationHistory(){const url=this.coolifyConnection()?.url;if(!url)return [];return this.db.prepare('SELECT snapshot FROM observation_history WHERE source=? ORDER BY id DESC LIMIT 60').all(url).map(row=>dashboardHistorySample(JSON.parse(row.snapshot)))}
 providerConnections(){return this.db.prepare('SELECT * FROM provider_connections').all().map(row=>({provider:row.provider,scope:row.scope,snapshot:row.snapshot?JSON.parse(row.snapshot):null,error:row.error,attempted:row.attempted,hasToken:this.hasCredential(row.provider)}))}
 configureProvider(provider,scope,token){
  if(!['Vercel','Cloudflare','Supabase','Hostinger'].includes(provider))throw new AppError('Proveedor no soportado por este conector.');
  if(typeof scope!=='string'||scope.length>150)throw new AppError('Alcance no válido.');
  if(typeof token==='string'&&token.trim())this.saveCredential(provider,'ConectadOS · '+provider,token.trim());
  if(!this.hasCredential(provider))throw new AppError('Guarda primero el token de este proveedor.',409);
  this.db.prepare('INSERT INTO provider_connections(provider,scope) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET snapshot=CASE WHEN scope=excluded.scope THEN snapshot ELSE NULL END,attempted=CASE WHEN scope=excluded.scope THEN attempted ELSE NULL END,scope=excluded.scope,error=NULL').run(provider,scope);this.record('provider_configured');
 }
 saveProviderSnapshot(provider,scope,snapshot,identity){
  this.db.exec('BEGIN IMMEDIATE');try{
   const current=this.providerConnections().find(row=>row.provider===provider);
   if(current?.scope!==scope||this.credentialIdentity(provider)!==identity)throw new AppError('El acceso o alcance cambió durante la consulta.',409);
   this.db.prepare('UPDATE provider_connections SET snapshot=?,error=NULL,attempted=? WHERE provider=?').run(JSON.stringify(snapshot),Date.now(),provider);
   if(current.error||!current.snapshot||JSON.stringify(current.snapshot.resources)!==JSON.stringify(snapshot.resources)||JSON.stringify(current.snapshot.records)!==JSON.stringify(snapshot.records))this.record('provider_refreshed');this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 failProvider(provider,scope,message,identity){if(this.providerConnections().find(row=>row.provider===provider)?.scope===scope&&this.credentialIdentity(provider)===identity)this.db.prepare('UPDATE provider_connections SET error=?,attempted=? WHERE provider=?').run(message,Date.now(),provider)}
 acquireProvider(provider){const owner=randomBytes(16).toString('hex');const now=Date.now();const result=this.db.prepare('INSERT INTO provider_collection_lease VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<=?').run(provider,owner,now+35000,now);return result.changes?owner:null}
 releaseProvider(provider,owner){this.db.prepare('DELETE FROM provider_collection_lease WHERE provider=? AND owner=?').run(provider,owner)}
 failCoolify(url,message){this.db.prepare('UPDATE coolify_connection SET error=?,attempted=? WHERE id=1 AND url=?').run(message,Date.now(),url);this.record('coolify_failed')}
 async createOwner(token,username,password){
  if(this.hasOwner())throw new AppError('La cuenta administradora ya existe.',409);
  this.takeAttempt('setup');
  const expected=readFileSync(path.join(this.root,'.keys/setup-token'),'utf8').trim();
  if(typeof token!=='string'||!equal(hash(token),hash(expected)))throw new AppError('El código de instalación no es válido.',403);
  if(typeof username!=='string'||!/^[a-zA-Z0-9._-]{3,64}$/.test(username))throw new AppError('Usa un usuario de 3 a 64 letras, números, puntos o guiones.');
  const salt=randomBytes(16).toString('hex');const digest=await passwordHash(validPassword(password),salt);
  this.db.exec('BEGIN IMMEDIATE');
  try {if(this.hasOwner())throw new AppError('La cuenta administradora ya existe.',409);this.db.prepare('INSERT INTO owner VALUES(1,?,?,?)').run(username,salt,digest);this.record('owner_created');this.clearAttempts('setup');this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
  return this.session();
 }
 async login(username,password){
  this.takeAttempt('login');
  if(typeof password!=='string'||password.length>128||typeof username!=='string')throw new AppError('Usuario o contraseña incorrectos.',401);
  const owner=this.db.prepare('SELECT * FROM owner WHERE id=1').get();
  const digest=await passwordHash(password,owner?.salt??'dummy-salt');
  if(!owner||!equal(digest,owner.password_hash)||username!==owner.username){this.record('login_failed');throw new AppError('Usuario o contraseña incorrectos.',401)}
  this.db.exec('BEGIN IMMEDIATE');try{
   if(ownerStamp(owner)!==this.ownerStamp())throw new AppError('Usuario o contraseña incorrectos.',401);
   this.clearAttempts('login');this.record('login_success');const token=this.session();this.db.exec('COMMIT');return token;
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 session(){const token=randomBytes(32).toString('base64url');this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token),Date.now()+ttl);return token}
 authenticate(token){if(typeof token!=='string'||token.length>100)return false;return Boolean(this.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').get(hash(token),Date.now()))}
 logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));this.record('logout')}
 settings(){return JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get().value)}
 saveSettings(value){
  if(!Array.isArray(value?.providers)||value.providers.some(p=>!providerNames.includes(p))||!['none','commercial','local'].includes(value.ai)||typeof value.voice!=='boolean')throw new AppError('La configuración contiene opciones no válidas.');
  const safe={providers:[...new Set(value.providers)],ai:value.ai,voice:value.voice};
  this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(safe));this.record('settings_saved');return safe;
 }
 listCredentials(){return this.db.prepare('SELECT provider,label,updated FROM credentials ORDER BY provider').all()}
 saveCredential(provider,label,secret){
  if(!providerNames.includes(provider)||typeof label!=='string'||label.length<1||label.length>80||typeof secret!=='string'||secret.length<8||secret.length>4096)throw new AppError('Revisa el proveedor, la etiqueta y la longitud de la clave.');
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(provider));
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  const sealed=[iv,cipher.getAuthTag(),encrypted].map(v=>v.toString('base64')).join('.');
  this.db.exec('SAVEPOINT credential_change');try{
   this.db.prepare('INSERT INTO credentials VALUES(?,?,?,?) ON CONFLICT(provider) DO UPDATE SET label=excluded.label,sealed=excluded.sealed,updated=excluded.updated').run(provider,label,sealed,Date.now());this.record('credential_saved');
   this.resetCredentialObservation(provider);
   this.db.exec('RELEASE credential_change');
  }catch(e){this.db.exec('ROLLBACK TO credential_change; RELEASE credential_change');throw e}
 }
 // This method is only for server-side connectors; never send its result to a client.
 credential(provider){const row=this.db.prepare('SELECT sealed FROM credentials WHERE provider=?').get(provider);if(!row)return null;const [iv,tag,data]=row.sealed.split('.').map(v=>Buffer.from(v,'base64'));const decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAAD(Buffer.from(provider));decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8')}
 deleteCredential(provider){
  if(!providerNames.includes(provider))throw new AppError('Proveedor no válido.');
  this.db.exec('SAVEPOINT credential_change');try{
   this.db.prepare('DELETE FROM credentials WHERE provider=?').run(provider);this.resetCredentialObservation(provider);this.record('credential_deleted');
   this.db.exec('RELEASE credential_change');
  }catch(e){this.db.exec('ROLLBACK TO credential_change; RELEASE credential_change');throw e}
 }
 resetCredentialObservation(provider){
  if(provider==='Resend'){
   this.db.prepare('UPDATE notification_config SET enabled=0,generation=?,started=NULL,muted_until=NULL,test_identity=NULL,test_accepted=NULL WHERE id=1').run(randomUUID());
   this.db.exec("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error='Cambió el acceso de correo; no se harán más intentos.' WHERE state='queued'");this.record('notification_access_changed');
  }else if(provider==='Coolify')this.db.exec('UPDATE coolify_connection SET snapshot=NULL,error=NULL,attempted=NULL; DELETE FROM observation_history');
  else this.db.prepare('UPDATE provider_connections SET snapshot=NULL,error=NULL,attempted=NULL WHERE provider=?').run(provider);
 }
 audit(){return this.db.prepare('SELECT event,created FROM audit ORDER BY id DESC LIMIT 20').all()}
}
