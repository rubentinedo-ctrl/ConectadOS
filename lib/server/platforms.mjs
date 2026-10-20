import {randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
const categories=['email','crm','automation','ai','storage','payments','other'],limit=200;
const tables=db=>db.db.exec('CREATE TABLE IF NOT EXISTS platform_entries(id TEXT PRIMARY KEY,value TEXT NOT NULL,revision TEXT NOT NULL,archived INTEGER NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL)');
const identifier=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
function text(v,max,required=false){if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v)||required&&!v.trim()||/(?:sk-|re_)[a-z0-9_-]{20,}|eyJ[a-z0-9_-]{20,}|Bearer\s+\S+/i.test(v))throw new AppError('Revisa el texto. Esta ficha no admite claves ni credenciales.');return v.trim()}
function panel(value){value=text(value,300);if(!value)return '';let u;try{u=new URL(value)}catch{throw new AppError('Usa una dirección HTTPS válida para el panel.')}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new AppError('El enlace debe ser HTTPS, sin credenciales, parámetros ni fragmentos.');return u.href}
export function platformsReport(db,{now=Date.now()}={}){tables(db);return {items:db.db.prepare('SELECT * FROM platform_entries ORDER BY updated DESC,id').all().map(r=>({id:r.id,...JSON.parse(r.value),revision:r.revision,archived:Boolean(r.archived),createdAt:r.created,updatedAt:r.updated})),limit,checkedAt:now,scope:'manual-register'}}
export function savePlatform(db,input,{now=Date.now()}={}){
 tables(db);if(!input||typeof input!=='object')throw new AppError('Revisa la ficha de la plataforma.');
 const {id='',revision='',name,category='other',accountUrl='',description='',projectId=null}=input;
 const value={name:text(name,80,true),category,accountUrl:panel(accountUrl),description:text(description,240),projectId};
 if(!categories.includes(category)||typeof id!=='string'||id&&!identifier(id)||typeof revision!=='string'||projectId!==null&&!identifier(projectId))throw new AppError('Plataforma o proyecto no válidos.');
 db.db.exec('BEGIN IMMEDIATE');try{
  if(projectId&&!db.db.prepare('SELECT id FROM inventory_projects WHERE id=?').get(projectId))throw new AppError('El proyecto seleccionado ya no existe.',409);
  const old=id?db.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(id):null;
  if(id&&!old)throw new AppError('Ficha no disponible.',404);if(old&&old.revision!==revision)throw new AppError('La ficha cambió. Vuelve a leerla antes de guardar.',409);
  const encoded=JSON.stringify(value),rows=db.db.prepare('SELECT * FROM platform_entries').all(),duplicate=rows.find(r=>r.id!==id&&JSON.parse(r.value).name.toLocaleLowerCase('es')===value.name.toLocaleLowerCase('es'));
  if(duplicate){if(!id&&duplicate.value===encoded&&!duplicate.archived){db.db.exec('COMMIT');return duplicate.id}throw new AppError('Ya existe una ficha con ese nombre.',409)}
  if(!old&&rows.length>=limit)throw new AppError('Se alcanzó el límite de fichas de plataformas.',409);
  const result=old?.id??randomUUID();if(!old||old.value!==encoded){db.db.prepare('INSERT INTO platform_entries VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision,updated=excluded.updated').run(result,encoded,randomUUID(),old?.archived??0,old?.created??now,now);db.record(old?'platform_updated':'platform_registered')}
  db.db.exec('COMMIT');return result;
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function archivePlatform(db,{id,revision,archived},{now=Date.now()}={}){
 tables(db);if(!identifier(id)||typeof revision!=='string'||typeof archived!=='boolean')throw new AppError('Revisa la ficha antes de archivarla.');
 db.db.exec('BEGIN IMMEDIATE');try{const old=db.db.prepare('SELECT * FROM platform_entries WHERE id=?').get(id);if(!old)throw new AppError('Ficha no disponible.',404);if(old.revision!==revision)throw new AppError('La ficha cambió. Vuelve a revisarla.',409);if(Boolean(old.archived)!==archived){db.db.prepare('UPDATE platform_entries SET archived=?,revision=?,updated=? WHERE id=?').run(Number(archived),randomUUID(),now,id);db.record(archived?'platform_archived':'platform_restored')}db.db.exec('COMMIT')}catch(e){db.db.exec('ROLLBACK');throw e}
}
