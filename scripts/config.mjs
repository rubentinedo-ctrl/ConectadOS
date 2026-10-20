import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
export function publicOrigin(value){
 if(typeof value!=='string'||value.length>300)throw new Error('Indica el dominio HTTPS principal de esta instalación.');
 let url;try{url=new URL(value)}catch{throw new Error('El origen público debe ser un dominio HTTPS válido.')}
 const host=url.hostname;
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||isIP(host)!==0||host.startsWith('[')||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.length>253||host.split('.').some(label=>!label||label.length>63||!/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(label)))throw new Error('Usa un dominio HTTPS, sin IP, puerto, credenciales, rutas ni parámetros.');
 return url.origin;
}
export function setupArgs(args){
 const result={demo:false,server:false,origin:null,port:null,help:false};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--demo'&&!result.demo)result.demo=true;
  else if(args[i]==='--server'&&!result.server)result.server=true;
  else if(args[i]==='--origin'&&result.origin===null&&args[i+1])result.origin=publicOrigin(args[++i]);
  else if(args[i]==='--help')result.help=true;
  else if(args[i]==='--port'&&result.port===null&&/^\d+$/.test(args[i+1]??''))result.port=Number(args[++i]);
  else throw new Error('Usa --demo [--port NUMERO], o --server --origin https://dominio [--port NUMERO].');
 }
 if(result.port!==null&&(!Number.isInteger(result.port)||result.port<1024||result.port>65535))throw new Error('El puerto debe ser un entero de 1024 a 65535.');
 if(result.demo&&result.server||result.server!==Boolean(result.origin))throw new Error('Elige modo local o servidor. El servidor necesita --origin HTTPS.');
 return result;
}
export function validateConfig(value){
 if(!value||!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('Configuración incompatible: puerto 1024–65535 requerido.');
 if(value.schemaVersion===1&&value.mode==='demo'&&value.host==='127.0.0.1')return {schemaVersion:1,mode:'demo',host:'127.0.0.1',port:value.port};
 if(value.schemaVersion===2&&value.mode==='server'&&['127.0.0.1','0.0.0.0'].includes(value.host))return {schemaVersion:2,mode:'server',host:value.host,port:value.port,publicOrigin:publicOrigin(value.publicOrigin)};
 throw new Error('Configuración incompatible. No se modificó la instalación.');
}
export function installationOrigin(value){const c=validateConfig(value);return c.mode==='server'?c.publicOrigin:`http://${c.host}:${c.port}`}
export async function saveConfig(root,value){const safe=validateConfig(value),dir=path.join(root,'.data');await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,'install.json'),JSON.stringify(safe,null,2)+'\n',{flag:'wx',mode:0o600});return safe}
export async function readConfig(root){return validateConfig(JSON.parse(await readFile(path.join(root,'.data/install.json'),'utf8')))}
