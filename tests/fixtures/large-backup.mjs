// Synthetic standalone process: no production credentials or provider network.
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {Store} from '../../lib/server/store.mjs';import {saveConfig} from '../../scripts/config.mjs';
import {configureBackup,backupReport,configureBackupAutomation,backupEncryptionKey} from '../../lib/server/backup-settings.mjs';
import {runExternalBackup,restoreEncryptedBackup} from '../../lib/server/external-backup.mjs';
import {describeDriveSource,readDriveSource,verifyDriveDownload} from '../../scripts/drive-mirror-source.mjs';

const root=await mkdtemp(path.join(tmpdir(),'conectados-large-backup-'));let db,restored;
let peakArrayBuffers=0;const sample=()=>{peakArrayBuffers=Math.max(peakArrayBuffers,process.memoryUsage().arrayBuffers)};const interval=setInterval(sample,5);
try{
 await saveConfig(root,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:4200});db=new Store(root);await db.createOwner(await readFile(path.join(root,'.keys/setup-token'),'utf8'),'capacity-fixture-owner','Synthetic capacity fixture password 2026!');db.saveCredential('Coolify','Fixture','CAPACITY_FIXTURE_SECRET');
 configureBackup(db,{accountId:'a'.repeat(32),bucket:'fixture-bucket',accessKeyId:'b'.repeat(32),secretAccessKey:'FIXTURE_ONLY_'+('c'.repeat(40)),revision:'initial'});
 db.db.exec('CREATE TABLE capacity_fixture(id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
 const resource=JSON.stringify({fixture:true,resources:Array.from({length:100},(_,i)=>({id:'fixture-resource-'+i,type:i%2?'application':'database',status:'running',checkedAt:1700000000000+i,source:'synthetic',dependsOn:'fixture-host'}))});
 const payload=resource.padEnd(20900,' '),insert=db.db.prepare('INSERT INTO capacity_fixture VALUES(?,?)');db.db.exec('BEGIN');try{for(let i=0;i<10080;i++)insert.run(i,JSON.stringify({sample:i,snapshot:payload}));db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
 db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');const databaseBytes=(await stat(path.join(root,'.data/conectados.sqlite'))).size,owner=db.ownerStamp(),vault=Buffer.from(db.key);assert.ok(databaseBytes>203000000);
 let remote;const transport=()=>({put:async(k,b)=>{assert.equal(remote,undefined);remote=b},get:async()=>remote,close(){}});
 const result=await runExternalBackup(db,{transport,expectedRevision:backupReport(db).revision});sample();assert.equal(result.restored,true);assert.ok(remote.subarray(0,Buffer.byteLength('CONECTADOS-BACKUP-2\0')).equals(Buffer.from('CONECTADOS-BACKUP-2\0')));
 const target=path.join(root,'r2-restored');await restoreEncryptedBackup(remote,target,backupEncryptionKey(db));restored=new Store(target);assert.equal(restored.db.prepare('SELECT COUNT(*) n FROM capacity_fixture').get().n,10080);for(const id of [0,5039,10079])assert.equal(JSON.parse(restored.db.prepare('SELECT payload FROM capacity_fixture WHERE id=?').get(id).payload).sample,id);assert.equal(restored.ownerStamp(),owner);assert.ok(restored.key.equals(vault));assert.equal(restored.credential('Coolify'),'CAPACITY_FIXTURE_SECRET');assert.equal(restored.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.collectorStatus().enabled,false);restored.close();restored=null;
 configureBackupAutomation(db,{enabled:true,revision:backupReport(db).automation.revision,destinationRevision:backupReport(db).revision});db.configureCollector(true);
 const source=await describeDriveSource(root),bytes=await readDriveSource(root,source);assert.equal(bytes.equals(remote),true);await mkdir(path.join(root,'.backups/drive-mirror'),{mode:0o700});await writeFile(path.join(root,'.backups/drive-mirror',source.latest.id+'.cdbak'),bytes,{mode:0o600});const drive=await verifyDriveDownload(root,source,{restoreEncryptedBackup,Store});sample();
 assert.equal(drive.restored,true);assert.equal(drive.effectsPaused,true);assert.equal(db.ownerStamp(),owner);assert.ok(db.key.equals(vault));assert.equal(db.db.prepare('SELECT COUNT(*) n FROM capacity_fixture').get().n,10080);assert.equal(db.collectorStatus().enabled,true);assert.equal(backupReport(db).automation.enabled,true);
 console.log(JSON.stringify({databaseBytes,rows:10080,archiveBytes:remote.length,format:2,peakArrayBuffers,sourcePreserved:true,r2Restored:result.restored,driveRestored:drive.restored,effectsPaused:drive.effectsPaused}));
}finally{clearInterval(interval);restored?.close();db?.close();await rm(root,{recursive:true,force:true})}
