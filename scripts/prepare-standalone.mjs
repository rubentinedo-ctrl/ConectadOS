import {access,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {packageDependencyNotices} from './dependency-inventory.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),target=path.join(root,'.next/standalone');
await access(path.join(target,'server.js'));
await cp(path.join(root,'.next/static'),path.join(target,'.next/static'),{recursive:true});
try{await access(path.join(root,'public'));await cp(path.join(root,'public'),path.join(target,'public'),{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}
await packageDependencyNotices(root,target);
