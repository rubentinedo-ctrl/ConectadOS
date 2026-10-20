import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,stat,open,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {randomBytes,createCipheriv} from 'node:crypto';import {gzipSync} from 'node:zlib';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {sealBackup,openBackup,sealBackupDirectory,unpackBackup,backupFiles,BACKUP_SOURCE_BYTE_LIMIT,BACKUP_ENVELOPE_BYTE_LIMIT} from '../lib/server/backup-envelope.mjs';

const magic=Buffer.from('CONECTADOS-BACKUP-2\0');
const execute=promisify(execFile);
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-envelope2-'));try{const files={'conectados.sqlite':Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.alloc(6000)]),'install.json':Buffer.from('{}'),'manifest.json':Buffer.from('{}'),'vault.key':randomBytes(32)};for(const name of backupFiles)await writeFile(path.join(root,name),files[name],{mode:0o600});await fn(root,files,randomBytes(32))}finally{await rm(root,{recursive:true,force:true})}}
function encrypted(bytes,key){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(magic);return Buffer.concat([magic,nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()])}
function frame(bytes){const header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);return Buffer.concat([header,bytes])}
test('v2 compresses file streams, authenticates its version, creates private files and retains v1 restoration',()=>fixture(async(root,files,key)=>{
 const bytes=await sealBackupDirectory(root,path.join(root,'vault.key'),key);assert.ok(bytes.subarray(0,magic.length).equals(magic));assert.ok(bytes.length<files['conectados.sqlite'].length);assert.equal(bytes.includes(files['vault.key']),false);assert.equal(bytes.equals(await sealBackupDirectory(root,path.join(root,'vault.key'),key)),false);
 assert.throws(()=>openBackup(bytes,key),'Old v1-only code must reject v2, not misinterpret it');
 for(const [version,envelope] of [[2,bytes],[1,sealBackup(files,key)]]){const target=path.join(root,'restored-'+version);await unpackBackup(envelope,key,target);assert.equal((await stat(target)).mode&511,448);for(const name of backupFiles){assert.deepEqual(await readFile(path.join(target,name)),files[name]);assert.equal((await stat(path.join(target,name))).mode&511,384)}}
}));
test('wrong keys, version changes, tampering and truncated ciphertext fail before creating an unpack directory',()=>fixture(async(root,files,key)=>{
 const bytes=await sealBackupDirectory(root,path.join(root,'vault.key'),key),changed=Buffer.from(bytes);changed[magic.length+15]^=1;const version=Buffer.from(bytes);version[magic.length-2]=51;
 for(const [index,[envelope,k]] of [[changed,key],[version,key],[bytes,randomBytes(32)],[bytes.subarray(0,-1),key],[Buffer.alloc(BACKUP_ENVELOPE_BYTE_LIMIT+1),key]].entries()){const target=path.join(root,'bad-'+index);await assert.rejects(unpackBackup(envelope,k,target));await assert.rejects(stat(target),{code:'ENOENT'})}
}));
test('authenticated malformed gzip, invalid lengths, missing frames and extra content leave no partial files',()=>fixture(async(root,files,key)=>{
 const valid=Buffer.concat(backupFiles.map(name=>frame(files[name]))),tooLarge=Buffer.alloc(4);tooLarge.writeUInt32BE(BACKUP_SOURCE_BYTE_LIMIT+1);
 const variants=[Buffer.from('not-gzip'),gzipSync(tooLarge),gzipSync(valid.subarray(0,-1)),gzipSync(Buffer.concat([valid,Buffer.from('trailing')])),gzipSync(Buffer.concat([frame(files['conectados.sqlite']),frame(Buffer.alloc(16385))])),gzipSync(Buffer.concat([frame(Buffer.from('not-sqlite')), ...backupFiles.slice(1).map(n=>frame(files[n]))])),gzipSync(Buffer.concat([...backupFiles.slice(0,3).map(n=>frame(files[n])),frame(Buffer.alloc(31))]))];
 for(const [index,compressed] of variants.entries()){const target=path.join(root,'invalid-'+index);await assert.rejects(unpackBackup(encrypted(compressed,key),key,target));await assert.rejects(stat(target),{code:'ENOENT'})}
 const target=path.join(root,'kept');await writeFile(target,'existing');await assert.rejects(unpackBackup(encrypted(gzipSync(valid),key),key,target));assert.equal(await readFile(target,'utf8'),'existing');
}));
test('source streams reject links, oversized database or metadata and aggregate framing above 512 MiB',()=>fixture(async(root,files,key)=>{
 const db=path.join(root,'conectados.sqlite');await rm(db);await symlink(path.join(root,'install.json'),db);await assert.rejects(sealBackupDirectory(root,path.join(root,'vault.key'),key));await rm(db);await writeFile(db,files['conectados.sqlite']);
 await writeFile(path.join(root,'install.json'),Buffer.alloc(16385));await assert.rejects(sealBackupDirectory(root,path.join(root,'vault.key'),key));await writeFile(path.join(root,'install.json'),files['install.json']);
 const handle=await open(db,'r+');try{await handle.truncate(BACKUP_SOURCE_BYTE_LIMIT+1)}finally{await handle.close()};await assert.rejects(sealBackupDirectory(root,path.join(root,'vault.key'),key));
 // This boundary exceeds the aggregate limit by just framing and other files.
 const h=await open(db,'r+');try{await h.truncate(BACKUP_SOURCE_BYTE_LIMIT)}finally{await h.close()};await assert.rejects(sealBackupDirectory(root,path.join(root,'vault.key'),key));assert.deepEqual((await readdir(root)).sort(),backupFiles.toSorted());
}));
test('incompressible content cannot exceed the remote 64 MiB ciphertext budget',()=>fixture(async(root,files,key)=>{
 const handle=await open(path.join(root,'conectados.sqlite'),'w');try{await handle.writeFile(Buffer.from('SQLite format 3\0'));for(let i=0;i<65;i++)await handle.writeFile(randomBytes(1024*1024))}finally{await handle.close()}
 await assert.rejects(sealBackupDirectory(root,path.join(root,'vault.key'),key),/comprimida supera 64 MiB/);
}));
test('a database above the measured seven-day projection survives R2 and Drive recovery with bounded JS buffers',async()=>{
 const {stdout}=await execute(process.execPath,['--max-old-space-size=96',fileURLToPath(new URL('./fixtures/large-backup.mjs',import.meta.url))],{timeout:120000,maxBuffer:65536});
 const proof=JSON.parse(stdout.trim());assert.ok(proof.databaseBytes>203000000);assert.equal(proof.rows,10080);assert.equal(proof.sourcePreserved,true);assert.equal(proof.r2Restored,true);assert.equal(proof.driveRestored,true);assert.equal(proof.effectsPaused,true);assert.ok(proof.peakArrayBuffers<96*1024*1024);assert.ok(proof.archiveBytes<64*1024*1024);assert.equal(proof.format,2);
});
