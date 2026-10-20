import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {performance} from 'node:perf_hooks';
import {publicIPv4,coolifyURL} from './coolify.mjs';
import {AppError} from './store.mjs';
export function probeURL(value){
 try{const url=coolifyURL(value);if(new URL(url).hostname.endsWith('.'))throw new Error();return url}catch{throw new AppError('Usa el dominio principal HTTPS, sin IP, puerto, rutas, credenciales ni parámetros.')}
}
export function responseKind(status){return status>=200&&status<300?'response':status>=300&&status<400?'redirect':status===401||status===403?'protected':status===405?'unsupported':'http-error'}
export async function checkWeb(value,{resolve=lookup,request=httpsRequest,signal:outerSignal}={}){
 const url=probeURL(value),started=performance.now(),signal=outerSignal?AbortSignal.any([outerSignal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
 const finish=(fields)=>{const checkedAt=Date.now();return {source:url,method:'HEAD',checkedAt,expiresAt:checkedAt+300000,...fields}};
 try{
  signal.throwIfAborted();
  let abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(new Error('cancelled'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});
  let addresses;try{addresses=await Promise.race([resolve(new URL(url).hostname,{family:4,all:true}),cancelled])}finally{signal.removeEventListener('abort',abort)}
  if(!Array.isArray(addresses)||!addresses.length||addresses.length>256||addresses.some(a=>a.family!==4||!publicIPv4(a.address)))return finish({kind:'blocked',httpStatus:null,durationMs:null,certificateExpiresAt:null,error:'El destino no resuelve únicamente a IPv4 públicas. No se contactó.'});
  return await new Promise((resolveResult)=>{
   const fail=()=>resolveResult(finish({kind:'unreachable',httpStatus:null,durationMs:null,certificateExpiresAt:null,error:'No se obtuvo respuesta HTTPS válida en diez segundos. Revisa DNS, certificado y conectividad.'}));
   let req;try{
    req=request(new URL(url),{method:'HEAD',agent:false,rejectUnauthorized:true,maxHeaderSize:16384,headers:{'User-Agent':'ConectadOS/0.1 availability-check'},signal,lookup:(_host,options,cb)=>{if(options.all)cb(null,addresses);else cb(null,addresses[0].address,4)}},res=>{
     const status=res.statusCode??0;
     if(res.socket?.authorized!==true||status<100||status>599){res.destroy();fail();return}
     const validTo=Date.parse(res.socket.getPeerCertificate?.()?.valid_to??'');
     const result=finish({kind:responseKind(status),httpStatus:status,durationMs:Math.max(0,Math.round(performance.now()-started)),certificateExpiresAt:Number.isFinite(validTo)?validTo:null,error:null});
     // No response bodies, cookies, redirect destinations or certificate identities are retained.
     res.on('error',()=>{});resolveResult(result);res.destroy();
    });req.on('error',fail);req.end();
   }catch{req?.destroy();fail()}
  });
 }catch{return finish({kind:'unreachable',httpStatus:null,durationMs:null,certificateExpiresAt:null,error:'No se pudo resolver o conectar al destino HTTPS. No se enviaron credenciales.'})}
}
export async function refreshWebProbe(db,id,{force=false,check=checkWeb,signal}={}){
 const probe=db.webProbes().find(p=>p.id===id);if(!probe)throw new AppError('Comprobación no encontrada.',404);
 if(!force&&!probe.enabled)return {disabled:true};
 if(!force&&probe.snapshot&&Date.now()-probe.snapshot.checkedAt<55000)return {cached:true};
 const lease=db.acquireProvider('_probe_'+id);if(!lease)return {busy:true};
 try{
  const result=await check(probe.url,{signal});
  db.saveWebProbeResult(id,probe.revision,result);return {updated:true};
 }finally{db.releaseProvider('_probe_'+id,lease)}
}
export async function collectWebProbes(db,{check=checkWeb}={}){
 const probes=db.webProbes().filter(p=>p.enabled);if(!probes.length)return {idle:true};
 const lease=db.acquireProvider('_web_probes');if(!lease)return {busy:true};
 const signal=AbortSignal.timeout(25000);let cursor=0,skipped=0,failed=0;
 try{
  async function worker(){while(cursor<probes.length){const probe=probes[cursor++];if(signal.aborted){skipped++;continue}try{await refreshWebProbe(db,probe.id,{check,signal})}catch(e){if(!(e instanceof AppError&&[404,409].includes(e.status)))failed++}}}
  await Promise.all(Array.from({length:Math.min(2,probes.length)},()=>worker()));if(failed)throw new AppError('No se pudieron guardar algunas comprobaciones web. Revisa el almacenamiento local.',502);return {checked:true,skipped,failed};
 }finally{db.releaseProvider('_web_probes',lease)}
}
