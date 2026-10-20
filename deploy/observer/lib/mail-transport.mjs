import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {publicIPv4} from './probe.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function mailAddress(value){
 if(typeof value!=='string'||value.length>254||value!==value.trim()||/[\r\n]/.test(value))throw Error('Invalid mailbox');
 const parts=value.split('@');
 if(parts.length!==2||!parts[0]||parts[0].length>64||!/^[a-z0-9._%+-]+$/i.test(parts[0])||parts[0].startsWith('.')||parts[0].endsWith('.')||parts[0].includes('..')||!parts[1].includes('.')||parts[1].split('.').some(p=>!p||p.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(p)))throw Error('Invalid mailbox');
 return parts[0]+'@'+parts[1].toLowerCase();
}
export function mailBody(value){
 if(typeof value!=='string'||Buffer.byteLength(value)>8192)throw Error('Invalid mail payload');
 const body=JSON.parse(value);
 if(!body||Array.isArray(body)||Object.keys(body).length!==4||!['from','to','subject','text'].every(k=>Object.hasOwn(body,k))||mailAddress(body.from)!==body.from||!Array.isArray(body.to)||body.to.length!==1||mailAddress(body.to[0])!==body.to[0]||typeof body.subject!=='string'||!body.subject||body.subject.length>160||/[\r\n]/.test(body.subject)||typeof body.text!=='string'||!body.text||body.text.length>6000)throw Error('Invalid mail payload');
 return body;
}
async function abortable(operation,signal){
 signal.throwIfAborted();let abort;
 const stopped=new Promise((_,reject)=>{abort=()=>reject(Error('Mail deadline'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});
 try{return await Promise.race([operation(),stopped])}finally{signal.removeEventListener('abort',abort)}
}
// Fixed endpoint, pinned public IPv4, TLS validation, bounded body and no redirects.
// An acknowledgement is acceptance, never evidence of inbox receipt.
export async function sendObserverMail(key,body,idempotencyKey,{resolve=lookup,request=httpsRequest,beforeDispatch,signal:outer,timeoutMs=6000}={}){
 if(typeof key!=='string'||!/^re_[a-z0-9_-]{8,197}$/i.test(key)||typeof body!=='string'||typeof beforeDispatch!=='function'||typeof idempotencyKey!=='string'||!/^[a-z0-9/-]{1,256}$/i.test(idempotencyKey)||body.includes(key)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>6000)throw Error('Invalid mail request');
 mailBody(body);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;
 let dispatched=false;
 try{
  const addresses=await abortable(()=>resolve('api.resend.com',{family:4,all:true}),signal);
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>256||addresses.some(a=>a.family!==4||!publicIPv4(a.address)))return {status:'rejected',code:'blocked-dns'};
  await abortable(()=>beforeDispatch(),signal);signal.throwIfAborted();
  return await abortable(()=>new Promise((done,reject)=>{
   let req;const fail=()=>reject(Error('Mail transport failed'));
   try{
    req=request('https://api.resend.com/emails',{method:'POST',agent:false,rejectUnauthorized:true,maxHeaderSize:16384,signal,headers:{Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Idempotency-Key':idempotencyKey},lookup:(_host,opts,callback)=>opts.all?callback(null,addresses):callback(null,addresses[0].address,4)},res=>{
     const stop=value=>{res.on('error',()=>{});res.destroy();done(value)};
     if(res.socket?.authorized!==true)return stop({status:'uncertain',code:'unconfirmed'});
     if([401,403].includes(res.statusCode))return stop({status:'rejected',code:'permission'});
     if([429,409].includes(res.statusCode)||res.statusCode>=500)return stop({status:'retryable',code:'provider-busy'});
     if(res.statusCode>=300&&res.statusCode<400)return stop({status:'uncertain',code:'unconfirmed'});
     if(![200,201].includes(res.statusCode))return stop({status:'rejected',code:'payload-rejected'});
     if(!String(res.headers['content-type']??'').includes('application/json'))return stop({status:'uncertain',code:'unconfirmed'});
     let bytes=0;const chunks=[];
     res.on('error',fail);res.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)return stop({status:'uncertain',code:'unconfirmed'});chunks.push(Buffer.from(chunk))});
     res.on('end',()=>{try{const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes(key))throw Error();const value=JSON.parse(raw);done(typeof value?.id==='string'&&uuid.test(value.id)?{status:'accepted',providerId:value.id}:{status:'uncertain',code:'unconfirmed'})}catch{done({status:'uncertain',code:'unconfirmed'})}});
    });req.on('error',fail);dispatched=true;req.end(body);
   }catch{req?.destroy();fail()}
  }),signal);
 }catch{return {status:dispatched?'uncertain':'not-dispatched',code:'unconfirmed'}}
 finally{clearTimeout(timer)}
}
