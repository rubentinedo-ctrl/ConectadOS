import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';

export const BACKUP_SOURCE_BYTE_LIMIT=512*1024*1024;
export const BACKUP_METADATA_BYTE_LIMIT=16384;

// Open the actual regular file without following a link. Keep reads on that descriptor.
export async function backupFile(file,limit){
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const info=await handle.stat();if(!info.isFile()||info.size<1||info.size>limit)throw Error('Archivo de copia fuera de los límites.');return {handle,size:info.size}}catch(e){await handle.close();throw e}
}
export async function backupFileHash(file,limit=BACKUP_SOURCE_BYTE_LIMIT){
 const {handle,size}=await backupFile(file,limit);let count=0;const hash=createHash('sha256');
 try{for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:65536})){count+=chunk.length;if(count>size)throw Error('La copia cambió durante la lectura.');hash.update(chunk)}if(count!==size)throw Error('Copia incompleta.');return hash.digest('hex')}finally{await handle.close()}
}
export async function readBackupMetadata(file,limit=BACKUP_METADATA_BYTE_LIMIT){
 const {handle,size}=await backupFile(file,limit);let count=0;const parts=[];
 try{for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:16384})){count+=chunk.length;if(count>size)throw Error('La copia cambió durante la lectura.');parts.push(chunk)}if(count!==size)throw Error('Copia incompleta.');return Buffer.concat(parts)}finally{await handle.close()}
}
export async function copyBackupFile(source,target,expectedHash,limit=BACKUP_SOURCE_BYTE_LIMIT){
 const {handle,size}=await backupFile(source,limit);let destination,count=0;const hash=createHash('sha256');
 try{destination=await open(target,'wx',0o600);await pipeline(handle.createReadStream({autoClose:false,highWaterMark:65536}),async input=>{for await(const chunk of input){count+=chunk.length;if(count>size)throw Error('La copia cambió durante la lectura.');hash.update(chunk);await destination.writeFile(chunk)}});if(count!==size||hash.digest('hex')!==expectedHash)throw Error('La copia no supera la comprobación de integridad.')}finally{try{await destination?.close()}finally{await handle.close()}}
}
