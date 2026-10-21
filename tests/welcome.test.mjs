import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../lib/server/store.mjs';
import {welcomeReport,changeWelcome} from '../lib/server/welcome.mjs';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'welcome-fixture-'));let db=new Store(root);try{await fn({root,get db(){return db},reopen(){db.close();db=new Store(root);return db}})}finally{db.close();await rm(root,{recursive:true,force:true})}}
function action(db,action,extra={}){return changeWelcome(db,{action,revision:welcomeReport(db).progress.revision,...extra})}
function reading(db,time=Date.now()){db.saveCoolifySnapshot('https://panel.example',{source:'https://panel.example',checkedAt:time,expiresAt:time+300000,resources:[{id:'fixture',name:'Fictitious resource',type:'application',status:'running:healthy'}]})}
test('new installations auto-open; selections, current step and defer survive restart and settings edits',()=>fixture(async f=>{
 assert.equal(welcomeReport(f.db).autoOpen,true);
 action(f.db,'select',{selected:['Vercel','Coolify']});action(f.db,'navigate',{step:'connect',provider:'Vercel'});
 const saved=action(f.db,'defer');assert.equal(saved.autoOpen,false);
 f.reopen();assert.deepEqual(welcomeReport(f.db).progress,saved.progress);
 f.db.saveSettings({providers:[],ai:'none',voice:false});assert.deepEqual(welcomeReport(f.db).progress,saved.progress);
 const resumed=action(f.db,'resume');assert.equal(resumed.progress.provider,'Vercel');assert.equal(resumed.progress.status,'active');
}));
test('progress rejects secret fields, unknown providers, duplicates and stale tabs without losing newer selections',()=>fixture(async({db})=>{
 const old=welcomeReport(db).progress.revision;
 for(const selected of [['Netlify'],['Vercel','Vercel']])assert.throws(()=>changeWelcome(db,{action:'select',revision:old,selected}));
 assert.throws(()=>changeWelcome(db,{action:'defer',revision:old,token:'DO_NOT_STORE_THIS'}));
 const selected=action(db,'select',{selected:['Coolify']});
 assert.throws(()=>changeWelcome(db,{action:'select',revision:old,selected:[]}),e=>e.status===409);
 assert.throws(()=>action(db,'navigate',{step:'connect',provider:'Vercel'}));
 assert.deepEqual(welcomeReport(db).progress,selected.progress);
 assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM welcome_progress').all()).includes('DO_NOT_STORE_THIS'),false);
}));
test('completion requires fresh current observations; saving credentials or errors never counts as verified',()=>fixture(async({db})=>{
 action(db,'select',{selected:['Coolify']});action(db,'navigate',{step:'review'});
 assert.throws(()=>action(db,'finish'),e=>e.status===409);
 db.configureCoolify('https://panel.example','ISOLATED_WELCOME_FIXTURE_TOKEN');
 assert.equal(welcomeReport(db).providers[0].state,'saved');assert.throws(()=>action(db,'finish'));
 reading(db);assert.equal(welcomeReport(db).providers[0].state,'verified');assert.equal(welcomeReport(db).providers[0].resources,1);
 db.failCoolify('https://panel.example','Fixture timeout');assert.equal(welcomeReport(db).providers[0].state,'error');assert.throws(()=>action(db,'finish'));
 reading(db,Date.now()-600000);assert.equal(welcomeReport(db).providers[0].state,'stale');assert.throws(()=>action(db,'finish'));
 reading(db,Date.now()+60000);assert.equal(welcomeReport(db).providers[0].state,'stale');
 reading(db);assert.equal(action(db,'finish').progress.status,'complete');
 db.saveCredential('Coolify','Fixture replacement','ISOLATED_REPLACEMENT_TOKEN');assert.equal(welcomeReport(db).providers[0].state,'saved');
}));
test('existing configured installs are not interrupted, empty choices may finish without claiming verification',()=>fixture(async({db})=>{
 db.configureCoolify('https://panel.example','ISOLATED_EXISTING_TOKEN');assert.equal(welcomeReport(db).autoOpen,false);
 action(db,'navigate',{step:'review'});const r=action(db,'finish');assert.deepEqual(r.progress.selected,[]);assert.equal(r.providers[0].state,'saved');
}));
test('SQLite copy carries progress, while the progress row contains no credentials or account data',()=>fixture(async f=>{
 action(f.db,'select',{selected:['Supabase','Cloudflare']});action(f.db,'navigate',{step:'connect',provider:'Cloudflare'});const before=action(f.db,'defer');
 const row=f.db.db.prepare('SELECT value FROM welcome_progress').get();assert.deepEqual(Object.keys(JSON.parse(row.value)).sort(),['provider','selected','status','step']);
 const dest=await mkdtemp(path.join(tmpdir(),'welcome-restore-fixture-'));try{
  f.db.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');await cp(path.join(f.root,'.data'),path.join(dest,'.data'),{recursive:true});await cp(path.join(f.root,'.keys'),path.join(dest,'.keys'),{recursive:true});
  const restored=new Store(dest);try{assert.deepEqual(welcomeReport(restored).progress,before.progress)}finally{restored.close()}
 }finally{await rm(dest,{recursive:true,force:true})}
}));
