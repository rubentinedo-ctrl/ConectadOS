import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {inventoryCatalog} from './topology.mjs';
const maxProjects=200,maxAnnotations=5000;
export const projectColors=['cyan','blue','amber','coral','mint'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim())throw new AppError('Revisa los textos y sus límites. No introduzcas credenciales.');return value.trim()};
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
function project(row){return {id:row.id,name:row.name,description:row.description,color:row.color,revision:row.revision,createdAt:row.created,updatedAt:row.updated}}
function connectionRevision(c){return hash([...c.scopes].sort())}
function tagsValue(value){if(!Array.isArray(value)||value.length>10)throw new AppError('Usa como máximo diez etiquetas por recurso.');const tags=value.map(v=>{const t=text(v,24,true).normalize('NFC').toLocaleLowerCase('es');if(t.includes(','))throw new AppError('Cada etiqueta debe ir por separado; no puede contener una coma.');return t});return [...new Set(tags)].sort()}
function updateProject(db,id,now){if(id)db.db.prepare('UPDATE inventory_projects SET revision=?,updated=? WHERE id=?').run(randomUUID(),now,id)}
export function organizationReport(db,{now=Date.now()}={}){
 db.db.exec('SAVEPOINT organization_read');try{
 const c=inventoryCatalog(db,now),projects=db.db.prepare('SELECT * FROM inventory_projects ORDER BY name_key,id').all().map(project),assignments=[];
 for(const row of db.db.prepare('SELECT * FROM inventory_annotations ORDER BY ref').all()){
  if(!c.scopes.has(row.scope))continue;const node=c.byRef.get(row.ref);
  assignments.push({ref:row.ref,projectId:row.project_id,tags:JSON.parse(row.tags),revision:row.revision,updatedAt:row.updated,missing:!node,stale:node?.stale??false});
 }
 const report={connectionRevision:connectionRevision(c),projects,assignments,limits:{projects:maxProjects,annotations:maxAnnotations,tagsPerResource:10},scope:'local-organization'};
 db.db.exec('RELEASE organization_read');return report;
 }catch(e){db.db.exec('ROLLBACK TO organization_read; RELEASE organization_read');throw e}
}
/**
 * @param {import('./store.mjs').Store} db
 * @param {{id?:unknown,revision?:unknown,name:unknown,description?:unknown,color?:unknown}} options
 * @param {{now?:number}} [clock]
 */
export function saveProject(db,{id='',revision='',name,description='',color='cyan'},{now=Date.now()}={}){
 name=text(name,80,true).normalize('NFC');description=text(description,240);if(!projectColors.includes(color)||typeof id!=='string'||typeof revision!=='string'||id&&!uuid(id))throw new AppError('Proyecto o color no válido.');
 const key=name.toLocaleLowerCase('es');db.db.exec('BEGIN IMMEDIATE');try{
  const old=id?db.db.prepare('SELECT * FROM inventory_projects WHERE id=?').get(id):null;
  if(id&&!old)throw new AppError('Proyecto local no disponible.',404);if(old&&old.revision!==revision)throw new AppError('El proyecto cambió. Revisa su versión actual.',409);
  const duplicate=db.db.prepare('SELECT * FROM inventory_projects WHERE name_key=?').get(key);
  if(duplicate&&duplicate.id!==id){if(!id&&duplicate.name===name&&duplicate.description===description&&duplicate.color===color){db.db.exec('COMMIT');return duplicate.id}throw new AppError('Ya existe un proyecto con ese nombre.',409)}
  if(!old&&db.db.prepare('SELECT COUNT(*) n FROM inventory_projects').get().n>=maxProjects)throw new AppError('Se alcanzó el límite de 200 proyectos locales.',409);
  const result=old?.id??randomUUID();
  if(!old||old.name!==name||old.description!==description||old.color!==color){db.db.prepare('INSERT INTO inventory_projects VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_key=excluded.name_key,description=excluded.description,color=excluded.color,revision=excluded.revision,updated=excluded.updated').run(result,name,key,description,color,randomUUID(),old?.created??now,now);db.record(old?'inventory_project_changed':'inventory_project_created')}
  db.db.exec('COMMIT');return result;
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function removeProject(db,id,revision,{now=Date.now()}={}){
 if(!uuid(id)||typeof revision!=='string')throw new AppError('Proyecto local no válido.');db.db.exec('BEGIN IMMEDIATE');try{
  const p=db.db.prepare('SELECT * FROM inventory_projects WHERE id=?').get(id);if(!p)throw new AppError('Proyecto local no disponible.',404);if(p.revision!==revision)throw new AppError('El proyecto o sus asignaciones cambiaron. Revisa antes de retirarlo.',409);
  db.db.prepare('UPDATE inventory_annotations SET project_id=NULL,revision=?,updated=? WHERE project_id=?').run(randomUUID(),now,id);db.db.prepare('DELETE FROM inventory_projects WHERE id=?').run(id);db.record('inventory_project_removed');db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
/**
 * @param {import('./store.mjs').Store} db
 * @param {{ref:unknown,connectionRevision:unknown,revision?:unknown,projectId?:unknown,tags?:unknown}} options
 * @param {{now?:number}} [clock]
 */
export function assignResource(db,{ref,connectionRevision:expected,revision='',projectId=null,tags=[]},{now=Date.now()}={}){
 if(typeof ref!=='string'||!/^[a-f0-9]{64}$/.test(ref)||typeof revision!=='string'||typeof expected!=='string'||projectId!==null&&!uuid(projectId))throw new AppError('Asignación no válida.');tags=tagsValue(tags);
 db.db.exec('BEGIN IMMEDIATE');try{
  const c=inventoryCatalog(db,now);if(expected!==connectionRevision(c))throw new AppError('Las conexiones cambiaron. Revisa el inventario actual.',409);
  const node=c.byRef.get(ref);if(!node)throw new AppError('Recurso no observado en el inventario actual.',409);
  if(projectId&&!db.db.prepare('SELECT id FROM inventory_projects WHERE id=?').get(projectId))throw new AppError('Proyecto local no disponible.',404);
  const old=db.db.prepare('SELECT * FROM inventory_annotations WHERE ref=?').get(ref);
  if(old&&old.project_id===projectId&&old.tags===JSON.stringify(tags)){db.db.exec('COMMIT');return}
  if(old?old.revision!==revision:Boolean(revision))throw new AppError('La organización de este recurso cambió. Vuelve a revisarla.',409);
  if(!old&&db.db.prepare('SELECT COUNT(*) n FROM inventory_annotations').get().n>=maxAnnotations)throw new AppError('Se alcanzó el límite de 5.000 recursos organizados, incluidas conexiones anteriores.',409);
  if(!old||old.project_id!==projectId||old.tags!==JSON.stringify(tags)){
   db.db.prepare('INSERT INTO inventory_annotations VALUES(?,?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET project_id=excluded.project_id,tags=excluded.tags,revision=excluded.revision,updated=excluded.updated').run(ref,node.scope,projectId,JSON.stringify(tags),randomUUID(),now);
   updateProject(db,old?.project_id,now);if(projectId!==old?.project_id)updateProject(db,projectId,now);db.record('inventory_resource_organized');
  }
  db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function removeAssignment(db,{ref,revision,connectionRevision:expected},{now=Date.now()}={}){
 if(typeof ref!=='string'||!/^[a-f0-9]{64}$/.test(ref)||typeof revision!=='string'||typeof expected!=='string')throw new AppError('Asignación no válida.');
 db.db.exec('BEGIN IMMEDIATE');try{
  const c=inventoryCatalog(db,now);if(expected!==connectionRevision(c))throw new AppError('Las conexiones cambiaron. Revisa el inventario actual.',409);
  const row=db.db.prepare('SELECT * FROM inventory_annotations WHERE ref=?').get(ref);if(!row||!c.scopes.has(row.scope))throw new AppError('Asignación no disponible en las conexiones actuales.',404);if(row.revision!==revision)throw new AppError('La asignación cambió. Revisa antes de retirarla.',409);
  db.db.prepare('DELETE FROM inventory_annotations WHERE ref=?').run(ref);updateProject(db,row.project_id,now);db.record('inventory_resource_unorganized');db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
