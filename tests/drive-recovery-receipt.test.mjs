import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath,lstat,mkdir} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../lib/server/store.mjs';import {saveConfig} from '../scripts/config.mjs';
import {configureBackup,backupReport,backupEncryptionKey} from '../lib/server/backup-settings.mjs';
import {runExternalBackup} from '../lib/server/external-backup.mjs';import {driveSourceBinding} from '../lib/server/drive-status.mjs';
import {driveRecoveryReceipt} from '../scripts/drive-recovery-receipt.mjs';

async function fixture(fn){const root=await realpath(await mkdtemp(path.join(tmpdir(),'conectados-drive-receipt-')));let db;try{
 await saveConfig(root,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:4200});db=new Store(root);await db.createOwner(await readFile(path.join(root,'.keys/setup-token'),'utf8'),'fixture-owner','Fixture recovery phrase with symbols 2026!');db.saveCredential('Coolify','Fixture','FICTIONAL_RECOVERY_RECEIPT_TOKEN');
 configureBackup(db,{accountId:'a'.repeat(32),bucket:'fixture-bucket',accessKeyId:'b'.repeat(32),secretAccessKey:'FICTIONAL_RECOVERY_RECEIPT_R2_'+'c'.repeat(30),revision:backupReport(db).revision});
 let ciphertext;const transport=()=>({async put(key,bytes){ciphertext=Buffer.from(bytes)},async get(){return ciphertext},close(){}});
 const run=await runExternalBackup(db,{transport,expectedRevision:backupReport(db).revision}),archive=path.join(root,run.id+'.cdbak'),keyFile=path.join(root,'external.key');await writeFile(archive,ciphertext,{mode:0o600});await writeFile(keyFile,backupEncryptionKey(db),{mode:0o600});
 const args={archive,target:path.join(root,'new-restored'),keyFile,output:path.join(root,'receipt.json'),outsideVpsConfirmed:true};await fn({root,db,args,run});
}finally{db?.close();await rm(root,{recursive:true,force:true})}}

test('receipt verifies real encrypted fixture recovery, original binding, source identity and paused effects',()=>fixture(async({db,args,run})=>{
 const before=await readFile(args.archive),owner=db.ownerStamp(),source=driveSourceBinding(db),receipt=await driveRecoveryReceipt(args);
 assert.equal(receipt.sourceBinding,source.sourceBinding);assert.equal(receipt.archive.id,run.id);assert.equal(receipt.archive.bytes,before.length);assert.equal(receipt.archive.created,backupReport(db).runs[0].created);assert.equal(receipt.effectsPaused,true);assert.equal((await lstat(args.output)).mode&0o777,0o600);assert.deepEqual(await readFile(args.archive),before);assert.equal(db.ownerStamp(),owner);
 const text=JSON.stringify(receipt);assert(!text.includes(db.credential('Coolify')));assert(!text.includes(db.key.toString('base64')));assert(!text.includes(backupEncryptionKey(db).toString('base64')));
 const recovered=new Store(args.target);try{assert.equal(recovered.credential('Coolify'),db.credential('Coolify'));assert.equal(recovered.collectorStatus().enabled,false);assert.equal(backupReport(recovered).automation.enabled,false)}finally{recovered.close()}
}));
test('physical-host confirmation and private paths are required before publishing any recovered state',()=>fixture(async({root,args})=>{
 await assert.rejects(driveRecoveryReceipt({...args,outsideVpsConfirmed:false}));await assert.rejects(lstat(args.target),{code:'ENOENT'});
 const outputParent=path.join(root,'public');await mkdir(outputParent,{mode:0o755});await assert.rejects(driveRecoveryReceipt({...args,output:path.join(outputParent,'receipt.json')}));await assert.rejects(lstat(args.target),{code:'ENOENT'});
 const linked=path.join(root,'linked-'+path.basename(args.archive));const {symlink}=await import('node:fs/promises');await symlink(args.archive,linked);await assert.rejects(driveRecoveryReceipt({...args,archive:linked}));await assert.rejects(lstat(args.target),{code:'ENOENT'});
}));
test('existing output, wrong key and corrupted archives do not replace files or issue a receipt',()=>fixture(async({args})=>{
 await writeFile(args.output,'KEEP_EXISTING_RECEIPT',{mode:0o600});await assert.rejects(driveRecoveryReceipt(args));assert.equal(await readFile(args.output,'utf8'),'KEEP_EXISTING_RECEIPT');await assert.rejects(lstat(args.target),{code:'ENOENT'});await rm(args.output);
 const key=await readFile(args.keyFile);await writeFile(args.keyFile,Buffer.alloc(32));await assert.rejects(driveRecoveryReceipt(args));await assert.rejects(lstat(args.output),{code:'ENOENT'});await writeFile(args.keyFile,key);
 const bytes=await readFile(args.archive);bytes[bytes.length-2]^=1;await writeFile(args.archive,bytes);await assert.rejects(driveRecoveryReceipt(args));await assert.rejects(lstat(args.output),{code:'ENOENT'});assert.deepEqual(await readFile(args.archive),bytes);
}));
