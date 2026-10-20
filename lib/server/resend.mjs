import {AppError} from './store.mjs';
export function emailAddress(value){
 if(typeof value!=='string'||value.length>254||/[\r\n]/.test(value))throw new AppError('Usa una dirección de correo, sin nombre ni saltos de línea.');
 const address=value.trim(),parts=address.split('@');
 if(parts.length!==2||!parts[0]||parts[0].length>64||!/[a-z0-9]/i.test(parts[0])||!/^[a-z0-9._%+-]+$/i.test(parts[0])||parts[0].startsWith('.')||parts[0].endsWith('.')||parts[0].includes('..')||!parts[1].includes('.')||parts[1].split('.').some(p=>!p||p.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(p)))throw new AppError('Usa una dirección de correo válida en formato simple.');
 return parts[0]+'@'+parts[1].toLowerCase();
}
const error=(message,retryable=false,ambiguous=false,retryAfterMs=60000)=>({accepted:false,error:message,retryable,ambiguous,retryAfterMs});
export async function sendResend(token,body,key,{fetcher=fetch,signal=AbortSignal.timeout(10000)}={}){
 if(typeof token!=='string'||!/^re_[a-z0-9_-]{8,197}$/i.test(token)||typeof key!=='string'||!/^[a-z0-9/-]{1,256}$/i.test(key)||typeof body!=='string'||Buffer.byteLength(body)>8192)throw new AppError('La clave o el correo preparado no son válidos.',409);
 let parsed;try{parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error()}catch{throw new AppError('El correo preparado no tiene un formato válido.')}emailAddress(parsed.from);if(!Array.isArray(parsed.to)||parsed.to.length!==1)throw new AppError('Esta versión envía a una sola dirección.');emailAddress(parsed.to[0]);
 if(Object.keys(parsed).some(k=>!['from','to','subject','text'].includes(k))||typeof parsed.subject!=='string'||parsed.subject.length>200||/[\r\n]/.test(parsed.subject)||typeof parsed.text!=='string'||parsed.text.length>6000)throw new AppError('Contenido de correo no permitido.');
 let response;
 try{response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json','Idempotency-Key':key},body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])})}catch{return error('No se pudo confirmar la respuesta de Resend.',true,true)}
 if([401,403].includes(response.status)){await response.body?.cancel();return error('Resend rechazó el acceso. Revisa la clave limitada y el dominio remitente.')}
 if(response.status===429){const value=response.headers.get('retry-after');await response.body?.cancel();return error('Resend alcanzó su límite de solicitudes o cuota.',true,false,value&&/^\d{1,6}$/.test(value)?Math.max(60000,Math.min(Number(value)*1000,3600000)):60000)}
 if(response.status>=500){await response.body?.cancel();return error('Resend no pudo confirmar el envío.',true,true)}
 if(![200,201,409].includes(response.status)){await response.body?.cancel();return error('Resend rechazó el correo. Revisa remitente, destinatario y verificación del dominio.')}
 if(!response.headers.get('content-type')?.includes('application/json')){await response.body?.cancel();return error('La respuesta de Resend no permite confirmar el envío.',true,true)}
 let value;const reader=response.body?.getReader();if(!reader)return error('Resend devolvió una respuesta vacía.',true,true);
 try{const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return error('La respuesta de Resend excedió el límite.',true,true)}chunks.push(value)}value=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return error('No se pudo leer la confirmación de Resend.',true,true)}
 if(response.status===409)return value?.name==='concurrent_idempotent_requests'?error('Otro intento del mismo correo sigue en curso.',true,false):error('Resend detectó un conflicto con el correo preparado. No se creó otra solicitud.');
 return typeof value?.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)?{accepted:true,providerId:value.id}:error('Resend respondió sin una confirmación válida.',true,true);
}
