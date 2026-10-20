import {AppError} from './store.mjs';
export async function readJSONBody(request,limit=16384,timeoutMs=5000){
 if(!request.body)throw new AppError('La solicitud está vacía.');
 const reader=request.body.getReader();let size=0,timer;const chunks=[];
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new AppError('La solicitud tardó demasiado en llegar.',408));void reader.cancel().catch(()=>{})},timeoutMs)});
 try{for(;;){const {value,done}=await Promise.race([reader.read(),timeout]);if(done)break;size+=value.byteLength;if(size>limit){void reader.cancel().catch(()=>{});throw new AppError('La solicitud es demasiado grande.',413)}chunks.push(value)}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}catch{throw new AppError('Formato JSON no válido.')}
 }finally{clearTimeout(timer);reader.releaseLock()}
}
