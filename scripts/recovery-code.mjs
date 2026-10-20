import path from 'node:path';import {fileURLToPath} from 'node:url';
import {issueRecoveryCode} from '../lib/server/account-recovery.mjs';
const args=process.argv.slice(2);
if(args.length>1||args[0]?.startsWith('-')){console.error('Uso: node scripts/recovery-code.mjs [CARPETA_ESTADO]. No acepta contraseñas ni códigos como argumento.');process.exitCode=1}else{
 try{const root=path.resolve(args[0]||process.env.CONECTADOS_ROOT||fileURLToPath(new URL('../',import.meta.url))),result=await issueRecoveryCode(root);console.log(`Código privado preparado en ${result.file}\nCaduca: ${result.expiresAt}\nAbre el archivo local para usarlo en Recuperar acceso. No lo imprimas ni lo pegues en un chat. Reemplaza cualquier código anterior; no cambia tu contraseña ni inicia sesión.`)}catch{console.error('No se pudo preparar la recuperación. Revisa la cuenta existente, configuración y acceso privado a sus archivos.');process.exitCode=1}
}
