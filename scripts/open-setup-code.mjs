import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const execute=promisify(execFile);

export async function setupCodeFile(root){
 if(!path.isAbsolute(root))throw Error('La carpeta de instalación debe ser absoluta.');
 const directory=path.join(root,'.keys'),file=path.join(directory,'setup-token');
 const folder=await lstat(directory),info=await lstat(file);
 if(!folder.isDirectory()||folder.isSymbolicLink()||!info.isFile()||info.isSymbolicLink()||info.size>256)throw Error('El código debe ser un archivo privado regular de esta instalación.');
 return file;
}
/** Open a local editor; do not read or print the secret, or invoke a shell. */
export async function openSetupCode(root,{platform=process.platform,env=process.env,run=execute}={}){
 const file=await setupCodeFile(root);
 if(platform==='darwin')await run('open',['-a','TextEdit',file]);
 else if(platform==='linux'&&(env.WSL_DISTRO_NAME||env.WSL_INTEROP)){
  const {stdout}=await run('wslpath',['-w',file]);
  const windowsPath=stdout.trim();
  if(!windowsPath||/[\r\n\0]/.test(windowsPath))throw Error('No se pudo convertir la ruta de Ubuntu para abrirla en Windows.');
  // Notepad may remain open until the user finishes copying the code.
  await run('notepad.exe',[windowsPath]);
 }else throw Error('En Linux sin escritorio, abre .keys/setup-token con tu editor local. En un VPS usa el procedimiento privado del agente; no pegues el código en el chat.');
 return file;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length)throw Error('Uso: npm run setup:code. Abre el archivo privado en TextEdit (Mac) o Bloc de notas (WSL2); no muestra el código en la terminal.');
  console.log('Abriré el código en un editor local. Cópialo únicamente en /access y cierra el editor sin modificar el archivo. No lo compartas en el chat.');
  await openSetupCode(process.env.CONECTADOS_ROOT||fileURLToPath(new URL('../',import.meta.url)));
  console.log('Usa tu código en la aplicación y elige tu propia contraseña. Si ya creaste la cuenta, entra con tu usuario; no necesitas otro código.');
 }catch(e){console.error(e.code==='ENOENT'?'No se encontró el archivo o el editor. Ejecuta primero el instalador. Para ubicarlo manualmente, lee GUIA-INSTALACION.html → Tu cuenta.':e.message);process.exitCode=1;}
}
