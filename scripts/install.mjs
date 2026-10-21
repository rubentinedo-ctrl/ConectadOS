import {spawn} from 'node:child_process';
import {readFile,lstat} from 'node:fs/promises';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {inventoryConnectors} from '../lib/connection-catalog.mjs';
import {setupArgs,readConfig,installationOrigin} from './config.mjs';

export function installerArgs(args){
 const setup=[],result={apply:false,preferences:null};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply'&&!result.apply)result.apply=true;
  else if(args[i]==='--preferences'&&result.preferences===null&&args[i+1])result.preferences=args[++i];
  else setup.push(args[i]);
 }
 return {...result,...setupArgs(setup)};
}
export async function readPreferences(file){
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>10240)throw Error('El plan debe ser un archivo JSON de hasta 10 KiB.');
 let p;try{p=JSON.parse(await readFile(file,'utf8'))}catch{throw Error('El plan no contiene JSON válido.');}
 const fields=['schemaVersion','mode','installationTarget','requestedProviders','aiPreference','voiceRequested','notice'];
 const providers=['Coolify','Vercel','Cloudflare','Hostinger','Supabase','Resend','Google Drive'];
 if(!p||Object.keys(p).length!==fields.length||!fields.every(k=>Object.hasOwn(p,k))||p.schemaVersion!==1||p.mode!=='demo'||!['Computadora local','VPS / Coolify (requiere HTTPS y revisión)'].includes(p.installationTarget)||!Array.isArray(p.requestedProviders)||p.requestedProviders.length>7||new Set(p.requestedProviders).size!==p.requestedProviders.length||p.requestedProviders.some(x=>!providers.includes(x))||!['Sin IA','API comercial con mi clave','Modelo local compatible (pendiente)'].includes(p.aiPreference)||typeof p.voiceRequested!=='boolean'||typeof p.notice!=='string'||p.notice.length>500)throw Error('Plan incompatible. No se ejecutó ni se activó ningún servicio.');
 return {installationTarget:p.installationTarget,providers:p.requestedProviders,ai:p.aiPreference,voice:p.voiceRequested};
}
export async function installationPlan(root,args){
 const preferences=args.preferences?await readPreferences(path.resolve(args.preferences)):null;
 let current;try{current=await readConfig(root)}catch(e){if(e.code!=='ENOENT')throw e;}
 if(current&&(args.port!==null&&args.port!==current.port||args.server&&current.mode!=='server'||args.demo&&current.mode!=='demo'||args.origin&&args.origin!==current.publicOrigin))throw Error('La configuración existente es diferente. Se conserva; prepara una actualización o migración revisada.');
 if(preferences?.installationTarget.startsWith('VPS')&&!args.server&&!current)throw Error('El plan propone VPS/Coolify. Lee deploy/README.md y define el origen HTTPS; el plan no autoriza un despliegue.');
 const target=current??(args.server?{schemaVersion:2,mode:'server',host:'127.0.0.1',port:args.port??3000,publicOrigin:args.origin}:{schemaVersion:1,mode:'demo',host:'127.0.0.1',port:args.port??3119});
 if(target.host!=='127.0.0.1')throw Error('Esta instalación pertenece al lanzador Docker; usa su procedimiento de actualización.');
 return {target,origin:installationOrigin(target),existing:Boolean(current),preferences,setup:target.mode==='server'?['--server','--origin',target.publicOrigin,'--port',String(target.port)]:['--demo','--port',String(target.port)]};
}
export async function assertPortAvailable(host,port){
 await new Promise((resolve,reject)=>{const server=createServer();server.once('error',()=>reject(Error(`El puerto ${port} está ocupado o inaccesible. No se tocaron dependencias ni configuración. Detén únicamente tu instalación o elige otro puerto para una carpeta nueva.`)));server.listen(port,host,()=>server.close(resolve));});
}
async function command(root,program,args,label){
 console.log('\n'+label);
 await new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd:root,stdio:'inherit',shell:false,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});child.once('error',()=>reject(Error('No se pudo ejecutar '+label+'. Comprueba Node.js y npm.')));child.once('exit',code=>code===0?resolve():reject(Error(label+' terminó con error. No se inicia la aplicación; conserva la carpeta para revisar.')));});
}
export async function install(root,args){
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<16)throw Error('Instala Node.js 22.16 o posterior desde https://nodejs.org/en/download.');
 if(!['darwin','linux'].includes(process.platform))throw Error('Este recorrido está preparado para macOS y Linux. En Windows abre Ubuntu WSL2 y ejecuta allí Git, Node y npm; no uses Node de Windows.');
 const plan=await installationPlan(root,args);
 console.log(`ConectadOS · ${plan.existing?'instalación existente conservada':'instalación nueva'}\nCarpeta: ${root}\nDirección: ${plan.origin}\nPasos: requisitos, dependencias del lock, preparación, diagnóstico y compilación.\nLas conexiones y la IA se configuran después con tus propios accesos.`);
 console.log(`Conectores de inventario disponibles: ${inventoryConnectors.map(p=>p.name).join(', ')}.\nNetlify, EasyPanel y otras plataformas: solo fichas manuales, sin consulta API. Hostinger no descubre las aplicaciones del VPS.\nGuía con logo y configuración paso a paso: GUIA-INSTALACION.html (abre con doble clic).`);
 if(plan.preferences)console.log('Preferencias del plan validadas. No se usan como órdenes ni permisos de acceso.');
 if(!args.apply){console.log('Revisión sin cambios. Añade --apply para instalar.');return plan;}
 await assertPortAvailable(plan.target.host,plan.target.port);
 // Probe npm before making changes; invoke every command without a shell.
 await command(root,'npm',['--version'],'1/5 · Comprobar npm');
 await command(root,'npm',['ci','--no-fund','--no-audit'],'2/5 · Instalar dependencias del archivo de bloqueo');
 await command(root,process.execPath,['scripts/setup.mjs',...plan.setup],'3/5 · Preparar sin reemplazar cuenta ni claves');
 await command(root,process.execPath,['scripts/doctor.mjs'],'4/5 · Diagnóstico');
 await command(root,'npm',['run','build'],'5/5 · Compilar');
 console.log(`\nPreparada. Inicia con npm start y abre ${plan.origin}${plan.target.mode==='demo'?'/demo':''}.\nCrea tu cuenta en ${plan.origin}/access. Para abrir el código en un editor local, usa otra terminal en esta carpeta: npm run setup:code (Mac o Windows/WSL2). No muestra el código en la terminal.\nEl archivo privado es .keys/setup-token. Pega el código solo en la aplicación; elige allí tu contraseña. Si ya tienes cuenta, consérvala.\nPara detener: Ctrl+C. Para volver a iniciar: npm start.\nGuía visual: GUIA-INSTALACION.html. Guía de texto: docs/GETTING-STARTED.md.`);
 if(plan.target.mode==='server')console.log('Antes de usar el origen público, el agente debe comprobar el proxy HTTPS y sus permisos. Este comando no configura DNS ni publica puertos.');
 return plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=installerArgs(process.argv.slice(2));if(args.help)console.log('node scripts/install.mjs [--apply] [--demo] [--port NUMERO] [--preferences conectados-plan.json]\nServidor Node detrás de proxy: --server --origin https://dominio. Para Coolify: deploy/README.md. Sin --apply solo revisa.');else await install(fileURLToPath(new URL('../',import.meta.url)),args);}catch(e){console.error(e.message);process.exitCode=1;}
}
