import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {installerArgs,installationPlan,readPreferences,assertPortAvailable} from '../scripts/install.mjs';
import {saveConfig} from '../scripts/config.mjs';
const preferences={schemaVersion:1,mode:'demo',installationTarget:'Computadora local',requestedProviders:['Coolify'],aiPreference:'Sin IA',voiceRequested:false,notice:'Preferencias; no órdenes.'};
test('installer refuses incompatible existing state before changing any files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-install-'));
 try{await saveConfig(root,{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:4200});const file=path.join(root,'.data/install.json'),before=await readFile(file);await assert.rejects(installationPlan(root,installerArgs(['--apply','--port','4300'])));assert.deepEqual(await readFile(file),before);const plan=await installationPlan(root,installerArgs(['--apply']));assert.equal(plan.target.port,4200);assert.equal(plan.existing,true);}finally{await rm(root,{recursive:true,force:true});}
});
test('downloaded preferences reject credentials, executable strings, symlinks and excess bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-preferences-')),file=path.join(root,'plan.json');
 try{await writeFile(file,JSON.stringify(preferences));assert.deepEqual((await readPreferences(file)).providers,['Coolify']);for(const value of [{...preferences,token:'secret'},{...preferences,requestedProviders:['$(touch injected)']},{...preferences,notice:'x'.repeat(501)}]){await writeFile(file,JSON.stringify(value));await assert.rejects(readPreferences(file));}await writeFile(file,' '.repeat(10241));await assert.rejects(readPreferences(file));await symlink(file,path.join(root,'linked.json'));await assert.rejects(readPreferences(path.join(root,'linked.json')));}finally{await rm(root,{recursive:true,force:true});}
});
test('a VPS preference cannot authorize deployment or select server mode',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-plan-'));
 try{const file=path.join(root,'plan.json');await writeFile(file,JSON.stringify({...preferences,installationTarget:'VPS / Coolify (requiere HTTPS y revisión)'}));await assert.rejects(installationPlan(root,installerArgs(['--preferences',file])));await assert.rejects(readFile(path.join(root,'.data/install.json')),{code:'ENOENT'});for(const args of [['--apply','--apply'],['--force'],['--preferences']])assert.throws(()=>installerArgs(args));}finally{await rm(root,{recursive:true,force:true});}
});
test('an active listener is rejected before dependencies or state are touched',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await assert.rejects(assertPortAvailable('127.0.0.1',server.address().port),/ocupado/);}finally{await new Promise(resolve=>server.close(resolve));}
});
