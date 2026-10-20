import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {readConfig} from './config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let failed=false;
function report(ok,message){console.log(`${ok?'OK':'PENDIENTE'} · ${message}`);if(!ok)failed=true}
report((Number(process.versions.node.split('.')[0])>22||(Number(process.versions.node.split('.')[0])===22&&Number(process.versions.node.split('.')[1])>=16)),'Node.js 22.16 o posterior');
report(existsSync(new URL('../node_modules/next/package.json',import.meta.url)),'Dependencias instaladas');
try {const c=await readConfig(root);report(true,c.mode==='server'?'Origen HTTPS de servidor válido; proxy/TLS aún requieren comprobación':'Configuración local válida');await new Promise(resolve=>{const s=createServer();s.once('error',()=>{report(false,`Puerto ${c.port} ocupado o inaccesible`);resolve()});s.listen(c.port,c.host,()=>{report(true,`Puerto ${c.port} disponible en ${c.host}`);s.close(resolve)})})}catch(e){report(false,'Ejecuta npm run setup. '+e.message)}
console.log('Alcance: diagnóstico local; no valida conexiones, alertas ni respaldos reales.');process.exitCode=failed?1:0;
