import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {AppError} from './store.mjs';
import {notificationReport} from './notifications.mjs';
import {sendResend} from './resend.mjs';

const lifetime=15*60000,day=86400000;
const hash=value=>createHash('sha256').update(value).digest('hex');
const validCode=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const equal=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
function transaction(db,fn){db.db.exec('BEGIN IMMEDIATE');try{const result=fn();db.db.exec('COMMIT');return result}catch(e){db.db.exec('ROLLBACK');throw e}}
export function emailRecoveryTables(db){
 db.db.exec(`CREATE TABLE IF NOT EXISTS email_recovery_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,recipient TEXT,mail_binding TEXT,verified INTEGER,code_hash TEXT);
 CREATE TABLE IF NOT EXISTS email_recovery_challenge(id INTEGER PRIMARY KEY CHECK(id=1),token_hash TEXT NOT NULL,owner_stamp TEXT NOT NULL,mail_binding TEXT NOT NULL,recipient TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS email_recovery_delivery(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL);
 INSERT OR IGNORE INTO email_recovery_config(id) VALUES(1);`);
}
function mail(db){const report=notificationReport(db);return {...report,binding:hash(JSON.stringify([report.revision,report.sender,report.recipient,db.credentialIdentity('Resend')]))}}
function config(db){return db.db.prepare('SELECT * FROM email_recovery_config WHERE id=1').get()}
export function emailRecoveryReport(db){
 emailRecoveryTables(db);const c=config(db),m=mail(db),pending=db.db.prepare('SELECT expires,mail_binding,owner_stamp FROM email_recovery_challenge WHERE id=1').get();
 return {enabled:Boolean(c.enabled&&m.ready&&c.mail_binding===m.binding),needsReview:Boolean(c.enabled&&(!m.ready||c.mail_binding!==m.binding)),recipient:c.recipient,verifiedAt:c.verified,mailReady:m.ready,proposedRecipient:m.recipient,sender:m.sender,pendingUntil:pending&&pending.expires>Date.now()&&pending.owner_stamp===db.ownerStamp()&&pending.mail_binding===m.binding?pending.expires:null,dailyLimit:3,lastDelivery:db.db.prepare('SELECT kind,state,created FROM email_recovery_delivery ORDER BY created DESC,id DESC LIMIT 1').get()??null};
}
function invalidateEmailCode(db){const c=config(db);if(c.code_hash)db.db.prepare('DELETE FROM account_recovery WHERE token_hash=?').run(c.code_hash);db.db.prepare('UPDATE email_recovery_config SET code_hash=NULL WHERE id=1').run()}
export function disableEmailRecovery(db){emailRecoveryTables(db);transaction(db,()=>{invalidateEmailCode(db);db.db.exec('UPDATE email_recovery_config SET enabled=0; DELETE FROM email_recovery_challenge');db.record('email_recovery_disabled')})}
export function recoverEmailRecovery(db){emailRecoveryTables(db);disableEmailRecovery(db)}
function reserve(db,kind,now){
 db.db.prepare('DELETE FROM email_recovery_delivery WHERE created<?').run(now-30*day);
 if(db.db.prepare('SELECT COUNT(*) n FROM email_recovery_delivery WHERE kind=? AND created>?').get(kind,now-day).n>=3)return null;
 if(db.db.prepare('SELECT id FROM email_recovery_delivery WHERE kind=? AND created>?').get(kind,now-60000))return null;
 const id=randomUUID();db.db.prepare("INSERT INTO email_recovery_delivery VALUES(?,?,?,'sending')").run(id,kind,now);return id;
}
async function dispatch(db,prepared,send){
 let result;try{result=await send(prepared.token,prepared.body,'conectados/recovery/'+prepared.id)}catch{result={accepted:false,ambiguous:true}}
 transaction(db,()=>{
  const current=mail(db),same=current.ready&&current.binding===prepared.binding&&db.ownerStamp()===prepared.stamp;
  const state=result.accepted?'accepted':result.ambiguous?'uncertain':'failed';
  db.db.prepare('UPDATE email_recovery_delivery SET state=? WHERE id=?').run(state,prepared.id);
  if(!same||state==='failed'){
   if(prepared.kind==='verification')db.db.prepare('DELETE FROM email_recovery_challenge WHERE token_hash=?').run(prepared.codeHash);
   else{db.db.prepare('DELETE FROM account_recovery WHERE token_hash=?').run(prepared.codeHash);db.db.prepare('UPDATE email_recovery_config SET code_hash=NULL WHERE code_hash=?').run(prepared.codeHash)}
  }
  db.record('email_recovery_'+prepared.kind+'_'+state);
 });
 return {ok:true}; // No provider errors, addresses or codes in public responses.
}
function message(m,code,kind){return JSON.stringify({from:m.sender,to:[m.recipient],subject:kind==='verification'?'ConectadOS · confirma la recuperación por correo':'ConectadOS · código de recuperación',text:kind==='verification'?`Solicitaste habilitar la recuperación por correo desde la configuración privada de ConectadOS. Introduce este código allí para confirmar que recibes los mensajes:\n\n${code}\n\nCaduca en 15 minutos y solo sirve una vez. Si no lo solicitaste, ignora este mensaje. No compartas el código ni lo pegues en un chat.`:`Se solicitó recuperar el acceso a tu instalación ConectadOS. Introduce este código en «Recuperar acceso» y elige tu nueva contraseña:\n\n${code}\n\nCaduca en 15 minutos y solo sirve una vez. Prepararlo no cambia tu contraseña. Si no lo solicitaste, ignora este mensaje. No compartas el código ni lo pegues en un chat.`})}
export async function beginEmailVerification(db,{token,stamp,recipient,confirm},{send=sendResend,now=Date.now()}={}){
 emailRecoveryTables(db);const prepared=transaction(db,()=>{
  if(!db.authenticate(token)||stamp!==db.ownerStamp())throw new AppError('Vuelve a entrar antes de configurar la recuperación.',401);
  const m=mail(db);if(confirm!==true||!m.ready||recipient!==m.recipient)throw new AppError('Revisa el destinatario y comprueba primero el correo en Avisos.',409);
  const pending=db.db.prepare('SELECT expires,mail_binding,owner_stamp FROM email_recovery_challenge WHERE id=1').get();if(pending?.expires>now&&pending.mail_binding===m.binding&&pending.owner_stamp===stamp)throw new AppError('Usa el código ya enviado o espera a que caduque.',409);
  const id=reserve(db,'verification',now);if(!id)throw new AppError('Espera antes de pedir otro correo. Máximo tres verificaciones por 24 horas.',429);
  invalidateEmailCode(db);db.db.exec('UPDATE email_recovery_config SET enabled=0');
  const code=randomBytes(32).toString('base64url'),codeHash=hash(code);
  db.db.prepare('INSERT OR REPLACE INTO email_recovery_challenge VALUES(1,?,?,?,?,?,?)').run(codeHash,stamp,m.binding,m.recipient,now,now+lifetime);
  return {id,kind:'verification',codeHash,binding:m.binding,stamp,token:db.credential('Resend'),body:message(m,code,'verification')};
 });
 return dispatch(db,prepared,send);
}
export function confirmEmailVerification(db,{token,code,confirm}){
 emailRecoveryTables(db);db.takeAttempt('email_verification');transaction(db,()=>{
  if(!db.authenticate(token))throw new AppError('Inicia sesión.',401);
  const m=mail(db),row=db.db.prepare('SELECT * FROM email_recovery_challenge WHERE id=1').get();
  if(confirm!==true||!validCode(code)||!row||row.expires<=Date.now()||row.owner_stamp!==db.ownerStamp()||!m.ready||row.mail_binding!==m.binding||!equal(row.token_hash,hash(code)))throw new AppError('El código no es válido, caducó o cambió la configuración de correo.',403);
  db.db.prepare('UPDATE email_recovery_config SET enabled=1,recipient=?,mail_binding=?,verified=? WHERE id=1').run(row.recipient,m.binding,Date.now());db.db.exec('DELETE FROM email_recovery_challenge');db.clearAttempts('email_verification');db.record('email_recovery_verified');
 });return {ok:true};
}
export async function requestEmailRecovery(db,{send=sendResend,now=Date.now()}={}){
 emailRecoveryTables(db);const prepared=transaction(db,()=>{
  const c=config(db),m=mail(db),stamp=db.ownerStamp();
  if(!c.enabled||!stamp||!m.ready||c.mail_binding!==m.binding)return null;
  // Public requests cannot invalidate a still usable email or filesystem code.
  const active=db.db.prepare('SELECT expires,owner_stamp FROM account_recovery WHERE id=1').get();if(active&&active.expires>now&&active.owner_stamp===stamp)return null;
  const id=reserve(db,'recovery',now);if(!id)return null;
  const code=randomBytes(32).toString('base64url'),codeHash=hash(code);
  db.db.prepare('INSERT OR REPLACE INTO account_recovery VALUES(1,?,?,?,?)').run(codeHash,stamp,now,now+lifetime);db.db.prepare('UPDATE email_recovery_config SET code_hash=? WHERE id=1').run(codeHash);
  return {id,kind:'recovery',codeHash,binding:m.binding,stamp,token:db.credential('Resend'),body:message(m,code,'recovery')};
 });
 if(prepared)await dispatch(db,prepared,send);return {ok:true};
}
