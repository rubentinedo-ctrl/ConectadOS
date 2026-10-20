import {get,head,put,BlobPreconditionFailedError,BlobNotFoundError} from '@vercel/blob';
import {MAX_BYTES} from './monitor.mjs';
const PATHS=new Set(['observer/state-v1.json','observer/mail-v1.json']);
async function abortable(operation,signal){
 signal.throwIfAborted();let abort;
 const stopped=new Promise((_,reject)=>{abort=()=>reject(Error('Observer storage deadline'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});
 try{return await Promise.race([operation(),stopped])}finally{signal.removeEventListener('abort',abort)}
}
export function blobStore({read=get,metadata=head,write=put,record=value=>console.info(JSON.stringify(value)),pathname='observer/state-v1.json',timeoutMs=8000}={}){
 if(!PATHS.has(pathname)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)throw Error('Invalid observer storage');
 async function bounded(operation){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{return await operation(controller.signal)}finally{clearTimeout(timer)}}
 return {
  async read(){return bounded(async signal=>{
   let before;try{before=await abortable(()=>metadata(pathname,{abortSignal:signal}),signal)}catch(e){if(e instanceof BlobNotFoundError)return null;throw e}
   const result=await abortable(()=>read(pathname,{access:'private',useCache:false,abortSignal:signal}),signal);if(result===null)return null;
   if(result.statusCode!==200||!result.stream||result.blob.pathname!==pathname||typeof result.blob.etag!=='string'||result.blob.etag.length>256||!Number.isInteger(result.blob.size)||result.blob.size>MAX_BYTES)throw Error('Invalid observer storage');
   const reader=result.stream.getReader();let bytes=0;const chunks=[];
   try{while(true){const {done,value}=await abortable(()=>reader.read(),signal);if(done)break;bytes+=value.length;if(bytes>MAX_BYTES)throw Error('Observer storage too large');chunks.push(Buffer.from(value))}}finally{void reader.cancel().catch(()=>{})}
   const after=await abortable(()=>metadata(pathname,{abortSignal:signal}),signal);
   if(typeof before.etag!=='string'||!before.etag||before.etag.length>256||before.etag!==after.etag||before.pathname!==pathname||after.pathname!==pathname)throw Error('Observer version changed while reading');
   record({component:'observer-storage',downloadTagMatches:result.blob.etag===after.etag});return {etag:after.etag,value:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
  })},
  async compareAndSet(etag,value){return bounded(async signal=>{
   const body=JSON.stringify(value);if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Observer state too large');
   const options={access:'private',addRandomSuffix:false,contentType:'application/json',cacheControlMaxAge:60,abortSignal:signal,allowOverwrite:etag!==null,...(etag!==null?{ifMatch:etag}:{})};
   try{const result=await abortable(()=>write(pathname,body,options),signal);if(typeof result.etag!=='string'||result.etag.length>256)throw Error('Invalid storage acknowledgement');return result.etag}catch(e){if(e instanceof BlobPreconditionFailedError)return null;throw e}
  })}
 };
}
