import test from 'node:test';import assert from 'node:assert/strict';
import {ownBackupHealth} from '../lib/server/own-backup-health.mjs';
const now=1800000000000;
function report(){return {destination:{},automation:{enabled:true,state:'waiting',workerFresh:true,error:null},runs:[{state:'verified',created:now-60000}]}}
test('own backups detect pause, expired pulse and overdue independently of database backup metadata',()=>{
 for(const [key,value,expected] of [['error','interrupted','paused'],['workerFresh',false,'worker']]){const r=report();r.automation[key]=value;assert.equal(ownBackupHealth(r,{configured:false},now)[0].problem,expected)}
 const r=report();r.runs[0].created=now-26*3600000;assert.equal(ownBackupHealth(r,{configured:false},now)[0].problem,'overdue');
 assert.equal(ownBackupHealth(report(),{configured:true,status:'paused'},now)[1].problem,'paused');
});
test('pending uploads cannot close a Drive incident and a verified copy can; deliberate pause is not an error',()=>{
 for(const status of ['working','pending','waiting'])assert.equal(ownBackupHealth(report(),{configured:true,status},now)[1].fresh,false);
 assert.equal(ownBackupHealth(report(),{configured:true,status:'verified'},now)[1].fresh,true);
 const r=report();r.automation={enabled:false,state:'disabled',error:null};assert.equal(ownBackupHealth(r,{configured:true,status:'paused'},now)[0].monitoring,false);assert.equal(ownBackupHealth(r,{configured:true,status:'paused'},now)[1].monitoring,false);
 assert.deepEqual(ownBackupHealth({...r,destination:null},{configured:false},now),[]);
});
