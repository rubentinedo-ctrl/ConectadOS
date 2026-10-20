import sharp from 'sharp';
import {AppError} from './store.mjs';
export const logoInputLimit=512*1024;
export const logoBodyLimit=Math.ceil(logoInputLimit/3)*4+4096;
function formatOf(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'jpeg';
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'webp';
 return null;
}
function animatedPNG(bytes){
 let offset=8;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+length+12;
  if(end>bytes.length)throw new AppError('El archivo PNG está incompleto.');
  const type=bytes.subarray(offset+4,offset+8).toString();
  if(type==='acTL')return true;
  if(type==='IEND')return false;
  offset=end;
 }
 return false;
}
export function decodeLogoInput(value){
 if(typeof value!=='string'||!value||value.length>Math.ceil(logoInputLimit/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new AppError('Selecciona un logo PNG, JPEG o WebP de hasta 512 KB.',400);
 const bytes=Buffer.from(value,'base64');
 if(bytes.toString('base64')!==value||bytes.length>logoInputLimit)throw new AppError('El archivo excede 512 KB o su codificación no es válida.',400);
 return bytes;
}
export async function normalizeLogo(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>logoInputLimit)throw new AppError('Selecciona un archivo de hasta 512 KB.');
 const format=formatOf(bytes);if(!format)throw new AppError('Usa PNG, JPEG o WebP. Los archivos SVG, GIF y enlaces no se admiten.');
 if(format==='png'&&animatedPNG(bytes))throw new AppError('El logo debe ser una imagen estática, sin animación.');
 try{
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:2048*2048,limitInputChannels:4});
  const meta=await image.metadata();
  if(meta.format!==format||!meta.width||!meta.height||meta.width>2048||meta.height>2048||(meta.pages??1)!==1)throw new AppError('Usa una imagen estática de hasta 2048 × 2048 píxeles.');
  const output=await image.autoOrient().resize({width:128,height:128,fit:'inside',withoutEnlargement:true}).png({compressionLevel:6}).timeout({seconds:3}).toBuffer();
  if(output.length>100000)throw new AppError('No se pudo reducir este logo al tamaño permitido.');
  return output;
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('No se pudo leer la imagen. Usa PNG, JPEG o WebP estático, de hasta 2048 × 2048 píxeles.')}
}
