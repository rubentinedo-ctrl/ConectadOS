import {pauseCopiedEffects} from './copy-state.mjs';
import {recoverObserver,observerKey} from './observer-config.mjs';
import {backup} from 'node:sqlite';
import {mkdir,writeFile,chmod,readdir,realpath,lstat,mkdtemp,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {backupFileHash,readBackupMetadata,copyBackupFile,BACKUP_METADATA_BYTE_LIMIT} from './backup-files.mjs';
import path from 'node:path';
import {Store} from './store.mjs';
import {recoverAssistant,assistantKey} from './assistant.mjs';
import {recoverHostTelemetry} from './host-telemetry.mjs';
import {recoverOperations} from './operations.mjs';
import {recoverRealtime} from './realtime-voice.mjs';
import {recoverVoice,voiceKey} from './voice-config.mjs';
import {backupDestination,backupTables} from './backup-settings.mjs';
import {readConfig} from '../../scripts/config.mjs';
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
export async function snapshot(root,destination){
 await mkdir(destination,{mode:0o700});const store=new Store(root);
 try{
  const dbFile=path.join(destination,'conectados.sqlite');await backup(store.db,dbFile);await chmod(dbFile,0o600);
  const config=await readBackupMetadata(path.join(root,'.data/install.json'));await writeFile(path.join(destination,'install.json'),config,{mode:0o600,flag:'wx'});
  const manifest={version:1,createdAt:new Date().toISOString(),files:{'conectados.sqlite':await backupFileHash(dbFile),'install.json':digest(config)},keyIncluded:false};
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});return manifest;
 }finally{store.close()}
}
async function destinationPath(target){let existing=target;for(;;){try{return path.resolve(await realpath(existing),path.relative(existing,target))}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(existing);if(parent===existing)throw e;existing=parent}}}
function contains(parent,child){const relative=path.relative(parent,child);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)}
export async function restoreToNewDirectory(source,target,keySource){
 if(![source,target,keySource].every(path.isAbsolute))throw new Error('Usa rutas absolutas.');
 const canonical=await destinationPath(target),origin=await realpath(source),keyFile=await realpath(keySource);
 if(contains(origin,canonical)||contains(canonical,origin)||contains(canonical,keyFile))throw new Error('El destino no puede solaparse con la copia o su clave.');
 try{if((await lstat(target)).isSymbolicLink()||(await readdir(target)).length)throw new Error('El destino debe ser una carpeta nueva o vacía, sin enlace simbólico.')}catch(e){if(e.code!=='ENOENT')throw e}
 const manifest=JSON.parse((await readBackupMetadata(path.join(origin,'manifest.json'))).toString('utf8'));
 if(manifest.version!==1||manifest.keyIncluded!==false)throw new Error('Formato de copia no compatible.');
 for(const file of ['conectados.sqlite','install.json'])if(typeof manifest.files?.[file]!=='string'||!/^[a-f0-9]{64}$/.test(manifest.files[file]))throw Error('Manifiesto de copia no válido.');
 const key=await readBackupMetadata(keyFile,32);if(key.length!==32)throw new Error('Clave de cifrado inválida.');
 await mkdir(path.dirname(canonical),{recursive:true,mode:0o700});const work=await mkdtemp(path.join(path.dirname(canonical),'.conectados-restore-'));let store,complete=false;
 try{
  await mkdir(path.join(work,'.data'),{mode:0o700});await mkdir(path.join(work,'.keys'),{mode:0o700});
  for(const file of ['conectados.sqlite','install.json'])await copyBackupFile(path.join(origin,file),path.join(work,'.data',file),manifest.files[file],file==='install.json'?BACKUP_METADATA_BYTE_LIMIT:undefined);
  await writeFile(path.join(work,'.keys/vault.key'),key,{flag:'wx',mode:0o600});await readConfig(work);
  store=new Store(work);for(const c of store.listCredentials())store.credential(c.provider);assistantKey(store);voiceKey(store);observerKey(store);backupDestination(store);
  if(store.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||store.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La copia no supera la validación de almacenamiento.');
  recoverObserver(store);recoverAssistant(store);recoverVoice(store);recoverRealtime(store);recoverOperations(store);recoverHostTelemetry(store);backupTables(store);store.db.exec("DELETE FROM sessions; DELETE FROM google_flows; DELETE FROM account_recovery; DELETE FROM collection_lease; DELETE FROM provider_collection_lease; DELETE FROM external_backup_lease; UPDATE collector_config SET heartbeat=NULL,error=NULL; UPDATE external_backup_runs SET state='uncertain',error='Restauración: resultado anterior sin confirmar.' WHERE state IN ('preparing','uploaded')");pauseCopiedEffects(store,'backup_restored');store.close();store=null;
  await rename(work,canonical);complete=true;
 }finally{store?.close();if(!complete)await rm(work,{recursive:true,force:true})}
}
