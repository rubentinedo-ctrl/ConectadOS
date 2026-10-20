import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {snapshot} from '../lib/server/backup.mjs';
const root=process.env.CONECTADOS_ROOT||fileURLToPath(new URL('../',import.meta.url));
await mkdir(path.join(root,'.backups'),{recursive:true,mode:0o700});
const destination=path.join(root,'.backups',new Date().toISOString().replaceAll(':','-'));
try{await snapshot(root,destination);console.log(`Copia local creada: ${destination}\nConserva .keys/vault.key por separado en una ubicación privada. La copia no incluye la clave. Copia y clave son necesarias para recuperar credenciales. El envío externo sigue pendiente.`)}catch{console.error('No se pudo crear la copia. Revisa configuración, permisos y espacio.');process.exitCode=1}
