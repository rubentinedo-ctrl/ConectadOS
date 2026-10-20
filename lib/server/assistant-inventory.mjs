import {createHash} from 'node:crypto';
import {inventoryCatalog} from './topology.mjs';
import {declaredState} from '../observations.mjs';
const providers=['Coolify','Cloudflare','Vercel','Hostinger','Supabase'];
const types=new Set(['application','service','database','project','server','vps','zone','A','AAAA','CNAME','TXT','MX','NS','SRV','CAA','PTR','SOA','HTTPS','SVCB','DNSKEY','DS','NAPTR','TLSA','standalone-postgresql','standalone-mysql','standalone-mariadb','standalone-mongodb','standalone-redis','standalone-clickhouse','standalone-keydb','standalone-dragonfly']);
function catalog(db,now){return inventoryCatalog(db,now).nodes.sort((a,b)=>a.ref.localeCompare(b.ref))}
export function assistantInventoryBinding(db,now=Date.now()){
 return createHash('sha256').update(JSON.stringify(catalog(db,now).map(n=>[n.ref,n.name,n.kind,n.type]))).digest('hex');
}
export function mentionedInventoryProviders(question=''){
 return providers.filter(p=>new RegExp('\\b'+p+'\\b','i').test(question));
}
// Resource names stay in the authenticated reply, outside the model's prompt.
// Aliases are stable across provider/topic changes while the catalog identity stays unchanged.
export function withAssistantInventory(db,result,{question='',inventoryQuestion=question,now=Date.now()}={}){
 if(!question||['billing','backups'].includes(result.context.scope))return result;
 const explicit=mentionedInventoryProviders(inventoryQuestion),focused=['project','resource'].includes(result.context.scope);
 if(focused&&!explicit.length)return result;
 const nodes=catalog(db,now),aliases=new Map(nodes.map((n,i)=>[n.ref,'R'+(1001+i)]));
 const q=question.normalize('NFC').toLocaleLowerCase('es');
 const named=new Set(nodes.filter(n=>{const name=n.name.normalize('NFC').toLocaleLowerCase('es');return name.length>=3&&q.includes(name)}).map(n=>n.ref));
 const chosen=explicit.length?explicit:providers.includes(result.context.scope)?[result.context.scope]:providers;
 const candidates=nodes.filter(n=>chosen.includes(n.provider)).sort((a,b)=>Number(named.has(b.ref))-Number(named.has(a.ref))||Number(a.kind!=='resource')-Number(b.kind!=='resource')||a.ref.localeCompare(b.ref));
 const context=structuredClone(result.context);
 // A provider question does not need unrelated aggregate sources. Preserve focused evidence.
 if(!focused)context.sources=context.sources.filter(s=>s.kind!=='components'&&(!explicit.length||chosen.includes(s.provider)));
 context.sources.forEach((s,i)=>{s.id='S'+(i+1)});
 context.inventoryBinding=assistantInventoryBinding(db,now);
 context.limits+=' Los nombres de los alias se presentan localmente. El detalle disponible está en resource-catalog; returned/omitted indican cobertura. Un componente no equivale a una aplicación independiente.';
 const source={id:'S'+(context.sources.length+1),provider:chosen.join(', '),kind:'resource-catalog',checkedAt:now,stale:candidates.some(n=>n.stale),total:candidates.length,returned:0,omitted:candidates.length,columns:['alias','provider','kind','type','state','checkedAt','stale','parentAlias'],resources:[],coverage:'Inventario guardado, sin refrescar proveedores. Fecha y caducidad por fila; DNS es configuración, no disponibilidad. Usa el alias para nombrar cada recurso: la interfaz lo sustituye por el nombre real. No digas que faltan nombres cuando hay alias. Si omitted>0, no presentes la lista como completa; pide precisar proveedor o recurso.'};
 source.questionMatches=candidates.filter(n=>named.has(n.ref)).map(n=>aliases.get(n.ref));
 context.sources.push(source);const included=[];
 for(const n of candidates){
  const parent=nodes.find(p=>p.provider===n.provider&&p.id===n.parentId&&p.kind==='resource');
  const state=n.kind==='dns'?'configured':n.lifecycle?.state==='prepared'&&!n.stale?'prepared':declaredState(n.status).key;
  source.resources.push([aliases.get(n.ref),n.provider,n.kind,types.has(n.type)?n.type:'other',state,n.checkedAt,n.stale,parent?aliases.get(parent.ref):null]);
  source.returned++;source.omitted--;
  if(Buffer.byteLength(JSON.stringify(context))>9800){source.resources.pop();source.returned--;source.omitted++;break}
  included.push(n);
 }
 source.questionMatches=source.questionMatches.filter(a=>included.some(n=>aliases.get(n.ref)===a));
 return {...result,context,labels:[...result.labels,...included.map(n=>({alias:aliases.get(n.ref),name:n.name,provider:n.provider,kind:n.kind}))]};
}
