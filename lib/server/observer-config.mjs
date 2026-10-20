import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {openSync,closeSync,readFileSync,writeFileSync,fstatSync,constants} from 'node:fs';
import path from 'node:path';
import {AppError} from './store.mjs';
import {clientConfig} from '../../deploy/observer/lib/client.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
export function observerTables(db){db.db.exec('CREATE TABLE IF NOT EXISTS observer_connection(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision TEXT NOT NULL,sealed TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observer_reader_state(scope TEXT PRIMARY KEY,payload TEXT,attempted INTEGER,error TEXT,lease TEXT,lease_expires INTEGER); CREATE TABLE IF NOT EXISTS observer_mail_reader_state(scope TEXT PRIMARY KEY,payload TEXT,attempted INTEGER,error TEXT);')}
function row(db){observerTables(db);return db.db.prepare('SELECT * FROM observer_connection WHERE id=1').get()}
function activation(db,create=false){const file=path.join(db.root,'.keys/observer-reader-instance.key');let fd;
 try{if(create){try{writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}}
 fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const st=fstatSync(fd);if(!st.isFile()||st.size!==32||(st.mode&0o077)!==0)throw new Error();return digest(readFileSync(fd));
 }catch{if(create)throw new AppError('No se pudo comprobar la identidad privada del lector.',503);return null}finally{if(fd!==undefined)closeSync(fd)}
}
export function observerConnection(db){const r=row(db);if(!r)return {url:'',configurationHash:'',enabled:false,mailReadEnabled:false,activated:false,hasKey:false,revision:'initial'};const c=JSON.parse(r.value);return {url:c.url,configurationHash:c.configurationHash,enabled:c.enabled,mailReadEnabled:c.mailReadEnabled===true,activated:activation(db)===c.activationHash,hasKey:true,revision:r.revision}}
export function observerScope(db){const r=row(db);if(!r)return null;const c=JSON.parse(r.value);return digest(JSON.stringify([c.url,c.configurationHash,c.identity]))}
const aad=value=>'OBSERVER:READ:'+value.url+':'+value.configurationHash;
export function sealObserverKey(key,value,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad(value)));const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64')).join('.')}
export function observerKey(db){const r=row(db);if(!r)return null;try{const value=JSON.parse(r.value),[iv,tag,bytes]=r.sealed.split('.').map(b=>Buffer.from(b,'base64')),cipher=createDecipheriv('aes-256-gcm',db.key,iv);cipher.setAAD(Buffer.from(aad(value)));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(bytes),cipher.final()]).toString('utf8')}catch{throw new AppError('El acceso del observador no puede descifrarse. Recupera su clave original.',503)}}
export function configureObserver(db,{revision,url,configurationHash,enabled,mailReadEnabled,readSecret}){
 observerTables(db);db.db.exec('BEGIN IMMEDIATE');try{
  const old=observerConnection(db),raw=row(db),oldValue=raw?JSON.parse(raw.value):null;
  if(revision!==old.revision)throw new AppError('La conexión del observador cambió. Vuelve a cargarla.',409);
  if(typeof enabled!=='boolean'||typeof configurationHash!=='string'||!/^[a-f0-9]{64}$/.test(configurationHash))throw new AppError('Revisa el estado y la huella de configuración del observador.');
  if(mailReadEnabled!==undefined&&typeof mailReadEnabled!=='boolean')throw new AppError('Revisa la lectura del estado de correo.');
  const secret=readSecret===undefined?observerKey(db):readSecret;let checked;try{checked=clientConfig({url,readSecret:secret})}catch{throw new AppError('Usa un origen HTTPS y la clave exclusiva de lectura del observador.')}
  if(readSecret===undefined&&(!oldValue||checked.url!==oldValue.url||configurationHash!==oldValue.configurationHash))throw new AppError('Una dirección o configuración nueva necesita su clave de lectura revisada.',409);
  if(db.listCredentials().some(c=>db.credential(c.provider)===secret))throw new AppError('Usa la clave exclusiva del observador; no reutilices un token de proveedor.');
  if(checked.url.includes(secret)||configurationHash.includes(secret))throw new AppError('La configuración no puede incluir una clave.');
  const same=oldValue&&oldValue.url===checked.url&&oldValue.configurationHash===configurationHash&&observerKey(db)===secret;
  const value={url:checked.url,configurationHash,enabled,mailReadEnabled:mailReadEnabled??(same&&oldValue.mailReadEnabled===true),identity:same?oldValue.identity:randomUUID(),activationHash:enabled?activation(db,true):oldValue?.activationHash??null};
  const sealed=sealObserverKey(db.key,value,secret);
  db.db.prepare('INSERT INTO observer_connection VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,sealed=excluded.sealed').run(JSON.stringify(value),randomUUID(),sealed);
  db.db.exec('UPDATE observer_reader_state SET lease=NULL,lease_expires=NULL');db.record('observer_reader_configured');db.db.exec('COMMIT');return observerConnection(db);
 }catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}
}
export function recoverObserver(db){observerTables(db);observerKey(db);const r=row(db);if(r){const value=JSON.parse(r.value);value.enabled=false;value.mailReadEnabled=false;db.db.prepare('UPDATE observer_connection SET value=?,revision=? WHERE id=1').run(JSON.stringify(value),randomUUID())}db.db.exec('UPDATE observer_reader_state SET lease=NULL,lease_expires=NULL')}
