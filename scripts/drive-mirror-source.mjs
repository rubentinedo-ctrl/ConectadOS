import {DatabaseSync} from 'node:sqlite';
import {readFile,lstat,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const sha=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
async function privateStat(root,name,limit){
 const target=path.join(root,name);let current=path.resolve(root);
 if(!path.resolve(target).startsWith(current+'/'))throw Error('Invalid own file');
 for(const part of name.split('/')){current=path.join(current,part);const st=await lstat(current);if(st.isSymbolicLink()||st.mode&0o077)throw Error('Own source is not private');}
 const st=await lstat(target);if(!st.isFile()||st.size<1||st.size>limit)throw Error('Own source is not bounded');return target;
}
export async function privateFile(root,name,limit){return readFile(await privateStat(root,name,limit))}
export async function describeDriveSource(root){
 const key=await privateFile(root,'.keys/vault.key',32),backupKey=await privateFile(root,'.keys/backup-encryption.key',32);
 if(key.length!==32||backupKey.length!==32)throw Error('Original keys required');
 await privateStat(root,'.data/conectados.sqlite',512*1024*1024);
 const db=new DatabaseSync(path.join(root,'.data/conectados.sqlite'),{readOnly:true});
 try{
  // A collector commit must not permanently pause the mirror's read-only preflight.
  db.exec('PRAGMA busy_timeout=5000; BEGIN;');
  const owner=db.prepare('SELECT * FROM owner').get(),destination=db.prepare('SELECT revision,key_hash FROM backup_destination WHERE id=1').get(),automation=db.prepare('SELECT enabled FROM backup_automation WHERE id=1').get();
  if(!owner||!destination||destination.key_hash!==sha(backupKey))throw Error('Original backup identity required');
  const binding=sha(JSON.stringify({owner:sha(JSON.stringify(owner)),vault:sha(key),backupKey:sha(backupKey),destination:destination.revision}));
  const latest=db.prepare("SELECT id,created,bytes,digest FROM external_backup_runs WHERE revision=? AND state='verified' ORDER BY created DESC LIMIT 1").get(destination.revision);
  if(latest&&(!uuid.test(latest.id)||!Number.isSafeInteger(latest.created)||latest.created<0||!Number.isSafeInteger(latest.bytes)||latest.bytes<1||latest.bytes>64*1024*1024+48||!digest.test(latest.digest)))throw Error('Invalid verified source');
  return {binding,automationEnabled:Boolean(automation?.enabled),latest:latest??null};
 }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close()}
}
export async function readDriveSource(root,expected){
 const current=await describeDriveSource(root);
 if(!current.automationEnabled||current.binding!==expected.binding||JSON.stringify(current.latest)!==JSON.stringify(expected.latest))throw Error('Own source changed or paused');
 const bytes=await privateFile(root,'.backups/r2-encrypted/'+current.latest.id+'.cdbak',64*1024*1024+48);
 if(bytes.length!==current.latest.bytes||sha(bytes)!==current.latest.digest)throw Error('Verified source no longer matches');return bytes;
}
export async function verifyDriveDownload(root,expected,{restoreEncryptedBackup,Store}){
 await readDriveSource(root,expected);
 const id=expected.latest.id,bytes=await privateFile(root,'.backups/drive-mirror/'+id+'.cdbak',64*1024*1024+48);
 if(bytes.length!==expected.latest.bytes||sha(bytes)!==expected.latest.digest)throw Error('Drive download differs');
 const key=await privateFile(root,'.keys/backup-encryption.key',32),target=path.join(root,'.backups/drive-mirror',id+'-restored');
 try{await lstat(target);throw Error('Recovery target already exists')}catch(e){if(e.code!=='ENOENT')throw e}
 let restored=false;
 try{
  const result=await restoreEncryptedBackup(bytes,target,key);restored=true;const db=new Store(target);
  try{
   const source=new DatabaseSync(path.join(root,'.data/conectados.sqlite'),{readOnly:true});let owner;try{owner=source.prepare('SELECT * FROM owner').get()}finally{source.close()}
   if(sha(JSON.stringify(db.db.prepare('SELECT * FROM owner').get()))!==sha(JSON.stringify(owner))||sha(db.key)!==sha(await privateFile(root,'.keys/vault.key',32)))throw Error('Recovery identity differs');
   const integrity=db.db.prepare('PRAGMA integrity_check').get().integrity_check;
   const collector=db.db.prepare('SELECT enabled FROM collector_config WHERE id=1').get();
   const automatic=db.db.prepare('SELECT enabled FROM backup_automation WHERE id=1').get();
   const mail=db.db.prepare('SELECT enabled FROM notification_config WHERE id=1').get();
   const external=db.db.prepare('SELECT value FROM observer_connection WHERE id=1').get();
   const observer=external?JSON.parse(external.value):null;
   if(integrity!=='ok'||collector?.enabled||automatic?.enabled||mail?.enabled||observer?.enabled||observer?.mailReadEnabled||db.db.prepare('SELECT count(*) n FROM sessions').get().n!==0)throw Error('Recovery not isolated');
   return {...result,integrity,downloadMatched:true,restored:true,effectsPaused:true};
  }finally{db.close()}
 }finally{if(restored)await rm(target,{recursive:true,force:true})}
}
