import {randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
export const notificationCategories={web:'Sitios web sin respuesta válida',backups:'Copias de seguridad con problemas',certificates:'Certificados próximos a vencer',resources:'Recursos detenidos o degradados',readings:'Consultas al proveedor sin actualizar',renewals:'Renovaciones registradas',collector:'Recolector sin pulso'};
export const notificationProviders=['Coolify','Hostinger','Vercel','Cloudflare','Supabase','HTTPS','Local','Otros'];
export const defaultNotificationPolicy={categories:['web','backups','certificates'],providers:[...notificationProviders],minimumMinutes:10,intervalMinutes:60,repeatHours:24,maxPerDay:3};
function tables(db){db.db.exec(`CREATE TABLE IF NOT EXISTS notification_policy(id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,value TEXT NOT NULL,active_generation TEXT,active_started INTEGER);
 CREATE TABLE IF NOT EXISTS notification_policy_intents(outbox_id TEXT PRIMARY KEY REFERENCES notification_outbox(id) ON DELETE CASCADE,event_key TEXT NOT NULL,category TEXT NOT NULL,policy_revision TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS notification_policy_event ON notification_policy_intents(event_key);`)}
export function notificationPolicy(db){tables(db);const row=db.db.prepare('SELECT * FROM notification_policy WHERE id=1').get();return row?{...JSON.parse(row.value),revision:row.revision,configured:true,activeGeneration:row.active_generation,activeStarted:row.active_started}:{...structuredClone(defaultNotificationPolicy),revision:'initial',configured:false,activeGeneration:null,activeStarted:null}}
export function effectiveNotificationConfig(db){const c=db.db.prepare('SELECT * FROM notification_config WHERE id=1').get(),p=notificationPolicy(db);return {...c,enabled:p.configured?Number(p.activeGeneration===c.generation&&p.activeStarted===c.started&&c.started!==null):c.enabled,policy:p}}
function validate(value){
 const keys=['categories','providers','minimumMinutes','intervalMinutes','repeatHours','maxPerDay'];
 if(!value||Object.keys(value).some(k=>!keys.includes(k)))throw new AppError('Reglas de correo no válidas.');
 for(const [key,allowed] of [['categories',Object.keys(notificationCategories)],['providers',notificationProviders]])if(!Array.isArray(value[key])||value[key].length>allowed.length||new Set(value[key]).size!==value[key].length||value[key].some(v=>!allowed.includes(v)))throw new AppError('Selecciona tipos de aviso y proveedores válidos.');
 for(const [key,min,max] of [['minimumMinutes',0,60],['intervalMinutes',0,1440],['repeatHours',1,168],['maxPerDay',1,100]])if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw new AppError('Revisa los límites de frecuencia del correo.');
 return Object.fromEntries(keys.map(k=>[k,value[k]]));
}
export function configureNotificationPolicy(db,value,{revision='',now=Date.now()}={}){
 const clean=validate(value);tables(db);db.db.exec('BEGIN IMMEDIATE');try{const c=effectiveNotificationConfig(db);if(revision!==c.policy.revision)throw new AppError('Las reglas cambiaron. Recarga antes de guardarlas.',409);
 db.db.prepare('INSERT INTO notification_policy VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value,active_generation=excluded.active_generation,active_started=excluded.active_started').run(randomUUID(),JSON.stringify(clean),c.enabled?c.generation:null,c.enabled?c.started:null);
 // Older releases see a disabled channel, so returning cannot bypass these filters.
 db.db.exec('UPDATE notification_config SET enabled=0 WHERE id=1');
 db.db.prepare("UPDATE notification_outbox SET state=CASE WHEN attempts>0 THEN 'uncertain' ELSE 'cancelled' END,error='Las reglas de correo cambiaron; no se reenviará la cola anterior.' WHERE state='queued' AND kind='warning'").run();db.record('notification_policy_updated');db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function setNotificationActivation(db,enabled,c,now){
 const p=c.policy;if(!p.configured)db.db.prepare('INSERT INTO notification_policy VALUES(1,?,?,NULL,NULL)').run(randomUUID(),JSON.stringify(defaultNotificationPolicy));
 db.db.prepare('UPDATE notification_policy SET active_generation=?,active_started=? WHERE id=1').run(enabled?c.generation:null,enabled?now:null);
 db.db.prepare('UPDATE notification_config SET enabled=0,started=? WHERE id=1').run(enabled?now:null);
}
export function notificationCategory(payload){const id=payload.findingId??'';return id.startsWith('backup:')?'backups':id.startsWith('renewal:')?'renewals':id==='collector'?'collector':/^(stale:|missing:|components-stale:)/.test(id)?'readings':id.startsWith('probe:')?(id.endsWith(':certificate')?'certificates':'web'):'resources'}
export function notificationEligibility(db,c,signal,row,now,{delivery=false}={}){
 const p=c.policy,category=notificationCategory(signal.payload),provider=notificationProviders.includes(signal.payload.provider)?signal.payload.provider:'Otros';
 if(!p.categories.includes(category)||!p.providers.includes(provider)||signal.payload.severity!=='warning')return false;
 const since=db.db.prepare("SELECT MAX(created) at FROM incident_events WHERE incident_id=? AND event IN ('opened','changed')").get(row.id).at;
 if(since===null||now-since<p.minimumMinutes*60000)return false;
 if(delivery){const intent=db.db.prepare('SELECT * FROM notification_policy_intents WHERE outbox_id=?').get(delivery.id);if(!intent||intent.policy_revision!==p.revision||intent.event_key!==signal.key||intent.category!==category)return false}
 const ignore=delivery?delivery.id:'';
 const last=db.db.prepare("SELECT MAX(o.first_attempt) at FROM notification_outbox o LEFT JOIN incidents i ON i.id=o.incident_id LEFT JOIN notification_policy_intents p ON p.outbox_id=o.id WHERE o.kind='warning' AND o.id!=? AND (p.event_key=? OR i.incident_key=?)").get(ignore,signal.key,signal.key).at;
 if(last!==null&&now-last<p.repeatHours*3600000)return false;
 return true;
}
export function recordNotificationIntent(db,id,signal,policy){db.db.prepare('INSERT INTO notification_policy_intents VALUES(?,?,?,?)').run(id,signal.key,notificationCategory(signal.payload),policy.revision)}

export function notificationIntervalReady(db,c,now,id){const at=db.db.prepare("SELECT MAX(first_attempt) at FROM notification_outbox WHERE kind='warning' AND id!=?").get(id).at;return at===null||now-at>=c.policy.intervalMinutes*60000}
