import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {fileURLToPath} from 'node:url';
import {readConfig,saveConfig,setupArgs,installationOrigin} from './config.mjs';
import {Store} from '../lib/server/store.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let args;try{args=setupArgs(process.argv.slice(2))}catch(e){console.error(e.message);process.exit(1)}
if(args.help){console.log('Local: npm run setup -- --demo [--port NUMERO]. Servidor detrás de proxy HTTPS: npm run setup -- --server --origin https://dominio [--port NUMERO]. Conserva configuraciones existentes. No abre ni publica puertos.');process.exit(0)}
if(Number(process.versions.node.split('.')[0])<22||Number(process.versions.node.split('.')[0])===22&&Number(process.versions.node.split('.')[1])<16){console.error('Instala Node.js 22.16 o posterior antes de continuar.');process.exit(1)}
let config;
try{config=await readConfig(root);console.log('Configuración existente conservada.')}catch(e){
 if(e.code!=='ENOENT'){console.error('No se sobrescribió la configuración: '+e.message);process.exit(1)}
 let port=args.port??(args.server?3000:3119);
 if(!args.demo&&!args.server&&args.port===null){if(!stdin.isTTY){console.error('Sin terminal interactivo. Usa npm run setup -- --demo.');process.exit(1)}const prompt=createInterface({input:stdin,output:stdout});console.log('ConectadOS — instalación local. La demostración no necesita APIs.');const answer=await prompt.question('Puerto local [3119]: ');prompt.close();if(answer.trim())port=Number(answer)}
 try{config=await saveConfig(root,args.server?{schemaVersion:2,mode:'server',host:'127.0.0.1',port,publicOrigin:args.origin}:{schemaVersion:1,mode:'demo',host:'127.0.0.1',port})}catch(e){console.error(e.message);process.exit(1)}
}
if(args.port!==null&&args.port!==config.port||args.server&&config.mode!=='server'||args.demo&&config.mode!=='demo'||args.origin&&args.origin!==config.publicOrigin){console.error('La instalación existente tiene otro puerto, modo u origen. Se conservó. Prepara una migración revisada; no se sobrescribió.');process.exit(1)}
const db=new Store(root);const hasOwner=db.hasOwner(),configured=(db.coolifyConnection()?.hasToken?1:0)+db.providerConnections().filter(row=>row.hasToken).length;db.close();
console.log(hasOwner?'Cuenta administradora existente conservada.':'Para crear la primera cuenta, abre /access. En otra terminal, npm run setup:code abre .keys/setup-token en tu editor (Mac o WSL2). Copia el código solo en la aplicación, nunca en un chat.');
console.log(`Preparación guardada. Ejecuta npm run doctor y después npm run build.\nPara iniciar: node scripts/launch.mjs\nDirección: ${installationOrigin(config)}\n${configured?`${configured} accesos conservados; su vigencia se comprueba en cada conector.`:'La demostración no necesita claves; prepara conexiones propias en /settings.'}`);
if(config.mode==='server')console.log('Modo servidor preparado. Requiere proxy HTTPS para este origen, almacenamiento privado y revisión antes de exponerlo. El proceso escucha solo en loopback.');
