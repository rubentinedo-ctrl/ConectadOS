import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeLogo,decodeLogoInput,logoInputLimit} from '../lib/server/logos.mjs';
import {Store} from '../lib/server/store.mjs';
import {snapshot,restoreToNewDirectory} from '../lib/server/backup.mjs';
import {saveConfig} from '../scripts/config.mjs';
const createImage=()=>sharp({create:{width:512,height:256,channels:4,background:{r:6,g:182,b:212,alpha:.5}}});
const fixture={source:'https://panel.example',checkedAt:Date.now(),coverage:'Isolated fixture',resources:[{id:'app-a',name:'Fixture',type:'application',status:'running:healthy'}]};
function connection(db){db.configureCoolify(fixture.source,'FAKE-LOGO-TEST-TOKEN');db.saveCoolifySnapshot(fixture.source,fixture)}
test('logos decode raster formats, preserve transparency, shrink dimensions and strip metadata and appended content',async()=>{
 for(const format of ['png','jpeg','webp']){
  const raw=await createImage().withMetadata({exif:{IFD0:{Artist:'PRIVATE-METADATA-MARKER'}}})[format]().toBuffer();
  const output=await normalizeLogo(decodeLogoInput(Buffer.concat([raw,Buffer.from('PRIVATE-APPENDED-MARKER')]).toString('base64')));
  const meta=await sharp(output).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,128);assert.equal(meta.height,64);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.equal(output.includes(Buffer.from('PRIVATE-METADATA-MARKER')),false);assert.equal(output.includes(Buffer.from('PRIVATE-APPENDED-MARKER')),false);if(format==='png')assert.equal(meta.hasAlpha,true);
 }
});
test('logos reject active formats, invalid bytes, oversized inputs, animation chunks and excessive dimensions',async()=>{
 for(const value of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://not-contacted.example/secret"/></svg>'),Buffer.from('GIF89a'),Buffer.from([255,216,255,0])])await assert.rejects(normalizeLogo(value));
 await assert.rejects(normalizeLogo(Buffer.alloc(logoInputLimit+1)),/512 KB/);assert.throws(()=>decodeLogoInput('https://not-contacted.example/secret'));assert.throws(()=>decodeLogoInput('a==='));assert.throws(()=>decodeLogoInput('YWJj!!'));
 const huge=await sharp({create:{width:2049,height:1,channels:4,background:'red'}}).png().toBuffer();await assert.rejects(normalizeLogo(huge),/2048/);
 const valid=await createImage().png().toBuffer();const animationChunk=Buffer.alloc(20);animationChunk.writeUInt32BE(8);animationChunk.write('acTL',4);const animated=Buffer.concat([valid.subarray(0,33),animationChunk,valid.subarray(33)]);await assert.rejects(normalizeLogo(animated),/animación/);
});
test('logos bind to authorized resources and scopes, survive recovery and reject updates prepared for an old connection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-logos-')),target=await mkdtemp(path.join(tmpdir(),'conectados-logos-recover-'));let db,recovered;
 try{
  await saveConfig(root,{schemaVersion:1,host:'127.0.0.1',port:4200,mode:'demo'});db=new Store(root);connection(db);const ref=db.resourceLogoBinding('Coolify','app-a'),image=await normalizeLogo(await createImage().png().toBuffer());db.saveResourceLogo('Coolify','app-a',image,ref);
  assert.deepEqual(db.resourceLogo(ref),image);assert.equal(db.resourceLogoMetadata().length,1);assert.throws(()=>db.resourceLogoBinding('Coolify','not-in-inventory'),{status:404});const count=db.audit().length;db.saveResourceLogo('Coolify','app-a',image,ref);assert.equal(db.audit().length,count);
  const destination=path.join(root,'copy');await snapshot(root,destination);await restoreToNewDirectory(destination,target,path.join(root,'.keys/vault.key'));recovered=new Store(target);assert.deepEqual(recovered.resourceLogo(ref),image);recovered.close();recovered=null;
  db.configureCoolify('https://other.example','NEW-FAKE-TOKEN');db.saveCoolifySnapshot('https://other.example',{...fixture,source:'https://other.example'});assert.equal(db.resourceLogoMetadata().length,0);assert.throws(()=>db.resourceLogo(ref),{status:404});assert.throws(()=>db.saveResourceLogo('Coolify','app-a',image,ref),{status:409});
  db.configureCoolify(fixture.source,'ORIGINAL-FAKE-TOKEN');db.saveCoolifySnapshot(fixture.source,fixture);assert.deepEqual(db.resourceLogo(ref),image);db.deleteResourceLogo('Coolify','app-a');assert.equal(db.resourceLogoMetadata().length,0);assert.throws(()=>db.resourceLogo(ref),{status:404});
 }finally{db?.close();recovered?.close();await rm(root,{recursive:true,force:true});await rm(target,{recursive:true,force:true})}
});
