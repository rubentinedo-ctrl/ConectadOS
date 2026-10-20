import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateConfig,saveConfig,readConfig,setupArgs} from '../scripts/config.mjs';
const valid={schemaVersion:1,mode:'demo',host:'127.0.0.1',port:3119};
test('reject public listeners, live mode and unsafe ports',()=>{for(const patch of [{host:'0.0.0.0'},{mode:'live'},{port:0},{port:65536},{port:3119.5},{schemaVersion:2}])assert.throws(()=>validateConfig({...valid,...patch}))});
test('never persist unknown fields or secrets',()=>assert.deepEqual(validateConfig({...valid,apiKey:'test-secret'}),valid));
test('existing setup is never overwritten',async()=>{const root=await mkdtemp(path.join(tmpdir(),'infra-config-'));try{await saveConfig(root,valid);assert.deepEqual(await readConfig(root),valid);await assert.rejects(saveConfig(root,{...valid,port:4000}),{code:'EEXIST'});assert.equal(JSON.parse(await readFile(path.join(root,'.data/install.json'),'utf8')).port,3119)}finally{await rm(root,{recursive:true,force:true})}});

test('installer accepts an explicit local port and rejects unknown or unsafe arguments',()=>{
 assert.deepEqual(setupArgs(['--demo','--port','4200']),{demo:true,server:false,origin:null,port:4200,help:false});
 for(const args of [['--force'],['--port'],['--port','0'],['--port','65536'],['--port','https://outside.example'],['--port','4200','--port','4300']])assert.throws(()=>setupArgs(args));
});

test('server configuration requires one canonical HTTPS origin and never replaces local configuration',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-server-config-'));try{const config={schemaVersion:2,mode:'server',host:'127.0.0.1',port:3000,publicOrigin:'https://console.example'};assert.deepEqual(validateConfig({...config,secret:'ignored'}),config);for(const publicOrigin of ['http://console.example','https://127.0.0.1','https://[::1]','https://localhost','https://console.local','https://u:p@console.example','https://console.example:8443','https://console.example/path','https://console.example/?secret=x','https://console.example/#x'])assert.throws(()=>validateConfig({...config,publicOrigin}));assert.throws(()=>validateConfig({...config,host:'192.168.1.1'}));await saveConfig(root,valid);await assert.rejects(saveConfig(root,config),{code:'EEXIST'});assert.equal((await readConfig(root)).mode,'demo');assert.deepEqual(setupArgs(['--server','--origin','https://console.example/']),{demo:false,server:true,origin:'https://console.example',port:null,help:false});for(const args of [['--server'],['--demo','--server','--origin','https://console.example'],['--origin','https://console.example']])assert.throws(()=>setupArgs(args));}finally{await rm(root,{recursive:true,force:true})}
});
