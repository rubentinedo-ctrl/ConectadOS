import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {AppError} from './store.mjs';
import {coolifyURL,publicIPv4} from './coolify.mjs';
// Paths are constructed by the operation planner, never supplied by the browser.
export async function operationRequest(source,token,path,method='GET',{resolve=lookup,request=httpsRequest,signal,beforeDispatch=()=>{}}={}){
 const origin=coolifyURL(source);if(!/^\/api\/v1\/(resources|deployments\/[A-Za-z0-9_-]{1,100}|(?:applications|databases|services)\/[A-Za-z0-9_-]{1,100}(?:\/(?:applications|databases)\/[A-Za-z0-9_-]{1,100})?(?:\/restart(?:\?latest=false)?)?)$/.test(path)||!['GET','POST'].includes(method)||method==='POST'&&!path.includes('/restart')||method==='GET'&&path.includes('/restart'))throw new AppError('Ruta operativa no permitida.');
 if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw new AppError('Acceso de Coolify no válido.',409);
 const abort=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(15000)]);let timer,addresses;
 try{addresses=await Promise.race([resolve(new URL(origin).hostname,{family:4,all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error()),5000)})])}catch{throw new AppError('No se pudo resolver Coolify para esta operación.',502)}finally{clearTimeout(timer)}
 if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>a.family!==4||!publicIPv4(a.address)))throw new AppError('Coolify debe resolver únicamente a IPv4 públicas. No se envió la solicitud.');
 if(abort.aborted)throw new AppError('La solicitud se canceló antes de conectar.',409);
 return new Promise((resolve,reject)=>{
  let req;try{if(method==='POST')beforeDispatch();req=request(new URL(path,origin),{method,signal:abort,headers:{Authorization:'Bearer '+token,Accept:'application/json'},lookup:(_host,o,cb)=>o.all?cb(null,addresses):cb(null,addresses[0].address,4)},res=>{
   const status=res.statusCode??0;
   if(status!==200){res.resume();reject(new AppError(status===401||status===403?'Coolify rechazó el acceso o sus permisos.':status===429?'Coolify limitó la operación. No se reintentará.':status>=300&&status<400?'Coolify redirigió la operación; no se reenvió el token.':'Coolify rechazó la operación. Su resultado debe revisarse antes de otra solicitud.',502));return}
   if(!String(res.headers['content-type']??'').includes('application/json')){res.resume();reject(new AppError('Respuesta operativa incompatible con JSON.',502));return}
   let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(new AppError('Respuesta operativa demasiado grande.',502));return}chunks.push(chunk)});res.on('error',()=>reject(new AppError('Respuesta operativa interrumpida.',502)));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new AppError('Respuesta operativa no válida.',502))}});
  });req.on('error',()=>reject(new AppError('No se confirmó la respuesta de Coolify. No se reintentará la orden.',502)));req.end()}catch(e){reject(e instanceof AppError?e:new AppError('No se confirmó el envío a Coolify.',502))}
 });
}
