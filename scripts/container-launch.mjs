import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readConfig,saveConfig,publicOrigin} from './config.mjs';
import {Store} from '../lib/server/store.mjs';
import path from 'node:path';
const code=fileURLToPath(new URL('../',import.meta.url)),root=process.env.CONECTADOS_ROOT||'/state';
let children=[],stopping=false,exitCode=0;
function stop(code=0){if(stopping)return;stopping=true;exitCode=code;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')}
try{
 if(!existsSync('/.dockerenv')||!path.isAbsolute(root))throw new Error('Este lanzador requiere Docker y una carpeta de estado absoluta.');
 const origin=publicOrigin(process.env.CONECTADOS_PUBLIC_ORIGIN);let c;
 try{c=await readConfig(root)}catch(e){if(e.code!=='ENOENT')throw e;c=await saveConfig(root,{schemaVersion:2,mode:'server',host:'0.0.0.0',port:3000,publicOrigin:origin})}
 if(c.mode!=='server'||c.host!=='0.0.0.0'||c.port!==3000||c.publicOrigin!==origin)throw new Error('El estado existente tiene otro modo, listener u origen. Se conservó sin sobrescribir. Prepara una copia de migración revisada.');
 const db=new Store(root);db.close();
 const env={...process.env,CONECTADOS_ROOT:root,PORT:'3000',HOSTNAME:'0.0.0.0',NEXT_TELEMETRY_DISABLED:'1'};
 const child=spawn(process.execPath,[path.join(code,'server.js')],{cwd:code,env,stdio:'inherit'});children.push(child);
 const collector=spawn(process.execPath,[path.join(code,'scripts/collector.mjs')],{cwd:code,env,stdio:'inherit'});children.push(collector);
 const backups=spawn(process.execPath,[path.join(code,'scripts/backup-worker.mjs')],{cwd:code,env,stdio:'inherit'});children.push(backups);
 for(const child of children){child.on('error',()=>{console.error('No se pudo iniciar un proceso de ConectadOS.');stop(1)});child.on('exit',()=>{if(!stopping)stop(1);if(children.every(c=>c.exitCode!==null||c.signalCode!==null))process.exitCode=exitCode})}
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(0));
 console.log('ConectadOS iniciado en red interna Docker. Configuración conservada; requiere proxy HTTPS. Cuenta inicial: usa el archivo privado de configuración, no los registros.');
}catch{console.error('No se pudo iniciar ConectadOS. Revisa origen HTTPS, configuración persistente y permisos de los volúmenes. No se sobrescribió el estado.');process.exitCode=1}
