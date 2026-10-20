import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import {Store} from '../lib/server/store.mjs';
import {validateGoogleIdentity,verifyGoogleCredential} from '../lib/server/google.mjs';
const clientId='test-client.apps.googleusercontent.com';

test('Google verification rejects forged signatures, audience, issuer, expiry and nonce without network',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const {privateKey:wrongKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const client=new OAuth2Client();client.getFederatedSignonCertsAsync=async()=>({certs:{test:publicKey.export({type:'spki',format:'pem'})},format:'PEM',res:null});
 const now=Math.floor(Date.now()/1000);const claims={iss:'https://accounts.google.com',aud:clientId,iat:now,exp:now+300,nonce:'test-nonce',sub:'owner-google-id',email:'owner@example.test',email_verified:true};
 const jwt=(value,key=privateKey)=>{const content=[{alg:'RS256',kid:'test'},value].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return content+'.'+sign('RSA-SHA256',Buffer.from(content),key).toString('base64url')};
 assert.deepEqual(await verifyGoogleCredential(jwt(claims),clientId,'test-nonce',client),{sub:claims.sub,email:claims.email});
 await assert.rejects(verifyGoogleCredential(jwt(claims,wrongKey),clientId,'test-nonce',client),{status:403});
 for(const patch of [{aud:'someone-else'},{iss:'https://malicious.example'},{exp:now-500},{nonce:'wrong-nonce'},{email_verified:false}])await assert.rejects(verifyGoogleCredential(jwt({...claims,...patch}),clientId,'test-nonce',client),{status:403});
 assert.throws(()=>validateGoogleIdentity({...claims,exp:undefined},clientId,'test-nonce'),{status:403});
 await assert.rejects(verifyGoogleCredential('not-a-jwt',clientId,'test-nonce',client),{status:403});
});

test('Google linking requires owner session, single-use browser binding and exact subject; unlink invalidates sessions',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'conectados-google-'));let db;
 try{
  db=new Store(root);const password=randomBytes(24).toString('hex');const setup=await readFile(path.join(root,'.keys/setup-token'),'utf8');const owner=await db.createOwner(setup,'owner',password);
  await assert.rejects(db.confirmOwner('wrong'),{status:401});await db.confirmOwner(password);
  db.saveGoogleClient(clientId);assert.throws(()=>db.beginGoogle('login'),{status:409});assert.throws(()=>db.beginGoogle('link','invalid'),{status:401});
  const begin=db.beginGoogle('link',owner);assert.throws(()=>db.consumeGoogle(begin.nonce,'other-browser',owner),{status:403});
  const flow=db.consumeGoogle(begin.nonce,begin.browser,owner);assert.throws(()=>db.consumeGoogle(begin.nonce,begin.browser,owner),{status:403});
  const identity={sub:'google-owner',email:'owner@example.test'};const linked=db.finishGoogle(flow,identity);assert.equal(db.authenticate(linked),true);assert.equal(db.googleStatus().linked,true);
  assert.throws(()=>db.saveGoogleClient('other.apps.googleusercontent.com'),{status:409});
  const other=db.beginGoogle('login');const otherFlow=db.consumeGoogle(other.nonce,other.browser);assert.throws(()=>db.finishGoogle(otherFlow,{...identity,sub:'different-sub'}),{status:403});
  const login=db.beginGoogle('login');const loginFlow=db.consumeGoogle(login.nonce,login.browser);const session=db.finishGoogle(loginFlow,identity);assert.equal(db.authenticate(session),true);
  const expired=db.beginGoogle('link',owner);db.db.prepare('UPDATE google_flows SET expires=0').run();assert.throws(()=>db.consumeGoogle(expired.nonce,expired.browser,owner),{status:403});
  const loggedOut=db.beginGoogle('link',owner);db.logout(owner);assert.throws(()=>db.consumeGoogle(loggedOut.nonce,loggedOut.browser,owner),{status:403});
  const pending=db.beginGoogle('login');const pendingFlow=db.consumeGoogle(pending.nonce,pending.browser);db.unlinkGoogle(session);assert.throws(()=>db.finishGoogle(pendingFlow,identity),{status:409});assert.equal(db.authenticate(session),true);assert.equal(db.authenticate(linked),false);assert.equal(db.googleStatus().linked,false);
  const fallback=await db.login('owner',password);assert.equal(db.authenticate(fallback),true);
  db.close();db=new Store(root);assert.equal(db.googleStatus().configured,true);assert.equal(db.googleStatus().linked,false);
  assert.equal(JSON.stringify(db.audit()).includes(identity.email),false);
 }finally{db?.close();await rm(root,{recursive:true,force:true})}
});
