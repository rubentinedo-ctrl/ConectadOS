import {writeFile} from 'node:fs/promises';import path from 'node:path';
import {restoreToNewDirectory} from './backup.mjs';import {Store} from './store.mjs';import {publicOrigin,validateConfig} from '../../scripts/config.mjs';
import {pauseCopiedEffects} from './copy-state.mjs';
export async function prepareServerCopy(source,target,keySource,origin){
 const config=validateConfig({schemaVersion:2,mode:'server',host:'0.0.0.0',port:3000,publicOrigin:publicOrigin(origin)});
 await restoreToNewDirectory(source,target,keySource);
 const db=new Store(target);try{pauseCopiedEffects(db,'server_copy_prepared')}finally{db.close()}
 await writeFile(path.join(target,'.data/install.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
 return {origin:config.publicOrigin,collectorEnabled:false,notificationsEnabled:false,sourcePreserved:true,keyIncludedInBackup:false};
}
