import test from 'node:test';import assert from 'node:assert/strict';
import {cookieNames} from '../lib/server/cookies.mjs';
test('session and Google cookies isolate installations sharing one localhost hostname',()=>{
 const first=cookieNames('/tmp/install-one'),second=cookieNames('/tmp/install-two');
 assert.notEqual(first.session,second.session);assert.notEqual(first.google,second.google);
 assert.deepEqual(first,cookieNames('/tmp/install-one/'));assert.notEqual(first.session,first.google);
 assert.match(first.session,/^conectados_session_[a-f0-9]{16}$/);assert.equal(first.session.includes('install-one'),false);
});
test('HTTPS cookies use host prefix, secure flag and root path; local compatibility stays isolated',async()=>{
 const {cookiePolicy}=await import('../lib/server/cookies.mjs');const p=cookiePolicy('/state',{mode:'server'}),local=cookiePolicy('/state',{mode:'demo'});assert.match(p.session,/^__Host-/);assert.match(p.google,/^__Host-/);assert.equal(p.secure,true);assert.equal(p.path,'/');assert.equal(p.googlePath,'/');assert.equal(local.secure,false);assert.equal(local.googlePath,'/api/google');assert.notEqual(p.session,local.session);
});
