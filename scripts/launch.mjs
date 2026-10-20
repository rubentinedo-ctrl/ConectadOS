import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {readConfig} from './config.mjs';
import {Store} from '../lib/server/store.mjs';
import path from 'node:path';
const code=fileURLToPath(new URL('../',import.meta.url)),root=process.env.CONECTADOS_ROOT||code;
try {
 if(!path.isAbsolute(root))throw new Error('La carpeta de estado debe ser una ruta absoluta.');
 const config=await readConfig(root);if(config.host!=='127.0.0.1')throw new Error('Usa el lanzador Docker para un listener interno de contenedor.');const db=new Store(root);db.close();
 if(!existsSync(path.join(code,'.next/standalone/server.js'))||!existsSync(path.join(code,'.next/standalone/.next/static')))throw new Error('Falta el paquete compilado: ejecuta npm run build.');
 const env={...process.env,CONECTADOS_ROOT:root,HOSTNAME:config.host,PORT:String(config.port),NEXT_TELEMETRY_DISABLED:'1'};
 const child=spawn(process.execPath,[path.join(code,'.next/standalone/server.js')],{cwd:code,env,stdio:'inherit'});
 const collector=spawn(process.execPath,[fileURLToPath(new URL('./collector.mjs',import.meta.url))],{cwd:root,env,stdio:'inherit'});
 collector.on('error',()=>console.error('Recolector no disponible; el panel marcará su lectura como vencida.'));
 const backups=spawn(process.execPath,[fileURLToPath(new URL('./backup-worker.mjs',import.meta.url))],{cwd:root,env,stdio:'inherit'});
 backups.on('error',()=>console.error('Respaldos: trabajador no disponible; revisa su pulso en el panel.'));
 child.on('exit',()=>{collector.kill('SIGTERM');backups.kill('SIGTERM')});
 child.on('error',()=>{console.error('No se pudo iniciar el servidor. Ejecuta npm run doctor.');process.exitCode=1});
 child.on('exit',code=>{process.exitCode=code??1});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal);collector.kill(signal);backups.kill(signal)});
}catch(e){console.error(e.message);process.exitCode=1}
