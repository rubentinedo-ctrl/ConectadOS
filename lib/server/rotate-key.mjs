import {observerKey,sealObserverKey} from './observer-config.mjs';
import {randomBytes,createCipheriv,createHash} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile,rename,rm,readdir,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {Store} from './store.mjs';import {assistantKey} from './assistant.mjs';
import {restoreToNewDirectory} from './backup.mjs';import {pauseCopiedEffects} from './copy-state.mjs';
import {backupDestination,backupEncryptionKey,backupHash} from './backup-settings.mjs';
import {voiceKey,sealVoiceKey} from './voice-config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function seal(key,aad,value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),bytes].map(b=>b.toString('base64')).join('.')}
async function canonicalDestination(target){let existing=target;for(;;){try{return path.resolve(await realpath(existing),path.relative(existing,target))}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(existing);if(parent===existing)throw e;existing=parent}}}
function contains(parent,child){const relative=path.relative(parent,child);return !relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}
// Never rotates a live installation in place. Publish only a fully verified new directory.
export async function rotateKeyCopy(source,target,keySource,{backupKeySource=null}={}){
 if(![source,target,keySource].every(path.isAbsolute))throw new Error('Las rutas deben ser absolutas.');
 const sourcePath=await realpath(source),targetPath=await canonicalDestination(target);if(contains(sourcePath,targetPath)||contains(targetPath,sourcePath))throw new Error('Origen y destino no pueden solaparse.');
 try{if((await lstat(target)).isSymbolicLink())throw new Error('El destino no puede ser un enlace simbólico.')}catch(e){if(e.code!=='ENOENT')throw e}
 try{if((await readdir(target)).length)throw new Error('El destino debe estar nuevo o vacío.')}catch(e){if(e.code!=='ENOENT')throw e}
 await mkdir(path.dirname(target),{recursive:true,mode:0o700});const work=await mkdtemp(path.join(path.dirname(target),'.conectados-key-copy-'));let db,complete=false;
 try{
  await restoreToNewDirectory(source,work,keySource);db=new Store(work);pauseCopiedEffects(db,'key_rotation_copy_prepared');
  const values=db.listCredentials().map(row=>({provider:row.provider,value:db.credential(row.provider),identity:db.credentialIdentity(row.provider)})),ai=assistantKey(db),aiRow=db.db.prepare('SELECT value FROM assistant_config WHERE id=1').get(),voice=voiceKey(db),observer=observerKey(db),observerRow=db.db.prepare('SELECT value FROM observer_connection WHERE id=1').get(),newKey=randomBytes(32),r2=backupDestination(db);
  let archiveKey;
  if(r2){if(typeof backupKeySource!=='string'||!path.isAbsolute(backupKeySource))throw new Error('La copia R2 necesita su clave externa original por separado.');archiveKey=await readFile(backupKeySource);if(archiveKey.length!==32||backupHash(archiveKey)!==r2.key_hash)throw new Error('La clave externa R2 no coincide.');await writeFile(path.join(work,'.keys/backup-encryption.key'),archiveKey,{mode:0o600,flag:'wx'})}
  db.db.exec('BEGIN IMMEDIATE');try{
   for(const {provider,value,identity} of values){const encrypted=seal(newKey,provider,value);db.db.prepare('UPDATE credentials SET sealed=? WHERE provider=?').run(encrypted,provider);db.db.prepare('INSERT INTO credential_crypto_identity VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET identity=excluded.identity,sealed_hash=excluded.sealed_hash').run(provider,identity,hash(encrypted))}
   if(ai)db.db.prepare('UPDATE assistant_config SET sealed=? WHERE id=1').run(seal(newKey,'AI:'+JSON.parse(aiRow.value).provider,ai));
   if(observer)db.db.prepare('UPDATE observer_connection SET sealed=? WHERE id=1').run(sealObserverKey(newKey,JSON.parse(observerRow.value),observer));
   if(voice)db.db.prepare('UPDATE voice_config SET sealed=? WHERE id=1').run(sealVoiceKey(newKey,voice));
   if(r2)db.db.prepare('UPDATE backup_destination SET sealed=? WHERE id=1').run(seal(newKey,'BACKUP:R2',JSON.stringify(r2.credentials)));
   db.record('vault_key_rotated_copy');db.db.exec('COMMIT');
  }catch(e){db.db.exec('ROLLBACK');throw e}
  db.close();db=null;const temporary=path.join(work,'.keys/vault.key.next');await writeFile(temporary,newKey,{mode:0o600,flag:'wx'});await rename(temporary,path.join(work,'.keys/vault.key'));
  db=new Store(work);for(const row of values)if(db.credential(row.provider)!==row.value||db.credentialIdentity(row.provider)!==row.identity)throw new Error('La nueva clave no conserva los accesos.');if(assistantKey(db)!==ai)throw new Error('La nueva clave no conserva el acceso de IA.');if(observerKey(db)!==observer)throw new Error('La nueva clave no conserva el acceso del observador.');if(voiceKey(db)!==voice)throw new Error('La nueva clave no conserva el acceso de voz.');if(r2&&(JSON.stringify(backupDestination(db)?.credentials)!==JSON.stringify(r2.credentials)||!backupEncryptionKey(db).equals(archiveKey)))throw new Error('La nueva clave no conserva el respaldo R2.');db.close();db=null;
  await rename(work,target);complete=true;return {credentials:values.length,assistantKeyPreserved:Boolean(ai),sourcePreserved:true,collectorEnabled:false,notificationsEnabled:false};
 }finally{db?.close();if(!complete)await rm(work,{recursive:true,force:true})}
}
