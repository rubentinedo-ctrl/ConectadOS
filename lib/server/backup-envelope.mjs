import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {open,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {backupFile,BACKUP_SOURCE_BYTE_LIMIT,BACKUP_METADATA_BYTE_LIMIT} from './backup-files.mjs';
const magic=Buffer.from('CONECTADOS-BACKUP-1\0'),limit=64*1024*1024;
const compressedMagic=Buffer.from('CONECTADOS-BACKUP-2\0');
export const backupFiles=['conectados.sqlite','install.json','manifest.json','vault.key'];
export const BACKUP_BYTE_LIMIT=limit;
export {BACKUP_SOURCE_BYTE_LIMIT};
export const BACKUP_ENVELOPE_BYTE_LIMIT=limit+magic.length+28;
function key(value){if(!Buffer.isBuffer(value)||value.length!==32)throw new Error('La clave de respaldo debe tener 32 bytes.');return value}
export function sealBackup(files,encryptionKey){
 const parts=[];let total=0;
 for(const name of backupFiles){const bytes=files[name];if(!Buffer.isBuffer(bytes)||!bytes.length||name==='vault.key'&&bytes.length!==32||name!=='conectados.sqlite'&&bytes.length>16384)throw new Error('Paquete de respaldo no válido.');total+=bytes.length+4;if(total>limit)throw new Error('La copia supera el límite de esta versión.');const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);parts.push(length,bytes)}
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(encryptionKey),nonce);cipher.setAAD(magic);const encrypted=Buffer.concat([cipher.update(Buffer.concat(parts)),cipher.final()]);return Buffer.concat([magic,nonce,encrypted,cipher.getAuthTag()]);
}
export function openBackup(envelope,encryptionKey){
 if(!Buffer.isBuffer(envelope)||envelope.length<magic.length+12+16+16||envelope.length>limit+magic.length+28||!envelope.subarray(0,magic.length).equals(magic))throw new Error('Formato de copia cifrada no válido.');
 const nonce=envelope.subarray(magic.length,magic.length+12),decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),nonce);decipher.setAAD(magic);decipher.setAuthTag(envelope.subarray(-16));let plaintext;try{plaintext=Buffer.concat([decipher.update(envelope.subarray(magic.length+12,-16)),decipher.final()])}catch{throw new Error('La copia o su clave no supera la autenticación.')}
 const files={};let offset=0;
 for(const name of backupFiles){if(offset+4>plaintext.length)throw new Error('Paquete incompleto.');const length=plaintext.readUInt32BE(offset);offset+=4;if(!length||length>limit||offset+length>plaintext.length||name==='vault.key'&&length!==32||name!=='conectados.sqlite'&&length>16384)throw new Error('Paquete de respaldo no válido.');files[name]=plaintext.subarray(offset,offset+length);offset+=length}
 if(offset!==plaintext.length||!files['conectados.sqlite'].subarray(0,16).equals(Buffer.from('SQLite format 3\0')))throw new Error('Paquete de respaldo no válido.');return files;
}

// V1 helpers above remain for legacy archives. New archives frame regular files,
// gzip them incrementally, and authenticate the version as AES-GCM AAD.
async function* framedFiles(directory,keyFile){
 let total=0;
 for(const name of backupFiles){
  const file=name==='vault.key'?keyFile:path.join(directory,name);
  const {handle,size}=await backupFile(file,name==='conectados.sqlite'?BACKUP_SOURCE_BYTE_LIMIT:BACKUP_METADATA_BYTE_LIMIT);
  try{
   total+=size+4;if(total>BACKUP_SOURCE_BYTE_LIMIT||name==='vault.key'&&size!==32)throw Error('Paquete de respaldo fuera de los límites.');
   const length=Buffer.alloc(4);length.writeUInt32BE(size);yield length;let count=0;
   for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:65536})){count+=chunk.length;if(count>size)throw Error('La copia cambió durante la lectura.');yield chunk}
   if(count!==size)throw Error('Copia incompleta.');
  }finally{await handle.close()}
 }
}
export async function sealBackupDirectory(directory,keyFile,encryptionKey){
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(encryptionKey),nonce);cipher.setAAD(compressedMagic);
 const parts=[];let count=0,exceeded=false;
 try{await pipeline(Readable.from(framedFiles(directory,keyFile)),createGzip({level:6,chunkSize:65536}),cipher,async source=>{
  for await(const chunk of source){count+=chunk.length;if(count>limit){exceeded=true;throw Error('La copia comprimida supera 64 MiB.')}parts.push(chunk)}
 })}catch(e){if(exceeded)throw Error('La copia comprimida supera 64 MiB.');throw e}
 return Buffer.concat([compressedMagic,nonce,...parts,cipher.getAuthTag()]);
}
function compressedPayload(envelope,encryptionKey){
 if(!Buffer.isBuffer(envelope)||envelope.length<compressedMagic.length+28+1||envelope.length>BACKUP_ENVELOPE_BYTE_LIMIT||!envelope.subarray(0,compressedMagic.length).equals(compressedMagic))throw Error('Formato de copia cifrada no válido.');
 const decipher=createDecipheriv('aes-256-gcm',key(encryptionKey),envelope.subarray(compressedMagic.length,compressedMagic.length+12));
 decipher.setAAD(compressedMagic);decipher.setAuthTag(envelope.subarray(-16));
 try{const plaintext=decipher.update(envelope.subarray(compressedMagic.length+12,-16));const end=decipher.final();return end.length?Buffer.concat([plaintext,end]):plaintext}catch{throw Error('La copia o su clave no supera la autenticación.')}
}
// No decompression or file write happens before GCM final authenticates the input.
// The inflated database is written in chunks, never materialized as a large Buffer.
export async function unpackBackup(envelope,encryptionKey,directory){
 let payload,legacy;
 if(Buffer.isBuffer(envelope)&&envelope.subarray(0,magic.length).equals(magic))legacy=openBackup(envelope,encryptionKey);
 else payload=compressedPayload(envelope,encryptionKey);
 await mkdir(directory,{mode:0o700});let complete=false,handle;
 try{
  if(legacy){for(const name of backupFiles){handle=await open(path.join(directory,name),'wx',0o600);await handle.writeFile(legacy[name]);await handle.close();handle=null}}
  else{
   let index=0,remaining=0,total=0,header=Buffer.alloc(4),headerBytes=0;
   await pipeline(Readable.from([payload]),createGunzip({chunkSize:65536}),async source=>{
    for await(const chunk of source){
     total+=chunk.length;if(total>BACKUP_SOURCE_BYTE_LIMIT)throw Error('La copia expandida supera 512 MiB.');let offset=0;
     while(offset<chunk.length){
      if(index>=backupFiles.length)throw Error('Paquete con datos sobrantes.');
      if(!handle){
       const take=Math.min(4-headerBytes,chunk.length-offset);chunk.copy(header,headerBytes,offset,offset+take);headerBytes+=take;offset+=take;if(headerBytes<4)continue;
       remaining=header.readUInt32BE();headerBytes=0;
       const name=backupFiles[index];if(!remaining||remaining>BACKUP_SOURCE_BYTE_LIMIT||name==='vault.key'&&remaining!==32||name!=='conectados.sqlite'&&remaining>BACKUP_METADATA_BYTE_LIMIT)throw Error('Paquete de respaldo no válido.');
       handle=await open(path.join(directory,name),'wx',0o600);
      }
      const take=Math.min(remaining,chunk.length-offset);if(take){await handle.writeFile(chunk.subarray(offset,offset+take));offset+=take;remaining-=take}
      if(!remaining){await handle.close();handle=null;index++}
     }
    }
    if(index!==backupFiles.length||handle||headerBytes)throw Error('Paquete incompleto.');
   });
   const db=await open(path.join(directory,'conectados.sqlite'),'r');try{const signature=Buffer.alloc(16);const {bytesRead}=await db.read(signature,0,16,0);if(bytesRead!==16||!signature.equals(Buffer.from('SQLite format 3\0')))throw Error('Paquete de respaldo no válido.')}finally{await db.close()}
  }
  complete=true;
 }finally{try{await handle?.close()}finally{if(!complete)await rm(directory,{recursive:true,force:true})}}
}
