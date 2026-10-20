import {AppError} from './store.mjs';
const origins={Vercel:'https://api.vercel.com',Cloudflare:'https://api.cloudflare.com',Supabase:'https://api.supabase.com',Hostinger:'https://developers.hostinger.com'};
export async function providerJSON(provider,path,token,{fetcher=fetch,signal=AbortSignal.timeout(25000)}={}){
 const origin=origins[provider];if(!origin||typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))throw new AppError('Destino de proveedor no permitido.',400);
 if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw new AppError(`Guarda un token válido de ${provider}.`,409);
 const url=new URL(path,origin);if(url.origin!==origin)throw new AppError('Destino de proveedor no permitido.',400);
 let response;
 try{response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})}catch{throw new AppError(`No se pudo conectar con ${provider}.`,502)}
 if(response.status!==200){await response.body?.cancel();throw new AppError(response.status===401?`${provider}: token vencido o no válido.`:response.status===403?`${provider}: faltan permisos para este inventario.`:response.status===429?`${provider}: límite de consultas alcanzado. Espera antes de reintentar.`:`${provider} no pudo devolver el inventario.`,502)}
 if(!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();throw new AppError(`${provider} devolvió un formato distinto de JSON.`,502)}
 const reader=response.body?.getReader();if(!reader)throw new AppError(`${provider} devolvió una respuesta vacía.`,502);const chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new AppError(`La respuesta de ${provider} excede el límite de esta versión.`,502)}chunks.push(value)}}catch(e){if(e instanceof AppError)throw e;throw new AppError(`La respuesta de ${provider} se interrumpió.`,502)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new AppError(`${provider} devolvió un JSON no válido.`,502)}
}
export function safeText(value,max=200,token=''){return typeof value==='string'&&value.length<=max&&(!token||!value.includes(token))?value:null}
export function domainName(value){return typeof value==='string'&&value.length<=253&&/^(?:\*\.)?[a-zA-Z0-9_](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9_])?\.?$/.test(value)?value.toLowerCase().replace(/\.$/,''):null}
