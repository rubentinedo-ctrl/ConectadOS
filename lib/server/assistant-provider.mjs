import {generateText} from 'ai';
import {createOpenAI} from '@ai-sdk/openai';
import {createAnthropic} from '@ai-sdk/anthropic';
import {createGoogle} from '@ai-sdk/google';
import {AppError} from './store.mjs';
// SDK warnings may contain raw provider details. No telemetry or raw warning logger.
globalThis.AI_SDK_LOG_WARNINGS=false;
const origins={OpenAI:'https://api.openai.com',Anthropic:'https://api.anthropic.com',Google:'https://generativelanguage.googleapis.com'};
async function bounded(fetcher,url,init){
 let response;try{response=await fetcher(url,{...init,redirect:'error'})}catch{throw new AppError('No se obtuvo una respuesta del proveedor de IA.',502)}
 if(!response.ok){await response.body?.cancel();throw new AppError(response.status===401||response.status===403?'El proveedor de IA rechazó el acceso. Revisa clave y permisos.':response.status===429?'El proveedor de IA limitó la consulta. Revisa su cuota.':'El proveedor de IA rechazó la consulta. Revisa el modelo y su disponibilidad.',502)}
 if(!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();throw new AppError('El proveedor de IA devolvió un formato no compatible.',502)}
 const reader=response.body?.getReader();if(!reader)throw new AppError('La respuesta de IA está vacía.',502);let size=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();throw new AppError('La respuesta de IA excede el límite.',502)}chunks.push(value)}}catch(e){throw e instanceof AppError?e:new AppError('La respuesta de IA se interrumpió.',502)}
 return new Response(Buffer.concat(chunks),{status:response.status,headers:{'Content-Type':'application/json'}});
}
export async function generateAssistant({provider,model,key,instructions,prompt,maxOutput,signal,beforeDispatch,runtimeBinding},{fetcher=fetch}={}){
 if(provider==='Ollama')return (await import('./assistant-local.mjs')).generateLocalAssistant({model,instructions,prompt,maxOutput,signal,beforeDispatch,runtimeBinding});
 const origin=origins[provider];if(!origin||typeof key!=='string'||!key)throw new AppError('Falta un acceso de IA válido.',409);
 const path=provider==='OpenAI'?'/v1/chat/completions':provider==='Anthropic'?'/v1/messages':'/v1beta/models/'+encodeURIComponent(model)+':generateContent';
 const sdkFetch=async(input,init)=>{const url=new URL(String(input));if(url.origin!==origin||url.pathname!==path||url.search||init?.method!=='POST')throw new AppError('Destino de IA no permitido.',403);beforeDispatch();return bounded(fetcher,url,{...init,signal})};
 const settings={apiKey:key,baseURL:origin+(provider==='Google'?'/v1beta':'/v1'),fetch:sdkFetch};
 const languageModel=provider==='OpenAI'?createOpenAI(settings).chat(model):provider==='Anthropic'?createAnthropic(settings)(model):createGoogle(settings)(model);
 const result=await generateText({model:languageModel,instructions,prompt,maxOutputTokens:maxOutput,maxRetries:0,abortSignal:signal,telemetry:{isEnabled:false},providerOptions:provider==='OpenAI'?{openai:{store:false}}:{}});
 return {text:result.text,input:result.usage.inputTokens,output:result.usage.outputTokens};
}
export async function listAssistantModels(provider,key,{fetcher=fetch,signal=AbortSignal.timeout(20000)}={}){
 if(provider==='Ollama'){if(key)throw new AppError('Ollama local no recibe una clave API.');return (await import('./assistant-local.mjs')).listLocalAssistantModels({signal})}
 const origin=origins[provider];if(!origin||typeof key!=='string'||key.length<8||key.length>4096||/\s/.test(key))throw new AppError('Indica el proveedor y una clave válida.');
 const headers=provider==='OpenAI'?{Authorization:'Bearer '+key}:provider==='Anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{'x-goog-api-key':key};
 let path=provider==='Google'?'/v1beta/models?pageSize=100':'/v1/models',models=[],complete=false;
 for(let page=0;page<20;page++){const response=await bounded(fetcher,new URL(path,origin),{method:'GET',headers:{...headers,Accept:'application/json'},signal});let value;try{value=await response.json()}catch{throw new AppError('El catálogo de modelos no es válido.',502)}
 const data=provider==='Google'?value.models:value.data;if(!Array.isArray(data))throw new AppError('El catálogo de modelos no tiene el formato esperado.',502);
 for(const row of data){if(provider==='Google'&&!row.supportedGenerationMethods?.includes('generateContent'))continue;const id=provider==='Google'?row.name?.replace(/^models\//,''):row.id;if(typeof id==='string'&&id.length<=120&&/^[a-zA-Z0-9._:-]+$/.test(id)&&!id.includes(key))models.push(id)}
 const token=provider==='Google'?value.nextPageToken:provider==='Anthropic'&&value.has_more?value.last_id:null;if(!token){complete=true;break}if(typeof token!=='string'||token.length>1000)throw new AppError('Paginación de modelos no válida.',502);path=provider==='Google'?'/v1beta/models?pageSize=100&pageToken='+encodeURIComponent(token):'/v1/models?after_id='+encodeURIComponent(token);if(models.length>2000)break;
 }
 return {models:[...new Set(models)].sort().slice(0,2000),complete,source:origin,checkedAt:Date.now(),coverage:'El catálogo no acredita compatibilidad de cada modelo con generación de texto. Comprueba el modelo en una consulta autorizada.'};
}
