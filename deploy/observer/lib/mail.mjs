import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {mailAddress,mailBody,sendObserverMail} from './mail-transport.mjs';
import {validateState as validateMonitor} from './monitor.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const nullableTime=v=>v===null||time(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const states=new Set(['planned','queued','sending','accepted','retryable','uncertain','failed','cancelled']);
const errors=new Set([null,'unconfirmed','provider-busy','permission','payload-rejected','blocked-dns','expired','superseded']);
const terminal=new Set(['accepted','uncertain','failed','cancelled']);
const DAY=86400000,WINDOW=23*3600000;
function secret(v){return typeof v==='string'&&v.length>=32&&v.length<=512&&!/[\r\n]/.test(v)}
export function mailConfiguration(env,monitor){
 if(!env.OBSERVER_MAIL_KEY&&!env.OBSERVER_MAIL_FROM&&!env.OBSERVER_MAIL_TO&&!env.OBSERVER_MAIL_INSTANCE)return null;
 const key=env.OBSERVER_MAIL_KEY,instance=env.OBSERVER_MAIL_INSTANCE,control=env.OBSERVER_MAIL_CONTROL_SECRET;
 if(typeof key!=='string'||!/^re_[a-z0-9_-]{8,197}$/i.test(key)||!secret(instance)||!secret(control)||[env.CRON_SECRET,env.OBSERVER_REPORT_SECRET,control,instance].includes(key)||[env.CRON_SECRET,env.OBSERVER_REPORT_SECRET,control].includes(instance)||[env.CRON_SECRET,env.OBSERVER_REPORT_SECRET].includes(control))throw Error('Invalid mail access');
 const from=mailAddress(env.OBSERVER_MAIL_FROM),to=mailAddress(env.OBSERVER_MAIL_TO),dailyLimit=Number(env.OBSERVER_MAIL_DAILY_LIMIT??10),details=env.OBSERVER_MAIL_DETAILS??'0',enabled=env.OBSERVER_MAIL_ENABLED??'0';
 if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>50||!['0','1'].includes(details)||!['0','1'].includes(enabled))throw Error('Invalid mail policy');
 const binding=hash(JSON.stringify([monitor.hash,from,to,details,dailyLimit,hash(key),hash(instance)]));
 return {key,instance,from,to,dailyLimit,details:details==='1',enabled:enabled==='1'&&env.OBSERVER_ENABLED==='1',binding};
}
function freshState(cfg,now){return {version:1,binding:cfg.binding,epoch:randomUUID(),revision:randomUUID(),active:false,confirmedTest:null,receiptAt:null,mutedUntil:null,lease:null,items:[],usage:{day:new Date(now).toISOString().slice(0,10),attempts:0}}}
export function validateMailState(state){
 if(!exact(state,['version','binding','epoch','revision','active','confirmedTest','receiptAt','mutedUntil','lease','items','usage'])||state.version!==1||!digest(state.binding)||!uuid(state.epoch)||!uuid(state.revision)||typeof state.active!=='boolean'||state.confirmedTest!==null&&!uuid(state.confirmedTest)||!nullableTime(state.receiptAt)||!nullableTime(state.mutedUntil)||!Array.isArray(state.items)||state.items.length>128||!exact(state.usage,['day','attempts'])||!/^\d{4}-\d{2}-\d{2}$/.test(state.usage.day)||!Number.isInteger(state.usage.attempts)||state.usage.attempts<0||state.usage.attempts>50)throw Error('Invalid mail state');
 if(state.lease!==null&&(!exact(state.lease,['id','expiresAt'])||!uuid(state.lease.id)||!time(state.lease.expiresAt)))throw Error('Invalid mail lease');
 const ids=new Set();
 for(const r of state.items){
  if(!exact(r,['id','binding','epoch','eventId','incidentId','targetId','kind','eventAt','createdAt','expiresAt','status','attempts','mayHaveSent','firstAttemptAt','nextAttemptAt','acceptedAt','providerId','sealed','payloadHash','receiptHash','error'])||!uuid(r.id)||ids.has(r.id)||!digest(r.binding)||!uuid(r.epoch)||!['test','issue','recovered'].includes(r.kind)||!states.has(r.status)||!time(r.eventAt)||!time(r.createdAt)||r.expiresAt!==r.createdAt+WINDOW||!time(r.nextAttemptAt)||!Number.isInteger(r.attempts)||r.attempts<0||r.attempts>3||typeof r.mayHaveSent!=='boolean'||r.mayHaveSent&&r.attempts===0||r.status==='accepted'&&!r.mayHaveSent||!nullableTime(r.firstAttemptAt)||!nullableTime(r.acceptedAt)||r.providerId!==null&&!uuid(r.providerId)||!digest(r.payloadHash)||r.receiptHash!==null&&!digest(r.receiptHash)||typeof r.sealed!=='string'||r.sealed.length>12000||!/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(r.sealed)||!errors.has(r.error))throw Error('Invalid mail item');
  if(r.kind==='test'?(r.eventId!==null||r.incidentId!==null||r.targetId!==null||r.receiptHash===null):(!uuid(r.eventId)||!uuid(r.incidentId)||typeof r.targetId!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(r.targetId)||r.receiptHash!==null))throw Error('Invalid mail event');
  if(r.status==='accepted'?(r.acceptedAt===null||r.providerId===null):r.acceptedAt!==null||r.providerId!==null)throw Error('Invalid mail acknowledgement');
  if(r.attempts===0?r.firstAttemptAt!==null:r.firstAttemptAt===null)throw Error('Invalid mail attempt');
  if(r.eventAt>r.createdAt||r.nextAttemptAt<r.createdAt||r.firstAttemptAt!==null&&(r.firstAttemptAt<r.createdAt||r.firstAttemptAt>=r.expiresAt)||r.acceptedAt!==null&&(r.attempts===0||r.acceptedAt<r.firstAttemptAt)||['planned','queued'].includes(r.status)&&r.attempts!==0||['sending','accepted','retryable','uncertain'].includes(r.status)&&r.attempts===0)throw Error('Invalid mail chronology');
  ids.add(r.id);
 }
 if(state.confirmedTest!==null&&!state.items.some(r=>r.id===state.confirmedTest&&r.kind==='test'&&r.status==='accepted'&&r.binding===state.binding&&r.epoch===state.epoch)||state.active&&state.confirmedTest===null||state.confirmedTest===null&&state.receiptAt!==null||state.confirmedTest!==null&&state.receiptAt===null||Buffer.byteLength(JSON.stringify(state))>65536)throw Error('Invalid mail approval');
 return state;
}
function seal(cfg,row,body){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(cfg.instance).digest(),iv);cipher.setAAD(Buffer.from(row.id+':'+row.binding+':'+row.epoch));
 const data=Buffer.concat([cipher.update(body,'utf8'),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
function payload(cfg,row){
 const [,iv,tag,data]=row.sealed.split('.'),decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(cfg.instance).digest(),Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));decipher.setAAD(Buffer.from(row.id+':'+row.binding+':'+row.epoch));
 const text=Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');const body=mailBody(text);
 if(hash(text)!==row.payloadHash||body.from!==cfg.from||body.to[0]!==cfg.to||text.includes(cfg.key)||text.includes(cfg.instance))throw Error('Mail payload binding changed');return text;
}
function row(cfg,state,{kind,event=null,text,code=null},now){
 const id=randomUUID(),r={id,binding:cfg.binding,epoch:state.epoch,eventId:event?.id??null,incidentId:event?.incidentId??null,targetId:event?.targetId??null,kind,eventAt:event?.at??now,createdAt:now,expiresAt:now+WINDOW,status:kind==='test'?'planned':'queued',attempts:0,mayHaveSent:false,firstAttemptAt:null,nextAttemptAt:now,acceptedAt:null,providerId:null,sealed:'',payloadHash:'',receiptHash:code?hash(code):null,error:null};
 const body=JSON.stringify({from:cfg.from,to:[cfg.to],subject:kind==='test'?'ConectadOS · prueba de avisos externos':kind==='issue'?'ConectadOS · comprobación para revisar':'ConectadOS · respuesta HTTPS restablecida',text});mailBody(body);r.payloadHash=hash(body);r.sealed=seal(cfg,r,body);return r;
}
async function load(store,cfg,now){const loaded=await store.read();return {etag:loaded?.etag??null,state:loaded?structuredClone(validateMailState(loaded.value)):freshState(cfg,now)}}
async function save(store,etag,state){state.revision=randomUUID();validateMailState(state);if(!await store.compareAndSet(etag,state))throw Error('Mail state changed');return state}
function currentEpoch(state,cfg){if(state.binding!==cfg.binding)throw Error('Mail configuration requires review')}
function revision(state,value){if(state.revision!==value)throw Error('Mail revision changed')}
function cancel(row){if(['queued','planned','retryable','sending','uncertain'].includes(row.status)){row.status=row.attempts?'uncertain':'cancelled';row.error='superseded'}}
function expirePending(row,now){
 if(!['planned','queued','retryable','uncertain','sending'].includes(row.status)||row.error==='superseded')return;
 if(row.expiresAt<=now||row.firstAttemptAt!==null&&now-row.firstAttemptAt>=WINDOW){row.status=row.attempts?'uncertain':'failed';row.error='expired'}
 else if(row.attempts>=3&&['sending','retryable'].includes(row.status)){row.status='uncertain';row.error='unconfirmed'}
}
function freshMonitor(value,config,now){validateMonitor(value,config);return value.completedAt!==null&&value.completedAt<=now&&now-value.completedAt<=config.intervalSeconds*2000+30000}
function currentEvent(row,monitor){const t=monitor.targets.find(t=>t.id===row.targetId),latest=monitor.events.findLast(e=>e.targetId===row.targetId);return row.kind==='issue'?t?.status==='issue'&&t.incidentId===row.incidentId:t?.status==='responding'&&t.last?.kind==='responding'&&latest?.kind==='recovered'&&latest.id===row.eventId}
export async function prepareMail(store,cfg,{now=Date.now(),revision:expected,consent=false}={}){
 if(!cfg||consent!==true)throw Error('Mail review required');const loaded=await load(store,cfg,now),s=loaded.state;
 if(loaded.etag!==null)revision(s,expected);
 if(s.binding!==cfg.binding){s.items.forEach(cancel);s.binding=cfg.binding;s.epoch=randomUUID();s.active=false;s.confirmedTest=null;s.receiptAt=null;s.lease=null;s.mutedUntil=null}
 return save(store,loaded.etag,s);
}
export async function planMailTest(store,cfg,{now=Date.now(),revision:expected,consent=false}={}){
 if(!cfg||consent!==true)throw Error('Mail review required');const loaded=await load(store,cfg,now),s=loaded.state;currentEpoch(s,cfg);revision(s,expected);
 if(s.items.filter(r=>!terminal.has(r.status)).length>=32||s.items.length>=128)throw Error('Mail queue limit');
 const code=randomBytes(18).toString('base64url'),text='Esta es una prueba solicitada del observador externo de ConectadOS. No contiene datos de infraestructura ni credenciales.\n\nConfirma la recepción con este código en la configuración:\n'+code+'\n\nUna aceptación de Resend no confirma por sí sola que el correo haya llegado.';
 const item=row(cfg,s,{kind:'test',text,code},now);s.items.push(item);await save(store,loaded.etag,s);return {id:item.id,revision:s.revision,from:cfg.from,to:cfg.to};
}
export async function confirmMailReceipt(store,cfg,{id,code,revision:expected,now=Date.now(),consent=false}={}){
 if(!cfg||consent!==true||typeof code!=='string'||!/^[A-Za-z0-9_-]{24}$/.test(code))throw Error('Receipt confirmation required');
 const loaded=await load(store,cfg,now),s=loaded.state;currentEpoch(s,cfg);revision(s,expected);const r=s.items.find(r=>r.id===id);
 if(!r||r.binding!==cfg.binding||r.epoch!==s.epoch||r.kind!=='test'||r.status!=='accepted'||r.acceptedAt>now||now-r.acceptedAt>DAY||!timingSafeEqual(Buffer.from(hash(code),'hex'),Buffer.from(r.receiptHash,'hex')))throw Error('Receipt not confirmed');
 s.confirmedTest=r.id;s.receiptAt=now;return save(store,loaded.etag,s);
}
export async function setMailPolicy(store,cfg,{revision:expected,active,mutedUntil=null,now=Date.now(),consent=false}={}){
 if(!cfg||consent!==true||typeof active!=='boolean'||mutedUntil!==null&&(!time(mutedUntil)||mutedUntil<=now||mutedUntil>now+7*DAY))throw Error('Mail policy review required');
 const loaded=await load(store,cfg,now),s=loaded.state;currentEpoch(s,cfg);revision(s,expected);
 if(active&&s.confirmedTest===null)throw Error('Confirm test receipt first');s.active=active;s.mutedUntil=mutedUntil;if(!active)s.items.filter(r=>r.kind!=='test').forEach(cancel);return save(store,loaded.etag,s);
}
export function mailReport(state,cfg,{now=Date.now()}={}){
 if(state)validateMailState(state);
 const matching=Boolean(state&&cfg&&state.binding===cfg.binding),observing=matching&&cfg.enabled&&state.active&&state.confirmedTest!==null;
 return {version:1,status:!cfg?'not-configured':!state?'waiting':!matching?'review-required':!observing?'paused':state.mutedUntil>now?'muted':'active',configured:Boolean(cfg),binding:cfg?.binding??null,revision:state?.revision??null,from:cfg?.from??null,to:cfg?.to??null,limit:cfg?.dailyLimit??null,remainingToday:cfg?Math.max(0,cfg.dailyLimit-(state?.usage.day===new Date(now).toISOString().slice(0,10)?state.usage.attempts:0)):null,receiptConfirmed:matching&&state.confirmedTest!==null,receiptAt:matching?state.receiptAt:null,mutedUntil:state?.mutedUntil??null,items:(state?.items??[]).slice(-50).reverse().map(r=>({id:r.id,kind:r.kind,eventAt:r.eventAt,status:r.status,attempts:r.attempts,acceptedAt:r.acceptedAt,currentConfiguration:matching&&r.binding===cfg.binding&&r.epoch===state.epoch})),coverage:'Independent external sender; acceptance is not delivery. One fixed recipient, bounded daily attempts; no VPS access or provider administration.'};
}
export function recoverMailState(value){const state=structuredClone(validateMailState(value));state.active=false;state.confirmedTest=null;state.receiptAt=null;state.lease=null;state.epoch=randomUUID();state.revision=randomUUID();state.items.forEach(cancel);return {state,enabled:false,newInstanceRequired:true}}
export function recoverMailExport(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>66000)throw Error('Invalid mail backup');const value=JSON.parse(text);
 if(!exact(value,['backupVersion','exportedAt','state'])||value.backupVersion!==1||!time(value.exportedAt))throw Error('Invalid mail backup');
 const s=validateMailState(value.state);
 if(s.receiptAt!==null&&s.receiptAt>value.exportedAt||s.items.some(r=>r.createdAt>value.exportedAt||r.eventAt>value.exportedAt||r.firstAttemptAt!==null&&r.firstAttemptAt>value.exportedAt||r.acceptedAt!==null&&r.acceptedAt>value.exportedAt)||s.usage.day>new Date(value.exportedAt).toISOString().slice(0,10))throw Error('Mail backup contains future evidence');
 return {...recoverMailState(s),exportedAt:value.exportedAt};
}

async function dispatch(store,source,cfg,monitorConfig,id,{now=Date.now,send=sendObserverMail,test=false,consent=false,revision:expected}={}){
 const at=now(),loaded=await load(store,cfg,at),s=loaded.state;currentEpoch(s,cfg);
 if(s.lease&&s.lease.expiresAt>at)return {status:'busy'};
 const item=s.items.find(r=>r.id===id&&r.binding===cfg.binding&&r.epoch===s.epoch);
 const approved=test?item?.kind==='test'&&consent===true:Boolean(item&&item.kind!=='test'&&cfg.enabled&&s.active&&s.confirmedTest!==null&&!(s.mutedUntil>at));
 if(!approved)throw Error('Mail dispatch not approved');
 if(item.status==='accepted')return {status:'accepted',cached:true};
 if(test)revision(s,expected);
 if(item.error==='superseded')return {status:item.status};
 if(!['planned','queued','retryable','uncertain','sending'].includes(item.status)||item.nextAttemptAt>at)return {status:'not-due'};
 if(item.error==='expired'||item.expiresAt<=at||item.firstAttemptAt!==null&&at-item.firstAttemptAt>=WINDOW||item.attempts>=3){expirePending(item,at);await save(store,loaded.etag,s);return {status:item.status}}
 const day=new Date(at).toISOString().slice(0,10);if(day<s.usage.day)throw Error('Clock moved backwards');if(day!==s.usage.day)s.usage={day,attempts:0};if(s.usage.attempts>=cfg.dailyLimit)return {status:'quota'};
 const priorMayHaveSent=item.mayHaveSent,lease=randomUUID(),body=payload(cfg,item);s.lease={id:lease,expiresAt:at+90000};item.status='sending';item.mayHaveSent=true;item.attempts++;item.firstAttemptAt??=at;item.nextAttemptAt=at+300000;item.error=null;s.usage.attempts++;await save(store,loaded.etag,s);
 let result;
 try{result=await send(cfg.key,body,'conectados-observer/'+item.id,{beforeDispatch:async()=>{
  if(!test){const monitor=(await source.read())?.value;if(!monitor||!freshMonitor(monitor,monitorConfig,now())||!currentEvent(item,monitor))throw Error('Mail evidence changed')}
  const current=(await store.read())?.value;validateMailState(current);const row=current.items.find(r=>r.id===item.id);
  if(current.binding!==cfg.binding||current.epoch!==s.epoch||current.lease?.id!==lease||current.lease.expiresAt<=now()||row?.status!=='sending'||row.expiresAt<=now()||!test&&(!cfg.enabled||!current.active||current.confirmedTest===null||current.mutedUntil>now()))throw Error('Mail approval changed');
 }})}catch{result={status:'uncertain',code:'unconfirmed'}}
 const latest=await store.read();if(!latest)return {status:'uncertain'};const current=structuredClone(validateMailState(latest.value)),r=current.items.find(r=>r.id===item.id);
 if(current.lease?.id!==lease||!r||!['sending','uncertain'].includes(r.status))return {status:'uncertain'};
 if(result?.status==='not-dispatched')r.mayHaveSent=priorMayHaveSent;
 if(result?.status==='accepted'&&uuid(result.providerId)){r.status='accepted';r.mayHaveSent=true;r.acceptedAt=now();r.providerId=result.providerId;r.error=null}
 else if(r.error==='superseded'){r.status=result?.status==='not-dispatched'?'cancelled':'uncertain'}
 else{r.status=['retryable','uncertain','not-dispatched'].includes(result?.status)?result.status==='not-dispatched'?'retryable':result.status:'failed';r.error=errors.has(result?.code)&&result.code!==null?result.code:'unconfirmed'}
 current.lease=null;await save(store,latest.etag,current);return {status:r.status};
}
export async function dispatchMailTest(store,cfg,{id,revision:expected,consent=false,now=Date.now,send=sendObserverMail}={}){
 if(!cfg||consent!==true||!uuid(id))throw Error('Test dispatch review required');return dispatch(store,null,cfg,null,id,{test:true,consent,now,send,revision:expected});
}
export async function mailTick(store,source,cfg,monitorConfig,{now=Date.now,send=sendObserverMail}={}){
 if(!cfg||!cfg.enabled)return {status:'disabled'};
 const at=now(),loaded=await load(store,cfg,at),s=loaded.state;
 if(s.binding!==cfg.binding)return {status:'review-required'};if(!s.active||s.confirmedTest===null)return {status:'paused'};if(s.mutedUntil>at)return {status:'muted'};if(s.lease&&s.lease.expiresAt>at)return {status:'busy'};
 const monitor=(await source.read())?.value;if(!monitor||!freshMonitor(monitor,monitorConfig,at))return {status:'stale-source'};
 const before=JSON.stringify(s);
 const referenced=new Set(monitor.events.map(e=>e.id)),incidents=new Set(monitor.targets.map(t=>t.incidentId).filter(Boolean));
 s.items=s.items.filter(r=>!terminal.has(r.status)||r.id===s.confirmedTest||referenced.has(r.eventId)||incidents.has(r.incidentId)||at-r.createdAt<30*DAY);
 for(const r of s.items){expirePending(r,at);if(r.kind!=='test'&&!terminal.has(r.status)&&!currentEvent(r,monitor))cancel(r)}
 const events=[...monitor.events];
 // Retention can discard an opening event while its incident remains current.
 // Queue the current observation once per incident; never invent its opening time.
 for(const target of monitor.targets)if(target.status==='issue'&&!events.some(e=>e.kind==='issue'&&e.incidentId===target.incidentId&&e.targetId===target.id)&&!s.items.some(r=>r.kind==='issue'&&r.incidentId===target.incidentId&&r.targetId===target.id&&r.binding===cfg.binding&&r.epoch===s.epoch)){
  const h=hash(monitorConfig.hash+':'+target.id+':'+target.incidentId),id=h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);
  events.push({id,targetId:target.id,kind:'issue',at:target.last.checkedAt,incidentId:target.incidentId});
 }
 for(const event of events){
  if(s.items.some(r=>r.eventId===event.id&&r.binding===cfg.binding&&r.epoch===s.epoch)||!currentEvent({...event, eventId:event.id},monitor))continue;
  if(event.kind==='recovered'&&!s.items.some(r=>r.incidentId===event.incidentId&&r.kind==='issue'&&r.binding===cfg.binding&&r.epoch===s.epoch&&r.mayHaveSent&&['accepted','uncertain','retryable','sending'].includes(r.status)))continue;
  if(s.items.length>=128||s.items.filter(r=>!terminal.has(r.status)).length>=32)break;
  const target=monitor.targets.find(t=>t.id===event.targetId),text=(event.kind==='issue'?'Una comprobación HTTPS externa requiere revisión. Esto no identifica la causa ni confirma que el VPS esté apagado.':'Dos respuestas consecutivas confirman que la comprobación HTTPS volvió a responder. Esto no prueba acceso, transacciones ni estado interno de las bases.')+'\n\nObservación: '+new Date(target.last.checkedAt).toISOString()+'\nEpisodio: '+event.incidentId+(cfg.details?'\nOrigen: '+monitorConfig.targets.find(t=>t.id===event.targetId).url:'');
  s.items.push(row(cfg,s,{kind:event.kind,event,text},at));
 }
 if(JSON.stringify(s)!==before)await save(store,loaded.etag,s);
 const next=s.items.find(r=>r.kind!=='test'&&r.binding===cfg.binding&&r.epoch===s.epoch&&!['superseded','expired'].includes(r.error)&&r.attempts<3&&!['accepted','failed','cancelled'].includes(r.status)&&r.nextAttemptAt<=at);
 return next?dispatch(store,source,cfg,monitorConfig,next.id,{now,send}):{status:'idle'};
}
