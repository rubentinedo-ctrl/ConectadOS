import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {voiceKey} from './voice-config.mjs';
import {restoreToNewDirectory} from './backup.mjs';import {Store} from './store.mjs';import {assistantKey} from './assistant.mjs';import {pauseCopiedEffects} from './copy-state.mjs';import {readConfig} from '../../scripts/config.mjs';import {STATE_FORMAT} from './state-format.mjs';

// Runs on an isolated copy. No provider request and no mutation of the backup or live state.
export async function checkReleaseBackup(source,keySource){
 if(!path.isAbsolute(source)||!path.isAbsolute(keySource))throw new Error('Usa rutas absolutas para la copia y el archivo de clave.');
 const root=await mkdtemp(path.join(tmpdir(),'conectados-release-check-'));let db;
 try{
  await restoreToNewDirectory(source,root,keySource);const config=await readConfig(root);db=new Store(root);
  if(db.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('La copia no supera la validación de almacenamiento.');
  const credentials=db.listCredentials();for(const credential of credentials)db.credential(credential.provider);
  const hasAssistantKey=Boolean(assistantKey(db));voiceKey(db);pauseCopiedEffects(db,'release_copy_checked');
  return {stateFormat:STATE_FORMAT,mode:config.mode,ownerPresent:db.hasOwner(),credentials:credentials.length,assistantKeyPresent:hasAssistantKey,collectorEnabled:db.collectorStatus().enabled,notificationsEnabled:Boolean(db.db.prepare('SELECT enabled FROM notification_config').get().enabled),sessions:db.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,sourcePreserved:true};
 }finally{db?.close();await rm(root,{recursive:true,force:true})}
}
