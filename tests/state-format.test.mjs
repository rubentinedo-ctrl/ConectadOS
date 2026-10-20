import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';import {Store} from '../lib/server/store.mjs';import {STATE_FORMAT} from '../lib/server/state-format.mjs';
import {spawn} from 'node:child_process';import {once} from 'node:events';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'conectados-state-format-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
test('new and legacy compatible databases get an explicit format without changing credentials',()=>fixture(async root=>{
 let s=new Store(root);s.saveCredential('Coolify','Fixture','STATE_FORMAT_FIXTURE_TOKEN');s.db.exec('PRAGMA user_version=0');s.close();const key=await readFile(path.join(root,'.keys/vault.key'));s=new Store(root);assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,STATE_FORMAT);assert.equal(s.credential('Coolify'),'STATE_FORMAT_FIXTURE_TOKEN');s.close();assert.deepEqual(await readFile(path.join(root,'.keys/vault.key')),key);
}));
test('unsupported future formats are rejected before DDL or data writes',()=>fixture(async root=>{
 const s=new Store(root),file=path.join(root,'.data/conectados.sqlite');s.db.exec('DROP TABLE account_recovery; PRAGMA user_version=999');s.close();const before=await readFile(file),key=await readFile(path.join(root,'.keys/vault.key'));assert.throws(()=>new Store(root),{status:503});assert.deepEqual(await readFile(file),before);assert.deepEqual(await readFile(path.join(root,'.keys/vault.key')),key);const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,999);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='account_recovery'").get().n,0);db.close();
}));
test('a brief independent writer lock waits before checking the storage format instead of rejecting a compatible database',()=>fixture(async root=>{
 const original=new Store(root);original.saveCredential('Coolify','Fixture','STATE_LOCK_FIXTURE_ONLY');original.close();const file=path.join(root,'.data/conectados.sqlite'),key=await readFile(path.join(root,'.keys/vault.key'));
 const child=spawn(process.execPath,['--input-type=module'],{stdio:['pipe','pipe','ignore']}),closed=once(child,'exit');const ready=once(child.stdout,'data');child.stdin.end("import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync("+JSON.stringify(file)+");d.exec('BEGIN EXCLUSIVE');process.stdout.write('locked');setTimeout(()=>{d.exec('COMMIT');d.close()},500)");
 let store;try{const [bytes]=await ready;assert.equal(bytes.toString(),'locked');store=new Store(root);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(store.credential('Coolify'),'STATE_LOCK_FIXTURE_ONLY');assert.deepEqual(await readFile(path.join(root,'.keys/vault.key')),key)}finally{store?.close();await closed}
}));
