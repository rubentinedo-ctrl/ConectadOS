import {AppError} from './store.mjs';
export async function transcribeRecording({key,model,bytes,signal,beforeDispatch},{fetcher=fetch}={}){
 const body=new FormData();body.append('model',model);body.append('file',new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),'recording.wav');
 beforeDispatch();let r;try{r=await fetcher('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key,Accept:'application/json'},body,signal,redirect:'error'})}catch{throw new AppError('No se obtuvo respuesta del servicio de transcripción.',502)}
 if(!r.ok){await r.body?.cancel();throw new AppError(r.status===401||r.status===403?'OpenAI rechazó el acceso de voz. Revisa clave y permisos.':r.status===429?'OpenAI limitó la transcripción. Revisa tu cuota.':'OpenAI rechazó la grabación o el modelo de transcripción.',502)}
 if(!r.headers.get('content-type')?.includes('application/json')){await r.body?.cancel();throw new AppError('La respuesta de transcripción no es JSON.',502)}
 const reader=r.body?.getReader();if(!reader)throw new AppError('La transcripción está vacía.',502);let size=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new AppError('La transcripción supera el límite.',502)}chunks.push(value)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch(e){throw e instanceof AppError?e:new AppError('La respuesta de transcripción no se pudo leer.',502)}
}
