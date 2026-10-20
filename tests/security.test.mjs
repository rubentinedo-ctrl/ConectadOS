import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,unlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../lib/server/store.mjs';

test('owner creation, sessions, vault and preferences survive reopening without exposing secrets',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-security-'));let db;
 try{
  db=new Store(root);const token=await readFile(path.join(root,'.keys/setup-token'),'utf8');
  assert.equal(db.hasOwner(),false);await assert.rejects(db.createOwner('bad','owner','long-example-password-for-tests'),{status:403});
  const password=randomBytes(24).toString('hex');const session=await db.createOwner(token,'owner',password);assert.equal(db.authenticate(session),true);
  await assert.rejects(db.createOwner(token,'other',password),{status:409});
  await assert.rejects(db.login('owner','wrong-password'),{status:401});
  const secret='test-only-'+randomBytes(32).toString('hex');db.saveCredential('Coolify','Read only',secret);
  assert.equal(db.credential('Coolify'),secret);assert.equal(JSON.stringify(db.listCredentials()).includes(secret),false);
  db.saveSettings({providers:['Coolify','Cloudflare'],ai:'none',voice:true,apiKey:'must-not-persist'});
  assert.equal(Object.hasOwn(db.settings(),'apiKey'),false);assert.throws(()=>db.saveSettings({providers:['Invalid'],ai:'none',voice:false}));
  assert.throws(()=>db.saveCredential('Invalid','a',secret));
  db.close();db=new Store(root);assert.equal(db.authenticate(session),true);assert.equal(db.credential('Coolify'),secret);assert.deepEqual(db.settings().providers,['Coolify','Cloudflare']);
  const raw=await readFile(path.join(root,'.data/conectados.sqlite'));assert.equal(raw.includes(Buffer.from(secret)),false);assert.equal(raw.includes(Buffer.from(password)),false);assert.equal(raw.includes(Buffer.from(session)),false);
  if(process.platform!=='win32'){assert.equal((await stat(path.join(root,'.keys/vault.key'))).mode&0o777,0o600);assert.equal((await stat(path.join(root,'.data/conectados.sqlite'))).mode&0o777,0o600)}
  db.logout(session);assert.equal(db.authenticate(session),false);
  const login=await db.login('owner',password);db.db.prepare('UPDATE sessions SET expires=0').run();assert.equal(db.authenticate(login),false);
  const sealed=db.db.prepare('SELECT sealed FROM credentials').get().sealed;db.db.prepare('UPDATE credentials SET sealed=?').run(sealed.slice(0,-4)+'AAAA');assert.throws(()=>db.credential('Coolify'));
  db.deleteCredential('Coolify');assert.equal(db.listCredentials().length,0);assert.equal(JSON.stringify(db.audit()).includes(secret),false);
  for(let i=0;i<5;i++)await assert.rejects(db.login('owner','wrong-password'),{status:401});await assert.rejects(db.login('owner',password),{status:429});
  db.close();db=null;await unlink(path.join(root,'.keys/vault.key'));assert.throws(()=>new Store(root),{status:503});
 }finally{db?.close();await rm(root,{recursive:true,force:true})}
});
