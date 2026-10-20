import {createHash,randomUUID} from 'node:crypto';
import {origin,probe} from './probe.mjs';
export const MAX_BYTES=65536;
const kinds=new Set(['responding','protected','unsupported','http-error','blocked','unreachable']);
const statuses=new Set(['unknown','checking','responding','issue']);
const integer=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
export function configuration(env=process.env) {
  let targets;
  try {
    const raw=JSON.parse(env.OBSERVER_TARGETS??'[]');
    if(!Array.isArray(raw)||raw.length<1||raw.length>8)throw new Error();
    targets=raw.map(t=>{
      if(!exact(t,['id','url'])||typeof t.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(t.id))throw new Error();
      return {id:t.id,url:origin(t.url)};
    }).sort((a,b)=>a.id.localeCompare(b.id));
    if(new Set(targets.map(t=>t.id)).size!==targets.length||new Set(targets.map(t=>t.url)).size!==targets.length)throw new Error();
    const intervalSeconds=Number(env.OBSERVER_INTERVAL_SECONDS??300);
    if(!integer(intervalSeconds,60,3600))throw new Error();
    return {targets,intervalSeconds,hash:createHash('sha256').update(JSON.stringify({targets,intervalSeconds})).digest('hex')};
  } catch {throw new Error('Invalid observer configuration');}
}
function sampleOK(s) {
  if(!exact(s,['checkedAt','kind','status','durationMs','certificateExpiresAt'])||!integer(s.checkedAt)||!kinds.has(s.kind))return false;
  const response=['responding','protected','unsupported','http-error'].includes(s.kind);
  if(response) {
    if(!integer(s.status,100,599)||!integer(s.durationMs,0,45000))return false;
    const kind=s.status>=200&&s.status<400?'responding':s.status===401||s.status===403?'protected':s.status===405?'unsupported':'http-error';
    if(s.kind!==kind)return false;
  } else if(s.status!==null||s.durationMs!==null||s.certificateExpiresAt!==null)return false;
  return s.certificateExpiresAt===null||integer(s.certificateExpiresAt);
}
function initial(config) {
  return {version:1,configurationHash:config.hash,lastAttemptAt:null,completedAt:null,lease:null,
    targets:config.targets.map(t=>({id:t.id,status:'unknown',failures:0,successes:0,last:null,incidentId:null})),history:[],events:[]};
}
export function validateState(value,config) {
  if(!exact(value,['version','configurationHash','lastAttemptAt','completedAt','lease','targets','history','events'])||value.version!==1||value.configurationHash!==config.hash||!Array.isArray(value.targets)||value.targets.length!==config.targets.length||!Array.isArray(value.history)||value.history.length>60||!Array.isArray(value.events)||value.events.length>50)throw new Error('Invalid observer state');
  for(const key of ['lastAttemptAt','completedAt'])if(value[key]!==null&&!integer(value[key]))throw new Error('Invalid observer time');
  if(value.completedAt!==null&&(value.lastAttemptAt===null||value.completedAt>value.lastAttemptAt+45000))throw new Error('Invalid observer time');
  const uuid=s=>typeof s==='string'&&/^[0-9a-f-]{36}$/.test(s);
  if(value.lease!==null&&(!exact(value.lease,['id','startedAt','expiresAt'])||!uuid(value.lease.id)||!integer(value.lease.startedAt)||value.lease.startedAt!==value.lastAttemptAt||value.lease.expiresAt!==value.lease.startedAt+90000))throw new Error('Invalid observer lease');
  for(let i=0;i<value.targets.length;i++) {
    const t=value.targets[i];
    if(!exact(t,['id','status','failures','successes','last','incidentId'])||t.id!==config.targets[i].id||!statuses.has(t.status)||!integer(t.failures,0,3)||!integer(t.successes,0,2)||t.last!==null&&!sampleOK(t.last)||t.incidentId!==null&&!uuid(t.incidentId)||t.status==='issue'&&t.incidentId===null||t.status!=='issue'&&t.incidentId!==null)throw new Error('Invalid target state');
  }
  let previous=-1;
  for(const r of value.history) {
    if(!exact(r,['startedAt','completedAt','samples'])||!integer(r.startedAt)||!integer(r.completedAt,r.startedAt,r.startedAt+45000)||r.startedAt<=previous||!Array.isArray(r.samples)||r.samples.length!==config.targets.length||r.samples.some(s=>!sampleOK(s)||s.checkedAt<r.startedAt||s.checkedAt>r.completedAt))throw new Error('Invalid history');
    previous=r.startedAt;
  }
  for(const e of value.events)if(!exact(e,['id','targetId','kind','at','incidentId','delivery'])||!uuid(e.id)||!config.targets.some(t=>t.id===e.targetId)||!['issue','recovered'].includes(e.kind)||!integer(e.at)||!uuid(e.incidentId)||e.delivery!=='not-configured')throw new Error('Invalid event');
  if(Buffer.byteLength(JSON.stringify(value))>MAX_BYTES)throw new Error('Observer state too large');
  return value;
}
export async function tick(store,config,{now=Date.now,check=probe,id=randomUUID}={}) {
  const loaded=await store.read(),state=loaded?validateState(loaded.value,config):initial(config),startedAt=now();
  if(state.lease&&state.lease.expiresAt>startedAt)return {status:'busy'};
  if(state.lastAttemptAt!==null&&startedAt-state.lastAttemptAt<config.intervalSeconds*1000-15000)return {status:'not-due'};
  const acquired={...state,lastAttemptAt:startedAt,lease:{id:id(),startedAt,expiresAt:startedAt+90000}};
  const etag=await store.compareAndSet(loaded?.etag??null,acquired);
  if(!etag)return {status:'conflict'};
  const signal=AbortSignal.timeout(35000);
  const samples=new Array(config.targets.length);let cursor=0;
  async function worker(){while(cursor<config.targets.length){const index=cursor++;let s;try{s=await check(config.targets[index].url,{signal,now});}catch{s={checkedAt:now(),kind:'unreachable',status:null,durationMs:null,certificateExpiresAt:null};}if(!sampleOK(s))throw new Error('Invalid probe result');samples[index]=s;}}
  await Promise.all(Array.from({length:Math.min(3,config.targets.length)},()=>worker()));
  const completedAt=now();
  if(completedAt-startedAt>45000||completedAt<startedAt||samples.some(s=>s.checkedAt<startedAt||s.checkedAt>completedAt))return {status:'expired'};
  const events=[...state.events];
  const targets=state.targets.map((old,i)=>{
    const last=samples[i],continuous=old.last!==null&&startedAt-old.last.checkedAt<=config.intervalSeconds*2000+30000;
    const good=last.kind==='responding';
    const failures=good?0:Math.min(3,(continuous?old.failures:0)+1),successes=good?Math.min(2,(continuous?old.successes:0)+1):0;
    let status=old.status,incidentId=old.incidentId;
    if(failures===3&&status!=='issue'){status='issue';incidentId=id();events.push({id:id(),targetId:old.id,kind:'issue',at:completedAt,incidentId,delivery:'not-configured'});}
    else if(successes===2){if(status==='issue')events.push({id:id(),targetId:old.id,kind:'recovered',at:completedAt,incidentId,delivery:'not-configured'});status='responding';incidentId=null;}
    else if(status!=='issue')status='checking';
    return {id:old.id,status,failures,successes,last,incidentId};
  });
  const result={...acquired,completedAt,lease:null,targets,history:[...state.history,{startedAt,completedAt,samples}].slice(-60),events:events.slice(-50)};
  while(Buffer.byteLength(JSON.stringify(result))>MAX_BYTES&&result.history.length>1)result.history.shift();
  validateState(result,config);
  if(!await store.compareAndSet(etag,result))return {status:'superseded'};
  return {status:'observed',targets:targets.length,completedAt};
}
export function report(state,config,now=Date.now()) {
  if(!state)return {version:1,coverage:'HTTPS HEAD only; no database transaction or host diagnosis',status:'never-observed',targets:[],history:[],events:[],notifications:'not-configured'};
  validateState(state,config);
  const freshness=config.intervalSeconds*2000+30000;
  const fresh=state.completedAt!==null&&state.completedAt<=now&&now-state.completedAt<=freshness;
  return {version:1,coverage:'HTTPS HEAD only; no database transaction or host diagnosis',status:fresh?'observed':'stale',completedAt:state.completedAt,intervalSeconds:config.intervalSeconds,
    targets:state.targets.map((t,i)=>({...t,url:config.targets[i].url,current: fresh&&t.last&&t.last.checkedAt<=now&&now-t.last.checkedAt<=freshness?t.status:'unknown'})),history:state.history,events:state.events,notifications:'not-configured'};
}
