import {fileURLToPath} from 'node:url';
import {Store} from '../lib/server/store.mjs';
import {collectorTick} from '../lib/server/collector.mjs';
const root=process.env.CONECTADOS_ROOT||fileURLToPath(new URL('../',import.meta.url));
let stopped=false,timer;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;clearTimeout(timer)});
async function tick(){
 if(stopped)return;
 let db;try{db=new Store(root);await collectorTick(db)}catch{console.error('Recolector: no se pudo abrir el almacenamiento privado.')}finally{db?.close()}
 if(!stopped)timer=setTimeout(tick,60000);
}
await tick();
