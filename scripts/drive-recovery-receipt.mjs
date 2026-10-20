import {lstat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {restoreEncryptedBackup} from '../lib/server/external-backup.mjs';
import {Store} from '../lib/server/store.mjs';
import {backupReport} from '../lib/server/backup-settings.mjs';
import {driveSourceBinding} from '../lib/server/drive-status.mjs';
import {observerConnection} from '../lib/server/observer-config.mjs';
import {BACKUP_ENVELOPE_BYTE_LIMIT} from '../lib/server/backup-envelope.mjs';

async function privatePath(file,{directory=false,bytes}={}){
 if(!path.isAbsolute(file))throw Error('Use absolute private paths');
 for(let current=file;;current=path.dirname(current)){
  const s=await lstat(current);if(s.isSymbolicLink())throw Error('Private paths cannot follow links');
  if(path.dirname(current)===current)break;
 }
 const s=await lstat(file);
 if(s.mode&0o077||s.uid!==process.getuid?.()||(directory?!s.isDirectory():!s.isFile()))throw Error('Own private file or directory required');
 if(bytes!==undefined&&s.size!==bytes)throw Error('Invalid key length');return s;
}

/** The agent confirms the physical host. This code proves recovery, not geography. */
export async function driveRecoveryReceipt({archive,target,keyFile,output,outsideVpsConfirmed=false}){
 if(outsideVpsConfirmed!==true||![archive,target,keyFile,output].every(v=>typeof v==='string'&&path.isAbsolute(v)))throw Error('Independent host confirmation and absolute paths required');
 const id=path.basename(archive).match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.cdbak$/)?.[1];if(!id)throw Error('Archive name must end in its original UUID');
 const info=await privatePath(archive);if(info.size<1||info.size>BACKUP_ENVELOPE_BYTE_LIMIT)throw Error('Archive size exceeds the supported limit');
 await privatePath(keyFile,{bytes:32});await privatePath(path.dirname(target),{directory:true});await privatePath(path.dirname(output),{directory:true});
 try{await lstat(output);throw Error('Receipt already exists; inspect it rather than replacing')}catch(e){if(e.code!=='ENOENT')throw e}
 const bytes=await readFile(archive),key=await readFile(keyFile),digest=createHash('sha256').update(bytes).digest('hex');
 if(bytes.length!==info.size||bytes.length>BACKUP_ENVELOPE_BYTE_LIMIT||key.length!==32)throw Error('Input changed during reading');
 await restoreEncryptedBackup(bytes,target,key);const db=new Store(target);let receipt;
 try{
  const source=driveSourceBinding(db),row=db.db.prepare('SELECT id,created FROM external_backup_runs WHERE revision=? AND id=?').get(source.revision,id);
  if(!row||!Number.isSafeInteger(row.created)||row.created<1||row.created>Date.now()+30000)throw Error('Archive does not contain its own source receipt');
  const external=observerConnection(db);
  if(db.db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||!db.hasOwner()||db.db.prepare('SELECT count(*) n FROM sessions').get().n||db.collectorStatus().enabled||backupReport(db).automation.enabled||db.db.prepare('SELECT enabled FROM notification_config WHERE id=1').get().enabled||external.enabled||external.mailReadEnabled)throw Error('Recovered state is not isolated');
  for(const c of db.listCredentials())db.credential(c.provider);
  try{await lstat(path.join(target,'.keys/backup-worker.key'));throw Error('Recovered worker identity must be absent')}catch(e){if(e.code!=='ENOENT')throw e}
  receipt={schemaVersion:1,restoredOutsideVps:true,effectsPaused:true,sourceBinding:source.sourceBinding,archive:{id,created:row.created,bytes:bytes.length,digest}};
 }finally{db.close()}
 if(createHash('sha256').update(await readFile(archive)).digest('hex')!==digest)throw Error('Original archive changed during recovery');
 await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 try{
  if(args.length!==5||args[4]!=='--outside-vps-confirmed')throw Error();
  const receipt=await driveRecoveryReceipt({archive:args[0],target:args[1],keyFile:args[2],output:args[3],outsideVpsConfirmed:true});
  console.log(JSON.stringify({recovered:true,receiptSaved:true,effectsPaused:true,id:receipt.archive.id,bytes:receipt.archive.bytes,sourceBindingExcludedFromOutput:true,physicalHostConfirmedByAgent:true}));
 }catch{console.error('Recovery receipt not created. Confirm the independent host, private paths, original archive/key and new destinations. Existing files were not replaced.');process.exitCode=1}
}
