import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './store.mjs';
import {observationStale,serviceDetailStale,applicationLifecycle} from '../observations.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const providers=new Set(['Coolify','Cloudflare','Vercel','Supabase','Hostinger']);
export const relationKinds=['depends-on','hosted-in','resolves-to','backed-up-in'];
const nodeLimit=10000,edgeLimit=20000,manualLimit=1000;

// References include the authorized connection, not only a provider's resource ID.
// Components and DNS records have distinct identities from their parent resources.
export function inventoryCatalog(db,now=Date.now()){
 const connections=[...(db.coolifyConnection()?[{provider:'Coolify',...db.coolifyConnection()}]:[]),...db.providerConnections()];
 const nodes=[],edges=[],scopes=new Set(),byRef=new Map(),keys=new Set();let omittedNodes=0,omittedEdges=0;
 function node(scope,provider,kind,id,parentId,value){
  const ref=hash([scope,kind,id,parentId??null]);
  if(byRef.has(ref))return byRef.get(ref);
  if(nodes.length>=nodeLimit){omittedNodes++;return null}
  const n={ref,scope,provider,kind,id,parentId:parentId??null,...value};nodes.push(n);byRef.set(ref,n);return n;
 }
 function edge(from,to,kind,evidence,source,checkedAt,stale){
  if(!from||!to)return;
  const id=hash(['observed',from.ref,to.ref,kind]);if(keys.has(id))return;keys.add(id);
  if(edges.length>=edgeLimit){omittedEdges++;return}
  edges.push({id,fromRef:from.ref,toRef:to.ref,kind,origin:'observed',evidence,source,checkedAt,stale,missing:false,note:'',revision:null,createdAt:null,updatedAt:null});
 }
 const domainProjects=new Map(),dnsRecords=[];
 for(const c of connections){
  if(!providers.has(c.provider)||!c.hasToken)continue;
  const scope=hash([c.provider,c.url??c.scope,db.credentialIdentity(c.provider)]);scopes.add(scope);
  const s=c.snapshot;if(!s)continue;const stale=observationStale(c,now),parents=new Map();
  for(const r of s.resources){
   const n=node(scope,c.provider,'resource',r.id,null,{name:r.name,type:r.type,status:r.status,checkedAt:s.checkedAt,source:s.source,stale,lifecycle:!stale&&c.provider==='Coolify'?applicationLifecycle(r,s,now):null});if(n)parents.set(r.id,n);
   if(c.provider==='Vercel'&&n)for(const domain of r.domains??[]){const key=domain.toLowerCase().replace(/\.$/,'');if(!domainProjects.has(key))domainProjects.set(key,[]);domainProjects.get(key).push(n)}
  }
  if(c.provider==='Coolify')for(const d of s.serviceDetails??[]){
   const parent=parents.get(d.serviceId);if(!parent||parent.type!=='service')continue;
   const old=stale||serviceDetailStale(d,now);
   for(const r of d.components){const n=node(scope,c.provider,'component',r.id,d.serviceId,{name:r.name,type:r.type,status:r.status,checkedAt:d.checkedAt,source:d.source,stale:old});edge(n,parent,'contained-in','Componente listado dentro del servicio por Coolify.',d.source,d.checkedAt,old)}
  }
  if(c.provider==='Cloudflare')for(const r of s.records??[]){
   const parent=parents.get(r.zoneId);if(!parent)continue;
   const n=node(scope,c.provider,'dns',r.id,r.zoneId,{name:r.name,type:r.type,status:'dns:configured',checkedAt:s.checkedAt,source:s.source,stale});edge(n,parent,'contained-in','Registro listado dentro de la zona por Cloudflare.',s.source,s.checkedAt,stale);
   if(n)dnsRecords.push({node:n,record:r,source:s.source});
  }
 }
 function matches(n,list,kind,evidence,source){
  const available=Math.max(0,edgeLimit-edges.length),batch=list.slice(0,available);omittedEdges+=list.length-batch.length;
  for(const project of batch)edge(n,project,kind,evidence,[source,project.source].filter((s,i,a)=>a.indexOf(s)===i).join(' + '),Math.min(n.checkedAt,project.checkedAt),n.stale||project.stale);
 }
 for(const {node:n,record:r,source} of dnsRecords){
  matches(n,domainProjects.get(r.name.toLowerCase().replace(/\.$/,''))??[],'domain-match','El nombre DNS coincide exactamente con un dominio declarado por Vercel. No acredita el destino DNS ni disponibilidad.',source);
  if(r.type==='CNAME'&&r.value)matches(n,domainProjects.get(r.value.toLowerCase().replace(/\.$/,''))??[],'resolves-to','El destino CNAME configurado coincide exactamente con un dominio declarado por Vercel. Puede haber proxy; no acredita acceso ni disponibilidad.',source);
 }
 return {nodes,edges,scopes,byRef,omittedNodes,omittedEdges};
}
function scopedRow(row,c){return c.scopes.has(row.from_scope)&&c.scopes.has(row.to_scope)}
export function topologyReport(db,{now=Date.now()}={}){
 db.db.exec('SAVEPOINT topology_read');try{
 const c=inventoryCatalog(db,now),manual=[];
 for(const r of db.db.prepare('SELECT * FROM topology_relations ORDER BY updated DESC,id').all()){
  if(!scopedRow(r,c))continue;
  const from=c.byRef.get(r.from_ref),to=c.byRef.get(r.to_ref);
  manual.push({id:r.id,fromRef:r.from_ref,toRef:r.to_ref,kind:r.kind,origin:'declared',evidence:'Relación declarada localmente por el administrador; no comprobada por el proveedor.',source:'Declaración local',checkedAt:null,stale:Boolean(from?.stale||to?.stale),missing:!from||!to,note:r.note,revision:r.revision,createdAt:r.created,updatedAt:r.updated});
 }
 const report={revision:hash([...c.scopes].sort()),nodes:c.nodes.map(({scope,...n})=>n),edges:[...c.edges,...manual],coverage:{nodeLimit,edgeLimit,manualLimit,omittedNodes:c.omittedNodes,omittedEdges:c.omittedEdges},scope:'local-inventory'};
 db.db.exec('RELEASE topology_read');return report;
 }catch(e){db.db.exec('ROLLBACK TO topology_read; RELEASE topology_read');throw e}
}
export function saveRelation(db,{id='',revision='',fromRef,toRef,kind,note=''},{now=Date.now()}={}){
 if(!relationKinds.includes(kind)||typeof note!=='string'||note.length>240||/[\u0000-\u001f\u007f]/.test(note)||typeof fromRef!=='string'||typeof toRef!=='string'||!/^[a-f0-9]{64}$/.test(fromRef)||!/^[a-f0-9]{64}$/.test(toRef)||fromRef===toRef||typeof id!=='string'||typeof revision!=='string')throw new AppError('Elige dos recursos distintos, un tipo válido y una nota de hasta 240 caracteres.');
 db.db.exec('BEGIN IMMEDIATE');try{
  const c=inventoryCatalog(db,now),from=c.byRef.get(fromRef),to=c.byRef.get(toRef);
  if(!from||!to)throw new AppError('Un recurso o su conexión cambió. Vuelve a elegirlos desde el inventario actual.',409);
  if(from.stale||to.stale)throw new AppError('Actualiza las lecturas de ambos recursos antes de guardar una relación.',409);
  const old=id?db.db.prepare('SELECT * FROM topology_relations WHERE id=?').get(id):null;
  if(id&&(!old||!scopedRow(old,c)))throw new AppError('Relación no disponible en las conexiones actuales.',404);
  if(old&&old.revision!==revision)throw new AppError('La relación cambió. Vuelve a cargarla antes de editar.',409);
  const duplicate=db.db.prepare('SELECT * FROM topology_relations WHERE from_ref=? AND to_ref=? AND kind=?').get(fromRef,toRef,kind);
  if(duplicate&&duplicate.id!==id){if(!id&&duplicate.note===note.trim()){db.db.exec('COMMIT');return duplicate.id}throw new AppError('Esta relación ya existe. Edita la declaración guardada.',409)}
  if(!old&&db.db.prepare('SELECT COUNT(*) n FROM topology_relations').get().n>=manualLimit)throw new AppError('Se alcanzó el límite de 1.000 relaciones guardadas por instalación.',409);
  const key=old?.id??randomUUID();
  if(!old||old.from_ref!==fromRef||old.to_ref!==toRef||old.kind!==kind||old.note!==note.trim()){
   db.db.prepare('INSERT INTO topology_relations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET from_ref=excluded.from_ref,to_ref=excluded.to_ref,from_scope=excluded.from_scope,to_scope=excluded.to_scope,kind=excluded.kind,note=excluded.note,revision=excluded.revision,updated=excluded.updated').run(key,fromRef,toRef,from.scope,to.scope,kind,note.trim(),randomUUID(),old?.created??now,now);db.record(old?'topology_relation_changed':'topology_relation_created');
  }
  db.db.exec('COMMIT');return key;
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
export function removeRelation(db,id,revision){
 if(typeof id!=='string'||id.length>100||typeof revision!=='string'||revision.length>100)throw new AppError('Identificador de relación no válido.');
 db.db.exec('BEGIN IMMEDIATE');try{
  const c=inventoryCatalog(db,Date.now()),r=db.db.prepare('SELECT * FROM topology_relations WHERE id=?').get(id);
  if(!r||!scopedRow(r,c))throw new AppError('Relación no disponible en las conexiones actuales.',404);
  if(r.revision!==revision)throw new AppError('La relación cambió. Revisa su contenido antes de eliminar.',409);
  db.db.prepare('DELETE FROM topology_relations WHERE id=?').run(id);db.record('topology_relation_removed');db.db.exec('COMMIT');
 }catch(e){db.db.exec('ROLLBACK');throw e}
}
