import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../lib/server/store.mjs';
import {saveConfig} from '../scripts/config.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';
test('snapshot restores into new directory, invalidates sessions and rejects corruption or existing targets',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-backup-'));const source=path.join(root,'install');let db;
 try{
  await saveConfig(source,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:3119});db=new Store(source);const token=await readFile(path.join(source,'.keys/setup-token'),'utf8');const session=await db.createOwner(token,'owner','example-only-restoration-password');db.saveCredential('Coolify','test','test-only-provider-secret');db.saveSettings({providers:['Coolify'],ai:'none',voice:false});db.close();db=null;
  const copy=path.join(root,'snapshot');await snapshot(source,copy);assert.equal((await readdir(copy)).includes('vault.key'),false);
  const destination=path.join(root,'recovered');await restoreToNewDirectory(copy,destination,path.join(source,'.keys/vault.key'));db=new Store(destination);assert.equal(db.hasOwner(),true);assert.equal(db.credential('Coolify'),'test-only-provider-secret');assert.deepEqual(db.settings().providers,['Coolify']);assert.equal(db.authenticate(session),false);db.close();db=null;
  await assert.rejects(restoreToNewDirectory(copy,destination,path.join(source,'.keys/vault.key')));
  await writeFile(path.join(copy,'install.json'),'tampered');await assert.rejects(restoreToNewDirectory(copy,path.join(root,'bad'),path.join(source,'.keys/vault.key')));
 }finally{db?.close();await rm(root,{recursive:true,force:true})}
});


test('direct restoration pauses collectors and local mail, cancels unsent work and preserves uncertain attempts without changing source',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-restore-effects-')),source=path.join(root,'source'),copy=path.join(root,'copy'),target=path.join(root,'target');let db,restored;
 try{
  await saveConfig(source,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:3119});db=new Store(source);db.configureCollector(true);db.db.exec("UPDATE notification_config SET enabled=1,test_identity='FIXTURE_ACCEPTED_IDENTITY',test_accepted=1");
  const row=db.db.prepare('INSERT INTO notification_outbox(id,dedup_key,generation,credential_identity,kind,payload,state,created,expires,attempts,next_attempt) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  row.run('never-sent','never-sent','fixture-generation','fixture-access','test','{}','queued',1,2,0,1);row.run('already-attempted','already-attempted','fixture-generation','fixture-access','test','{}','sending',1,2,1,1);db.close();db=null;
  await snapshot(source,copy);const before=await readFile(path.join(copy,'conectados.sqlite'));await restoreToNewDirectory(copy,target,path.join(source,'.keys/vault.key'));restored=new Store(target);
  assert.equal(restored.collectorStatus().enabled,false);const mail=restored.db.prepare('SELECT * FROM notification_config').get();assert.equal(mail.enabled,0);assert.equal(mail.test_identity,null);assert.equal(mail.test_accepted,null);
  assert.deepEqual(restored.db.prepare('SELECT id,state FROM notification_outbox ORDER BY id').all().map(r=>({...r})),[{id:'already-attempted',state:'uncertain'},{id:'never-sent',state:'cancelled'}]);
  assert.deepEqual(await readFile(path.join(copy,'conectados.sqlite')),before);db=new Store(source);assert.equal(db.collectorStatus().enabled,true);assert.equal(db.db.prepare('SELECT enabled FROM notification_config').get().enabled,1);assert.deepEqual(db.db.prepare('SELECT state FROM notification_outbox ORDER BY id').all().map(r=>r.state),['sending','queued']);
 }finally{restored?.close();db?.close();await rm(root,{recursive:true,force:true})}
});
