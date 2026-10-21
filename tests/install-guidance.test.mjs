import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inventoryConnectors,manualPlatformExamples} from '../lib/connection-catalog.mjs';
import {providerCollectors} from '../lib/server/provider-collector.mjs';
import {setupCodeFile,openSetupCode} from '../scripts/open-setup-code.mjs';

test('advertised inventory connectors match implemented collectors, manual examples stay separate',()=>{
 assert.deepEqual(inventoryConnectors.map(p=>p.name).sort(),['Coolify',...Object.keys(providerCollectors)].sort());
 for(const name of manualPlatformExamples)assert.ok(!inventoryConnectors.some(p=>p.name===name));
});
test('local code opener handles spaces and shell characters without reading, changing or outputting the code',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados editor $(fixture) ')),file=path.join(root,'.keys/setup-token'),calls=[];
 try{
  await mkdir(path.join(root,'.keys'));await writeFile(file,'FIXTURE_NOT_FOR_OUTPUT');
  const run=async(program,args)=>{calls.push([program,args]);return {stdout:program==='wslpath'?'\\\\wsl.localhost\\Ubuntu\\home\\fixture\\.keys\\setup-token\n':''}};
  assert.equal(await openSetupCode(root,{platform:'darwin',env:{},run}),file);
  assert.deepEqual(calls.shift(),['open',['-a','TextEdit',file]]);
  await openSetupCode(root,{platform:'linux',env:{WSL_DISTRO_NAME:'Ubuntu'},run});
  assert.deepEqual(calls.shift(),['wslpath',['-w',file]]);
  assert.deepEqual(calls.shift(),['notepad.exe',['\\\\wsl.localhost\\Ubuntu\\home\\fixture\\.keys\\setup-token']]);
  assert.equal(await readFile(file,'utf8'),'FIXTURE_NOT_FOR_OUTPUT');
  assert.equal(calls.length,0);
  await assert.rejects(openSetupCode(root,{platform:'linux',env:{},run}),/sin escritorio/);
  assert.equal(calls.length,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('code opener preserves missing state and refuses links and oversized files before launching',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-code-'));
 try{
  await assert.rejects(setupCodeFile(root),{code:'ENOENT'});
  await assert.rejects(setupCodeFile('relative'),/absoluta/);
  await mkdir(path.join(root,'.keys'));const file=path.join(root,'.keys/setup-token'),outside=path.join(root,'fixture');
  await writeFile(outside,'PRIVATE_FIXTURE');await symlink(outside,file);
  await assert.rejects(openSetupCode(root,{run:()=>assert.fail('must not launch')}),/regular/);
  await rm(file);await writeFile(file,'x'.repeat(257));await assert.rejects(setupCodeFile(root),/regular/);
  await rm(file);await rm(path.join(root,'.keys'),{recursive:true});await mkdir(path.join(root,'linked'));await writeFile(path.join(root,'linked/setup-token'),'FIXTURE');await symlink(path.join(root,'linked'),path.join(root,'.keys'));
  await assert.rejects(setupCodeFile(root),/regular/);
 }finally{await rm(root,{recursive:true,force:true})}
});
