import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {createHash} from 'node:crypto';
import {AppError} from './store.mjs';

// Only an operator environment can enable these destinations. Request bodies cannot supply URLs.
const destinations={loopback:'http://127.0.0.1:11434',docker:'http://ollama:11434'};
export function localAssistantRuntime(env=process.env){
 const mode=env.CONECTADOS_LOCAL_AI;
 if(!mode)return {enabled:false,mode:null,binding:'disabled',label:'Modelo local no habilitado en esta instalación.'};
 if(!Object.hasOwn(destinations,mode))return {enabled:false,mode:null,binding:'invalid',label:'Configuración local no válida; revisa CONECTADOS_LOCAL_AI.'};
 return {enabled:true,mode,binding:createHash('sha256').update('ollama-v1:'+destinations[mode]).digest('hex'),label:mode==='loopback'?'Ollama en este equipo · loopback 11434':'Ollama en servicio Docker privado · 11434'};
}
export function localModelName(value){return typeof value==='string'&&value.length<=120&&/^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/.test(value)&&!/(?:^|[-_:])cloud(?:$|[-_:])/i.test(value)}
const modelCanonical=value=>value.includes(':')?value:value+':latest';
export function dockerLocalAddress(address){
 const parts=address.split('.').map(Number);
 return parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168));
}
async function connectAddress(runtime,resolve=lookup){
 if(!runtime.enabled||!Object.hasOwn(destinations,runtime.mode))throw new AppError('Habilita y revisa el servidor Ollama de esta instalación antes de consultar.',409);
 if(runtime.mode==='loopback')return '127.0.0.1';
 let rows;try{rows=await resolve('ollama',{all:true,family:4})}catch{throw new AppError('No se encontró el servicio Docker privado de Ollama.',502)}
 if(!Array.isArray(rows)||!rows.length||rows.some(row=>row.family!==4||!dockerLocalAddress(row.address)))throw new AppError('Ollama debe resolver exclusivamente a la red privada del contenedor.',403);
 return rows[0].address;
}
function interruption(signal){
 return signal.reason?.name==='TimeoutError'
  ?new AppError('Ollama agotó el tiempo de espera. Revisa la capacidad del equipo y el modelo; no se repetirá la consulta automáticamente.',504)
  :new AppError('La consulta local fue detenida.',409);
}
function abortable(action,signal){
 if(signal.aborted)throw interruption(signal);
 return new Promise((resolve,reject)=>{
  const aborted=()=>reject(interruption(signal));signal.addEventListener('abort',aborted,{once:true});
  Promise.resolve().then(action).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
 });
}
/** Fixed, pinned HTTP request: no proxy environment, credentials, redirects, tools or retry. */
export async function localAssistantJSON(path,{method='GET',body,signal,runtime=localAssistantRuntime(),resolve=lookup,requestFactory=http.request}={}){
 const methods={'/api/status':'GET','/api/tags':'GET','/api/show':'POST','/api/chat':'POST'};
 if(!Object.hasOwn(methods,path)||methods[path]!==method)throw new AppError('Operación local no permitida.',403);
 signal=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(35000)]);
 const address=await abortable(()=>connectAddress(runtime,resolve),signal);
 if(signal?.aborted)throw interruption(signal);
 const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
 if(payload&&payload.byteLength>65536)throw new AppError('La consulta local excede el límite.',413);
 return new Promise((resolvePromise,reject)=>{
  let settled=false;
  const fail=error=>{if(settled)return;settled=true;reject(signal.aborted?interruption(signal):error instanceof AppError?error:new AppError('Ollama no completó la consulta local. Revisa su estado y el modelo instalado.',502))};
  const req=requestFactory({hostname:address,port:11434,path,method,agent:false,signal,headers:{Host:runtime.mode==='docker'?'ollama:11434':'127.0.0.1:11434',Accept:'application/json',...(payload?{'Content-Type':'application/json','Content-Length':String(payload.byteLength)}:{})}},res=>{
   if(res.statusCode!==200||!res.headers['content-type']?.includes('application/json')){res.destroy();fail(new AppError('Ollama rechazó la consulta o devolvió un formato no compatible.',502));return}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>524288){res.destroy();fail(new AppError('La respuesta local excede el límite.',502));return}chunks.push(chunk)});
   res.on('error',fail);res.on('aborted',()=>fail(new AppError('La respuesta local se interrumpió.',502)));
   res.on('end',()=>{if(settled)return;let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail(new AppError('La respuesta local no contiene JSON válido.',502));return}if(!value||typeof value!=='object'||Array.isArray(value)){fail(new AppError('La respuesta local no tiene el formato esperado.',502));return}settled=true;resolvePromise(value)});
  });
  req.setTimeout(35000,()=>req.destroy(new AppError('Ollama agotó el tiempo de espera. Revisa la capacidad del equipo y el modelo; no se repetirá la consulta automáticamente.',504)));
  req.on('error',fail);req.end(payload??undefined);
 });
}
function localModel(row){return row&&localModelName(row.name)&&!row.remote_model&&!row.remote_host&&row.details?.format==='gguf'&&typeof row.digest==='string'&&/^[a-f0-9]{64}$/.test(row.digest)&&Number.isSafeInteger(row.size)&&row.size>0}
async function localStatus(request,options){
 const status=await request('/api/status',options);
 if(status?.cloud?.disabled!==true)throw new AppError('Ollama debe confirmar que su nube está desactivada. Configura OLLAMA_NO_CLOUD=1 y reinícialo antes de consultar.',409);
}
export async function listLocalAssistantModels({request=localAssistantJSON,signal=AbortSignal.timeout(20000),runtime=localAssistantRuntime()}={}){
 if(!runtime.enabled)throw new AppError('El modelo local no está habilitado. Consulta la guía de instalación.',409);
 const options={signal,runtime};await localStatus(request,options);const data=await request('/api/tags',options);
 if(!Array.isArray(data.models)||data.models.length>2000)throw new AppError('El catálogo local no tiene el formato o tamaño esperado.',502);
 const models=[...new Set(data.models.filter(localModel).map(row=>row.name))].sort();
 return {models,complete:true,source:'Ollama privado',checkedAt:Date.now(),coverage:'Solo modelos GGUF descargados, sin destino remoto declarado; nube desactivada confirmada por Ollama. El catálogo no acredita calidad ni compatibilidad: se revisan las capacidades antes de cada consulta.'};
}
export async function generateLocalAssistant({model,instructions,prompt,maxOutput,signal,beforeDispatch,runtimeBinding},{request=localAssistantJSON,runtime=localAssistantRuntime()}={}){
 if(!runtime.enabled||runtimeBinding!==runtime.binding)throw new AppError('La configuración local cambió. Prepara una revisión nueva.',409);
 if(!localModelName(model)||typeof instructions!=='string'||typeof prompt!=='string'||!Number.isSafeInteger(maxOutput)||maxOutput<128||maxOutput>4000)throw new AppError('Revisa el modelo y los límites de la consulta local.');
 const options={signal,runtime};await localStatus(request,options);const tags=await request('/api/tags',options);
 if(!Array.isArray(tags.models)||tags.models.length>2000)throw new AppError('El catálogo local no es válido.',502);
 const selected=tags.models.find(row=>localModel(row)&&modelCanonical(row.name)===modelCanonical(model));
 if(!selected)throw new AppError('El modelo no está descargado o no es un modelo local permitido.',409);
 const info=await request('/api/show',{...options,method:'POST',body:{model:selected.name}});
 if(info.remote_model||info.remote_host||info.details?.format!=='gguf'||!Array.isArray(info.capabilities)||!info.capabilities.includes('completion'))throw new AppError('El modelo no acredita generación de texto local.',409);
 const length=info.model_info?.[String(info.model_info?.['general.architecture'])+'.context_length'];
 const needed=Buffer.byteLength(instructions+prompt)+maxOutput+256,numContext=Math.max(2048,2**Math.ceil(Math.log2(needed)));
 if(!Number.isSafeInteger(length)||length<numContext||numContext>32768)throw new AppError('El modelo no tiene contexto suficiente para esta revisión. Elige uno compatible; no se recortarán las fuentes.',409);
 if(signal?.aborted)throw interruption(signal);
 beforeDispatch();
 const result=await request('/api/chat',{...options,method:'POST',body:{model:selected.name,messages:[{role:'system',content:instructions},{role:'user',content:prompt}],stream:false,think:false,keep_alive:0,options:{num_predict:maxOutput,num_ctx:numContext,num_thread:2,temperature:0}}});
 if(result.remote_model||result.remote_host||result.done!==true||modelCanonical(result.model??'')!==modelCanonical(selected.name)||result.message?.role!=='assistant'||(result.message.tool_calls?.length??0)>0||typeof result.message?.content!=='string'||!result.message.content.trim()||result.message.content.length>32000)throw new AppError('El modelo local no devolvió una respuesta de texto completa y compatible.',502);
 const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=10000000;
 if(count(result.eval_count)&&result.eval_count>maxOutput)throw new AppError('El modelo local excedió el límite de salida.',502);
 return {text:result.message.content,outputLimited:result.done_reason==='length'||result.eval_count===maxOutput,input:count(result.prompt_eval_count)?result.prompt_eval_count:undefined,output:count(result.eval_count)?result.eval_count:undefined};
}
