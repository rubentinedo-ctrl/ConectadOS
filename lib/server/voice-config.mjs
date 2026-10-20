import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {AppError} from './store.mjs';
export function voiceTables(db){db.db.exec(`CREATE TABLE IF NOT EXISTS voice_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL,revision TEXT NOT NULL,sealed TEXT);
 CREATE TABLE IF NOT EXISTS voice_usage(id TEXT PRIMARY KEY,review_hash TEXT UNIQUE NOT NULL,revision TEXT NOT NULL,model TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,seconds REAL NOT NULL,estimated REAL,error TEXT);`)}
const defaults={provider:'OpenAI',model:'gpt-transcribe',dailyRequests:10,dailySeconds:300,ratePerMinute:null,historyDays:7,audioRetention:'after-transcription'};
export function voiceConfig(db){voiceTables(db);const row=db.db.prepare('SELECT * FROM voice_config WHERE id=1').get();return row?{...JSON.parse(row.value),revision:row.revision,hasKey:Boolean(row.sealed)}:{...defaults,revision:'initial',hasKey:false}}
export function sealVoiceKey(key,value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('VOICE:OpenAI'));const encrypted=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv,c.getAuthTag(),encrypted].map(b=>b.toString('base64')).join('.')}
export function voiceKey(db){
 if(!db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='voice_config'").get())return null;
 const row=db.db.prepare('SELECT sealed FROM voice_config WHERE id=1').get();if(!row?.sealed)return null;
 try{const [iv,tag,value]=row.sealed.split('.').map(b=>Buffer.from(b,'base64')),c=createDecipheriv('aes-256-gcm',db.key,iv);c.setAAD(Buffer.from('VOICE:OpenAI'));c.setAuthTag(tag);return Buffer.concat([c.update(value),c.final()]).toString('utf8')}catch{throw new AppError('El acceso de voz no puede descifrarse. Recupera su clave original.',503)}
}
export function configureVoice(db,options){voiceTables(db);db.db.exec('BEGIN IMMEDIATE');try{
 const old=voiceConfig(db),{revision,model,dailyRequests,dailySeconds,ratePerMinute,historyDays,audioRetention,key}=options;
 if(revision!==old.revision)throw new AppError('La configuración de voz cambió. Vuelve a cargarla.',409);
 if(typeof model!=='string'||!model||model.length>120||!/^[a-zA-Z0-9._:-]+$/.test(model)||/^(sk-|AIza|eyJ)/.test(model))throw new AppError('Indica el modelo exacto de transcripción.');
 if(!Number.isSafeInteger(dailyRequests)||dailyRequests<1||dailyRequests>100||!Number.isSafeInteger(dailySeconds)||dailySeconds<30||dailySeconds>3600)throw new AppError('Revisa los límites de voz de las últimas 24 horas.');
 if(ratePerMinute!==null&&(typeof ratePerMinute!=='number'||!Number.isFinite(ratePerMinute)||ratePerMinute<0||ratePerMinute>100))throw new AppError('La tarifa debe ser USD por minuto, o quedar vacía.');
 if(![0,7,30].includes(historyDays)||!['after-transcription','until-clear'].includes(audioRetention))throw new AppError('Elige la conservación de audio e historial.');
 if(key!==undefined&&(typeof key!=='string'||key.length<8||key.length>4096||/\s/.test(key)))throw new AppError('Pega una clave de OpenAI válida, sin espacios.');
 if([voiceKey(db),key,...db.listCredentials().map(c=>db.credential(c.provider))].filter(Boolean).some(s=>model.includes(s)))throw new AppError('El modelo no puede contener una clave.');
 const sealed=key===undefined?db.db.prepare('SELECT sealed FROM voice_config WHERE id=1').get()?.sealed??null:sealVoiceKey(db.key,key);
 db.db.prepare('INSERT INTO voice_config VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,sealed=excluded.sealed').run(JSON.stringify({provider:'OpenAI',model,dailyRequests,dailySeconds,ratePerMinute,historyDays,audioRetention}),randomUUID(),sealed);
 db.record('voice_configured');db.db.exec('COMMIT');return voiceConfig(db);
 }catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}}
export function removeVoiceKey(db,revision){voiceTables(db);db.db.exec('BEGIN IMMEDIATE');try{if(voiceConfig(db).revision!==revision)throw new AppError('La configuración de voz cambió.',409);db.db.prepare('UPDATE voice_config SET sealed=NULL,revision=? WHERE id=1').run(randomUUID());db.record('voice_key_removed');db.db.exec('COMMIT')}catch(e){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw e}}
export function recoverVoice(db){voiceTables(db);voiceKey(db);db.db.prepare("UPDATE voice_usage SET state='uncertain',error='Restauración: resultado anterior sin confirmar.' WHERE state IN ('reserved','dispatched')").run()}
