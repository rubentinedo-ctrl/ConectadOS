import {open,constants,mkdir,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readExport,clientConfig} from '../deploy/observer/lib/client.mjs';
const args=process.argv.slice(2);
if(args.length!==2||!args.every(path.isAbsolute)){console.error('Uso: node scripts/observer-export.mjs CONFIGURACION_PRIVADA DESTINO_NUEVO. Usa rutas absolutas; no pegues la clave en argumentos.');process.exitCode=1;}
else{
 let handle;
 try{
  handle=await open(args[0],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();if(!stat.isFile()||stat.size>4096||(stat.mode&0o077)!==0)throw new Error('Private configuration required');
  const config=clientConfig(JSON.parse(await handle.readFile('utf8')));await handle.close();handle=null;
  try{await lstat(args[1]);throw new Error('Destination exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const value=await readExport(config);await mkdir(args[1],{mode:0o700});
  await writeFile(path.join(args[1],'observer-state.json'),value.text,{mode:0o600,flag:'wx'});
  await writeFile(path.join(args[1],'manifest.json'),JSON.stringify({version:1,exportedAt:value.exportedAt,sha256:createHash('sha256').update(value.text).digest('hex'),readerKeyIncluded:false}),{mode:0o600,flag:'wx'});
  console.log('Copia privada del observador guardada y validada. La clave de lectura queda fuera de la copia; recuperación solo en destino nuevo y pausado.');
 }catch{console.error('No se pudo guardar la copia del observador. Revisa configuración privada, origen HTTPS y destino nuevo; no se sobrescribieron archivos.');process.exitCode=1;}
 finally{await handle?.close();}
}
