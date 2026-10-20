import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {voiceConfig,voiceKey,voiceTables} from './voice-config.mjs';
import {assertNoAssistantSecrets} from './assistant.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function validateVoiceAudio(value){
 if(typeof value!=='string'||value.length>1280060||value.length%4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new AppError('La grabación supera el límite o no tiene formato válido.',413);
 const b=Buffer.from(value,'base64');
 if(b.toString('base64')!==value||b.length<16044||b.length>960044)throw new AppError('Usa una grabación WAV mono de 0,5 a 30 segundos.');
 const text=(offset,n)=>b.toString('ascii',offset,offset+n);
 if(text(0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||text(8,4)!=='WAVE'||text(12,4)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||text(36,4)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2)throw new AppError('La grabación debe ser WAV PCM de 16 kHz, mono, 16 bits, sin otros bloques.');
 return {bytes:b,seconds:(b.length-44)/32000,digest:digest(b)};
}
function expire(db,now,c){db.db.prepare("UPDATE voice_usage SET state='uncertain',error='La transcripción se interrumpió; consumo sin confirmar.' WHERE state IN ('reserved','dispatched') AND expires<=?").run(now);db.db.prepare("DELETE FROM voice_usage WHERE created<? AND state NOT IN ('reserved','dispatched')").run(now-Math.max(1,c.historyDays)*86400000)}
export function voiceReport(db,{now=Date.now()}={}){const c=voiceConfig(db);expire(db,now,c);const usage=db.db.prepare('SELECT count(*) requests,coalesce(sum(seconds),0) seconds,coalesce(sum(estimated),0) estimated,coalesce(sum(case when seconds>0 and estimated IS NULL then 1 else 0 end),0) unpriced,coalesce(sum(case when estimated IS NOT NULL then 1 else 0 end),0) pricedRows FROM voice_usage WHERE created>?').get(now-86400000);return {config:c,maxSeconds:30,usage:{...usage,windowHours:24,priced:usage.pricedRows>0||c.ratePerMinute!==null,currency:'USD',basis:'Estimación por duración del clip y tarifa introducida; no factura.'},history:c.historyDays?db.db.prepare('SELECT id,model,state,created,seconds,estimated,error FROM voice_usage WHERE created>? ORDER BY created DESC LIMIT 20').all(now-c.historyDays*86400000):[],storage:'Audio y transcripciones nunca se guardan en la base. Comprobantes sin contenido se conservan al menos 24 horas para cuotas y evitar repetir envíos.'}}
const sign=(db,p)=>createHmac('sha256',db.key).update('voice-preview-v1\0'+JSON.stringify(p)).digest('hex');
export function previewVoice(db,{audio}={},now=Date.now()){
 const c=voiceConfig(db);if(!c.hasKey)throw new AppError('Configura primero tu clave propia de OpenAI para transcripción.',409);
 const clip=validateVoiceAudio(audio);try{const p={revision:c.revision,model:c.model,digest:clip.digest,bytes:clip.bytes.length,seconds:clip.seconds,nonce:randomUUID(),expires:now+120000};return {...p,signature:sign(db,p),destination:'OpenAI',estimated:c.ratePerMinute===null?null:clip.seconds*c.ratePerMinute/60,currency:'USD'}}finally{clip.bytes.fill(0)}
}
function verify(db,value,clip,now){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('Prepara la revisión de esta grabación.');
 const {revision,model,digest:sha,bytes,seconds,nonce,expires,signature}=value,p={revision,model,digest:sha,bytes,seconds,nonce,expires};
 if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(db,p))))throw new AppError('La revisión de voz no es válida.',403);
 const c=voiceConfig(db);if(c.revision!==revision||c.model!==model||!c.hasKey||!Number.isSafeInteger(expires)||expires<now||expires>now+120000)throw new AppError('La revisión de voz venció o cambió el acceso.',409);
 if(clip.digest!==sha||clip.bytes.length!==bytes||clip.seconds!==seconds)throw new AppError('La grabación cambió después de revisarla.',409);return p;
}
/** @param {import('./store.mjs').Store} db @param {Record<string,unknown>} options @param {{runner?:Function,signal?:AbortSignal,authorized?:Function,now?:Function}} dependencies */
export async function transcribeVoice(db,{id,preview,audio,consent}={}, {runner,signal,authorized=()=>true,now=Date.now}={}){
 if(consent!==true||typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new AppError('Confirma el envío de esta grabación.');
 const clip=validateVoiceAudio(audio);let reserved=false,dispatched=false;
 try{
 const p=verify(db,preview,clip,now()),c=voiceConfig(db);if(!authorized())throw new AppError('La sesión ya no está activa.',401);
 db.db.exec('BEGIN IMMEDIATE');try{verify(db,preview,clip,now());const report=voiceReport(db,{now:now()});if(!authorized())throw new AppError('La sesión ya no está activa.',401);if(db.db.prepare('SELECT id FROM voice_usage WHERE id=? OR review_hash=?').get(id,sign(db,p)))throw new AppError('La grabación ya fue enviada. No se repetirá.',409);if(db.db.prepare("SELECT id FROM voice_usage WHERE state IN ('reserved','dispatched')").get())throw new AppError('Hay otra transcripción en curso.',409);if(report.usage.requests>=c.dailyRequests||report.usage.seconds+clip.seconds>c.dailySeconds)throw new AppError('Se alcanzó el límite local de voz de las últimas 24 horas.',429);db.db.prepare('INSERT INTO voice_usage VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,sign(db,p),c.revision,c.model,'reserved',now(),now()+45000,clip.seconds,c.ratePerMinute===null?null:clip.seconds*c.ratePerMinute/60,null);db.record('voice_reserved');db.db.exec('COMMIT');reserved=true}catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}
 const beforeDispatch=()=>{db.db.exec('BEGIN IMMEDIATE');try{const row=db.db.prepare('SELECT state,expires FROM voice_usage WHERE id=?').get(id);if(dispatched||signal?.aborted||!authorized()||voiceConfig(db).revision!==c.revision||now()>p.expires||!voiceKey(db)||row?.state!=='reserved'||row.expires<=now())throw new AppError('La transcripción se canceló o cambió el acceso antes del envío.',409);db.db.prepare("UPDATE voice_usage SET state='dispatched' WHERE id=?").run(id);db.db.exec('COMMIT');dispatched=true}catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}};
 const run=runner??(await import('./voice-provider.mjs')).transcribeRecording;
 const result=await run({key:voiceKey(db),model:c.model,bytes:clip.bytes,signal:AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(35000)]),beforeDispatch});
 if(!dispatched||typeof result.text!=='string'||!result.text.trim()||result.text.length>1000)throw new AppError('La transcripción no devolvió una pregunta de hasta 1.000 caracteres.',502);
 assertNoAssistantSecrets(db,result.text);db.db.prepare("UPDATE voice_usage SET state='completed',error=NULL WHERE id=?").run(id);db.record('voice_transcribed');
 if(!authorized())throw new AppError('La sesión caducó durante la transcripción.',401);if(voiceConfig(db).revision!==c.revision)throw new AppError('Cambió el acceso de voz. El consumo anterior se conservó.',409);
 return {text:result.text.trim(),model:c.model,provider:'OpenAI',seconds:clip.seconds,reviewRequired:true};
 }catch(e){if(reserved){const row=db.db.prepare('SELECT state,estimated FROM voice_usage WHERE id=?').get(id);if(row&&['reserved','dispatched'].includes(row.state))db.db.prepare('UPDATE voice_usage SET state=?,seconds=?,estimated=?,error=? WHERE id=?').run(dispatched?'uncertain':'not-sent',dispatched?clip.seconds:0,dispatched?row.estimated:null,dispatched?'Transcripción interrumpida o rechazada; consumo sin confirmar.':'No se envió al proveedor.',id);db.record('voice_failed')}throw e instanceof AppError?e:new AppError('No se completó la transcripción. Revisa acceso, modelo y cuota. Si se envió, puede existir consumo; no se reintenta.',502)}finally{clip.bytes.fill(0)}
}
