import {randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {inventoryConnectors} from '../connection-catalog.mjs';
import {observationStale} from '../observations.mjs';
const names=inventoryConnectors.map(p=>p.name);
const table=db=>db.db.exec('CREATE TABLE IF NOT EXISTS welcome_progress(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision TEXT NOT NULL,updated INTEGER NOT NULL)');
const initial=()=>({selected:[],step:'choose',provider:null,status:'new'});

export function welcomeReport(db,{now=Date.now()}={}){
 table(db);const row=db.db.prepare('SELECT * FROM welcome_progress WHERE id=1').get(),progress=row?JSON.parse(row.value):initial();
 const connections=[db.coolifyConnection(),...db.providerConnections()];
 const providers=names.map(name=>{
  const c=name==='Coolify'?connections[0]:connections.find(c=>c?.provider===name),snapshot=c?.snapshot;
  const state=!c?.hasToken?'missing':c.error?'error':!snapshot?'saved':observationStale(c,now)||!Number.isSafeInteger(snapshot.checkedAt)||snapshot.checkedAt>now?'stale':'verified';
  return {name,state,resources:snapshot?.resources?.length??null,checkedAt:snapshot?.checkedAt??null};
 });
 return {progress:{...progress,revision:row?.revision??'initial',updatedAt:row?.updated??null},providers,autoOpen:!row&&!providers.some(p=>p.state!=='missing')};
}
export function changeWelcome(db,input,{now=Date.now()}={}){
 const allowed=['action','revision','selected','step','provider'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||typeof input.revision!=='string')throw new AppError('Revisa el paso del asistente. No incluyas claves en el progreso.');
 table(db);db.db.exec('BEGIN IMMEDIATE');try{
  const report=welcomeReport(db,{now}),current=report.progress;
  if(input.revision!==current.revision)throw new AppError('El asistente cambió en otra pestaña. Actualiza para continuar.',409);
  const next={selected:current.selected,step:current.step,provider:current.provider,status:current.status};
  if(input.action==='select'){
   if(!Array.isArray(input.selected)||input.selected.length>5||new Set(input.selected).size!==input.selected.length||input.selected.some(p=>!names.includes(p)))throw new AppError('Selecciona únicamente los conectores disponibles.');
   next.selected=names.filter(n=>input.selected.includes(n));next.step='choose';next.provider=null;next.status='active';
  }else if(input.action==='navigate'){
   if(!['choose','connect','review'].includes(input.step)||input.step==='connect'&&!next.selected.includes(input.provider))throw new AppError('Paso o proveedor no válidos.');
   next.step=input.step;next.provider=input.step==='connect'?input.provider:null;next.status='active';
  }else if(input.action==='defer')next.status='deferred';
  else if(input.action==='resume')next.status='active';
  else if(input.action==='finish'){
   if(next.step!=='review'||report.providers.some(p=>next.selected.includes(p.name)&&p.state!=='verified'))throw new AppError('Quedan conexiones sin comprobar. Puedes elegir Configurar después sin perder el progreso.',409);
   next.status='complete';
  }else throw new AppError('Acción del asistente no válida.');
  // Progress stores only choices and navigation. Credentials belong to the existing encrypted vault.
  const value=JSON.stringify(next),old=JSON.stringify({selected:current.selected,step:current.step,provider:current.provider,status:current.status});
  if(value!==old||current.revision==='initial'){
   db.db.prepare('INSERT INTO welcome_progress VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated=excluded.updated').run(value,randomUUID(),now);db.record('welcome_'+input.action);
  }
  db.db.exec('COMMIT');return welcomeReport(db,{now});
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
