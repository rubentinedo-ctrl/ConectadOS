import {fileURLToPath} from 'node:url';import {Store} from '../lib/server/store.mjs';import {automaticBackupTick} from '../lib/server/backup-automation.mjs';
const root=process.env.CONECTADOS_ROOT||fileURLToPath(new URL('../',import.meta.url));let stopped=false,timer;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;clearTimeout(timer)});
async function tick(){if(stopped)return;let db;try{db=new Store(root);const result=await automaticBackupTick(db,{authorize:()=>!stopped});if(result.verified||result.paused||result.retryBeforeUpload)console.log(JSON.stringify({worker:'backups',result:result.verified?'verified':result.paused?'paused':'retry-before-upload',at:Date.now()}))}catch(e){const code=String(e?.code??'');console.error(JSON.stringify({worker:'backups',result:'check-failed',code:/^SQLITE_(BUSY|LOCKED)$/.test(code)?code:'review-required',at:Date.now()}))}finally{db?.close()}if(!stopped)timer=setTimeout(tick,60000)}
await tick();
