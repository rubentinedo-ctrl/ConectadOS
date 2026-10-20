import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {origin,publicIPv4} from './probe.mjs';
const paths=new Map([['/api/export',71536],['/api/mail-report',32768],['/api/mail-export',66000]]);
export function readerConfiguration(value){
 if(!value||Object.keys(value).length!==2||typeof value.readSecret!=='string'||value.readSecret.length<32||value.readSecret.length>512||/[\r\n]/.test(value.readSecret))throw Error('Invalid observer reader');
 return {url:origin(value.url),readSecret:value.readSecret};
}
async function abortable(operation,signal){signal.throwIfAborted();let stop;const pending=new Promise((_,reject)=>{stop=()=>reject(Error('Reader deadline'));signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()});try{return await Promise.race([operation(),pending])}finally{signal.removeEventListener('abort',stop)}}
// Only fixed GET paths; this key never reaches /api/check or /api/mail.
export async function privateObserverRead(value,path,{resolve=lookup,request=httpsRequest,timeoutMs=10000,signal:outer}={}){
 const config=readerConfiguration(value),max=paths.get(path);if(!max||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid private read');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;
 try{
  const addresses=await abortable(()=>resolve(new URL(config.url).hostname,{family:4,all:true}),signal);
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>256||addresses.some(a=>a.family!==4||!publicIPv4(a.address)))throw Error('Blocked address');
  const text=await abortable(()=>new Promise((done,reject)=>{
   let req;const fail=()=>reject(Error('Private observer read failed'));
   try{req=request(new URL(path,config.url),{method:'GET',agent:false,rejectUnauthorized:true,maxHeaderSize:16384,signal,headers:{Authorization:'Bearer '+config.readSecret,Accept:'application/json'},lookup:(_host,options,cb)=>options.all?cb(null,addresses):cb(null,addresses[0].address,4)},res=>{
    if(res.socket?.authorized!==true||res.statusCode!==200||!String(res.headers['content-type']??'').includes('application/json')){res.on('error',()=>{});res.destroy();return fail()}
    let bytes=0;const chunks=[];res.on('error',fail);res.on('data',chunk=>{bytes+=chunk.length;if(bytes>max){res.destroy();return fail()}chunks.push(Buffer.from(chunk))});res.on('end',()=>done(Buffer.concat(chunks).toString('utf8')));
   });req.on('error',fail);req.end()}catch{req?.destroy();fail()}
  }),signal);
  if(text.includes(config.readSecret))throw Error('Unsafe reader response');return {text,source:config.url+path};
 }catch{throw Error('Could not read a valid private observer response')}finally{clearTimeout(timer)}
}
