import path from 'node:path';
import {restoreToNewDirectory} from '../lib/server/backup.mjs';
const [source,target,key]=process.argv.slice(2);
if(!source||!target||!key){console.error('Uso: node scripts/restore.mjs CARPETA_COPIA DESTINO_NUEVO ARCHIVO_VAULT_KEY');process.exitCode=1}else{
 try{await restoreToNewDirectory(path.resolve(source),path.resolve(target),path.resolve(key));console.log('Restauración verificada en carpeta nueva. Sesiones anteriores invalidadas. Conserva los archivos privados y usa el código de la misma versión para iniciar.')}catch(e){console.error(e.message);process.exitCode=1}
}
