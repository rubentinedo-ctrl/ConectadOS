import {randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
const currencies=new Set(Intl.supportedValuesOf('currency'));
const providers=new Set(['Coolify','Cloudflare','Vercel','Supabase','Hostinger','Google Drive','Resend','Otro']);
const periods=new Set([0,1,3,6,12,24,36]);
const kinds=new Set(['invoice','contract','estimate']);
const modes=new Set(['automatic','manual','unknown']);
const limit=500,day=86400000;
function tables(db){db.db.exec(`CREATE TABLE IF NOT EXISTS billing_entries(id TEXT PRIMARY KEY,value TEXT NOT NULL,revision TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,updated INTEGER NOT NULL);`)}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim())throw new AppError('Revisa los textos de facturación. No guardes claves ni datos de pago.');return value.trim().normalize('NFC')}
function identifier(v){if(typeof v!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(v))throw new AppError('Identificador de gasto no válido.');return v}
export function billingDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'2000-01-01'||v>'2199-12-31')throw new AppError('Usa una fecha válida entre 2000 y 2199.');const at=Date.parse(v+'T00:00:00Z');if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==v)throw new AppError('La fecha no existe.');return at}
export function billingAmount(value){if(typeof value!=='string'||! /^(0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value))throw new AppError('Importe no válido. Usa punto decimal, hasta seis decimales y menos de mil millones.');const [whole,decimal='']=value.split('.');const micros=BigInt(whole)*1000000n+BigInt(decimal.padEnd(6,'0'));return {micros,amount:formatMicros(micros)}}
function formatMicros(value){const whole=value/1000000n,decimal=(value%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return whole.toString()+(decimal?'.'+decimal:'')}
function validate(db,input,old,now){
 const {label,provider,currency,amount,periodMonths,kind,source,observedDate,renewalDate='',renewalMode='unknown',projectId=null}=input;
 if(!providers.has(provider)||!(currencies.has(currency)||!amount&&!currency)||!periods.has(periodMonths)||!kinds.has(kind)||!modes.has(renewalMode))throw new AppError('Proveedor, moneda, intervalo o tipo de evidencia no válido.');
 const observed=billingDate(observedDate);if(observed>Math.floor(now/day)*day)throw new AppError('La revisión no puede tener una fecha futura.');
 if(renewalDate)billingDate(renewalDate);if(periodMonths===0&&(renewalDate||renewalMode!=='unknown'))throw new AppError('Un gasto único no tiene renovación recurrente.');
 if(projectId!==null){identifier(projectId);if(!db.db.prepare('SELECT id FROM inventory_projects WHERE id=?').get(projectId)&&old?.projectId!==projectId)throw new AppError('Proyecto local no disponible.',404)}
 return {label:text(label,100,true),provider,currency:currency||null,amount:amount===null||amount===''?null:billingAmount(amount).amount,periodMonths,kind,source:text(source,240,true),observedDate,renewalDate:renewalDate||null,renewalMode,projectId};
}
export function saveBillingEntry(db,input,{now=Date.now()}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Registro de gasto no válido.');
 tables(db);const id=identifier(input.id),revision=text(input.revision??'',36);db.db.exec('BEGIN IMMEDIATE');try{
 const old=db.db.prepare('SELECT * FROM billing_entries WHERE id=?').get(id),oldValue=old?JSON.parse(old.value):null,value=validate(db,input,oldValue,now),encoded=JSON.stringify(value);
 if(old){if(old.archived)throw new AppError('El gasto está archivado. Recupéralo antes de editarlo.',409);if(old.revision!==revision){if(!revision&&old.value===encoded){db.db.exec('COMMIT');return id}throw new AppError('El gasto cambió. Revisa la versión actual antes de guardar.',409)}}else if(revision)throw new AppError('Gasto no disponible.',404);
 if(!old&&db.db.prepare('SELECT count(*) n FROM billing_entries').get().n>=limit)throw new AppError('Esta instalación admite 500 gastos, incluidos los archivados.',409);
 if(!old||old.value!==encoded){db.db.prepare('INSERT INTO billing_entries VALUES(?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated=excluded.updated').run(id,encoded,randomUUID(),old?.created??now,now);db.record(old?'billing_entry_changed':'billing_entry_created')}
 db.db.exec('COMMIT');return id;
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function archiveBillingEntry(db,{id,revision,archived},{now=Date.now()}={}){
 tables(db);identifier(id);if(typeof archived!=='boolean'||typeof revision!=='string')throw new AppError('Archivo de gasto no válido.');db.db.exec('BEGIN IMMEDIATE');try{
 const old=db.db.prepare('SELECT * FROM billing_entries WHERE id=?').get(id);if(!old)throw new AppError('Gasto no disponible.',404);if(old.revision!==revision)throw new AppError('El gasto cambió. Vuelve a revisarlo.',409);
 if(Boolean(old.archived)!==archived){db.db.prepare('UPDATE billing_entries SET archived=?,revision=?,updated=? WHERE id=?').run(Number(archived),randomUUID(),now,id);db.record(archived?'billing_entry_archived':'billing_entry_restored')}
 db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function billingReport(db,{now=Date.now()}={}){
 tables(db);db.db.exec('SAVEPOINT billing_read');try{
 const projectNames=new Map(db.db.prepare('SELECT id,name FROM inventory_projects').all().map(p=>[p.id,p.name]));
 const items=db.db.prepare('SELECT * FROM billing_entries ORDER BY updated DESC,id').all().map(row=>{const value=JSON.parse(row.value),renewalAt=value.renewalDate?billingDate(value.renewalDate):null;return {id:row.id,...value,revision:row.revision,archived:Boolean(row.archived),createdAt:row.created,updatedAt:row.updated,projectName:value.projectId?projectNames.get(value.projectId)??null:null,projectMissing:Boolean(value.projectId&&!projectNames.has(value.projectId)),stale:now-billingDate(value.observedDate)>=90*day,daysToRenewal:renewalAt===null?null:Math.floor(renewalAt/day)-Math.floor(now/day)}});
 const groups=new Map();for(const item of items){if(item.archived||!item.periodMonths||item.amount===null)continue;const key=item.currency;let g=groups.get(key);if(!g){g={currency:key,documented:0n,estimated:0n,count:0,documentedCount:0,estimatedCount:0,staleCount:0};groups.set(key,g)}const monthly=billingAmount(item.amount).micros*72n/BigInt(item.periodMonths);g[item.kind==='estimate'?'estimated':'documented']+=monthly;g[item.kind==='estimate'?'estimatedCount':'documentedCount']++;g.count++;if(item.stale)g.staleCount++}
 const totals=[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({currency:g.currency,documentedMonthly:formatMicros((g.documented+36n)/72n),estimatedMonthly:formatMicros((g.estimated+36n)/72n),recurringCount:g.count,documentedCount:g.documentedCount,estimatedCount:g.estimatedCount,staleCount:g.staleCount}));
 const active=items.filter(i=>!i.archived),report={items,totals,activeCount:active.length,unknownAmountCount:active.filter(i=>i.amount===null).length,archivedCount:items.length-active.length,upcomingCount:active.filter(i=>i.daysToRenewal!==null&&i.daysToRenewal>=0&&i.daysToRenewal<=30).length,pastDueCount:active.filter(i=>i.daysToRenewal!==null&&i.daysToRenewal<0).length,unknownRenewalCount:active.filter(i=>i.periodMonths>0&&i.daysToRenewal===null).length,limit,checkedAt:now,coverage:'manual-register',projects:[...projectNames].map(([id,name])=>({id,name}))};
 db.db.exec('RELEASE billing_read');return report;
 }catch(e){db.db.exec('ROLLBACK TO billing_read; RELEASE billing_read');throw e}
}
