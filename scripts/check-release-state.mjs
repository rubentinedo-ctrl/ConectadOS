import {checkReleaseBackup} from '../lib/server/release-check.mjs';
const args=process.argv.slice(2);
if(args.length!==2){console.error('Uso: node scripts/check-release-state.mjs RUTA_ABSOLUTA_COPIA RUTA_ABSOLUTA_VAULT_KEY');process.exitCode=1}else{
 try{console.log(JSON.stringify(await checkReleaseBackup(...args)))}catch{console.error('El candidato no puede recuperar esta copia. Se conservó el origen; revisa versión, integridad y clave original.');process.exitCode=1}
}
