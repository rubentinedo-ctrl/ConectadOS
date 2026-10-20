import {S3Client,PutObjectCommand,GetObjectCommand,HeadBucketCommand} from '@aws-sdk/client-s3';
import {BACKUP_ENVELOPE_BYTE_LIMIT} from './backup-envelope.mjs';
export function r2Transport(config,{clientFactory=options=>new S3Client(options)}={}){
 if(!/^[a-f0-9]{32}$/.test(config.account_id)||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket))throw new Error('Destino R2 inválido.');
 const client=clientFactory({region:'auto',endpoint:'https://'+config.account_id+'.r2.cloudflarestorage.com',forcePathStyle:true,credentials:config.credentials,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',logger:{debug(){},info(){},warn(){},error(){}}});
 const safeKey=k=>{if(typeof k!=='string'||!k.startsWith(config.prefix)||!/^conectados\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.cdbak$/.test(k))throw new Error('Objeto fuera del espacio de esta instalación.')};
 return {
  async check(signal){await client.send(new HeadBucketCommand({Bucket:config.bucket}),{abortSignal:signal})},
  async put(objectKey,bytes,signal){safeKey(objectKey);if(bytes.length>BACKUP_ENVELOPE_BYTE_LIMIT)throw new Error('Copia demasiado grande.');await client.send(new PutObjectCommand({Bucket:config.bucket,Key:objectKey,Body:bytes,ContentLength:bytes.length,ContentType:'application/octet-stream',CacheControl:'no-store',IfNoneMatch:'*'}),{abortSignal:signal})},
  async get(objectKey,signal){safeKey(objectKey);const r=await client.send(new GetObjectCommand({Bucket:config.bucket,Key:objectKey}),{abortSignal:signal});const cap=BACKUP_ENVELOPE_BYTE_LIMIT;if(!Number.isSafeInteger(r.ContentLength)||r.ContentLength>cap||r.ContentLength<1){r.Body?.destroy();throw new Error('Respuesta de copia no válida.')}const parts=[];let count=0;try{for await(const part of r.Body){count+=part.length;if(count>cap||signal.aborted)throw new Error('La respuesta excedió el límite.');parts.push(Buffer.from(part))}if(count!==r.ContentLength)throw new Error('Copia incompleta.');return Buffer.concat(parts)}finally{r.Body?.destroy()}},
  close(){client.destroy()}
 };
}
