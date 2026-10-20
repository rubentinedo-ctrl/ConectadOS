import test from 'node:test';
import assert from 'node:assert/strict';
import {backupOverview,consoleCopyStatus} from '../lib/backup-workspace.mjs';
const now=1792440000000,receipt={backupAt:now-3600000,restored:true};
const base={status:'observed',error:null,expiresAt:now+60000,items:[{ref:'one',state:'restored',latest:receipt},{ref:'two',state:'unverified',latest:{...receipt,restored:false}},{ref:'three',state:'unknown',latest:null}]};
test('Backup coverage does not count historical receipts after expiry, failed reading or unavailable inventory',()=>{
 assert.equal(backupOverview(base,now).restored,1);
 for(const report of [{...base,expiresAt:now-1},{...base,status:'stale'},{...base,error:'Report unavailable'}]){const v=backupOverview(report,now);assert.equal(v.restored,0);assert.equal(v.pending,3);assert.equal(v.rows[0].state,'stale');assert.equal(v.rows[0].item.latest,receipt)}
 assert.equal(backupOverview(base,now,true).restored,0);assert.equal(backupOverview(undefined,now).total,0);
});
test('Age and future timestamps cannot turn a stored restored label into a current proof',()=>{
 for(const backupAt of [now-26*3600000,now+60000]){const v=backupOverview({...base,items:[{ref:'one',state:'restored',latest:{backupAt,restored:true}}]},now);assert.equal(v.restored,0);assert.equal(v.pending,1)}
});
const own={r2:{configured:true,enabled:true,workerFresh:true,lastVerified:{createdAt:now-3600000},lastAttempt:{state:'verified'}},drive:{configured:true,status:'verified',expiresAt:now+60000,copyAgeLimitMs:25*3600000,lastVerified:{createdAt:now-3600000}}};
test('Console proof distinguishes valid receipt from paused schedule, failed attempt and old or missing heartbeat',()=>{
 assert.equal(consoleCopyStatus(own,now).r2.tone,'verified');
 for(const patch of [{enabled:false},{workerFresh:false},{lastAttempt:{state:'uncertain'}},{lastVerified:{createdAt:now-26*3600000}}])assert.notEqual(consoleCopyStatus({...own,r2:{...own.r2,...patch}},now).r2.tone,'verified');
 assert.equal(consoleCopyStatus(own,now,true).r2.tone,'unknown');
});
test('Drive inclusion is not conflated with a valid current restoration receipt',()=>{
 assert.equal(consoleCopyStatus(own,now).drive.tone,'verified');
 for(const patch of [{status:'unverified'},{expiresAt:now-1},{lastVerified:{createdAt:now-26*3600000}},{error:'Source error'}])assert.notEqual(consoleCopyStatus({...own,drive:{...own.drive,...patch}},now).drive.tone,'verified');
 assert.equal(consoleCopyStatus(undefined,now).drive.tone,'unknown');
});
