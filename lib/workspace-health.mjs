import {declaredState,observationStale,serviceDetailStale,applicationLifecycle} from './observations.mjs';
export const healthLabels={healthy:'Sin advertencias reportadas',warning:'Requiere revisión',unknown:'Sin verificar',prepared:'Preparada · sin desplegar'};
const colors={cyan:'#0891b2',blue:'#2563eb',amber:'#d97706',coral:'#e85b61',mint:'#059669'};
const palette=Object.values(colors);
const tint=id=>palette[[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%palette.length];
/** @param {import('./infrastructure-types').CoolifyState} data @param {import('./infrastructure-types').TopologyNode} node @param {number} now */
export function nodeHealth(data,node,now=Date.now()){
 const connection=node.provider==='Coolify'?data.connection:data.integrations?.find(c=>c.provider===node.provider);
 if(node.stale||observationStale(connection,now)||!node.checkedAt)return 'unknown';
 if(node.kind==='resource'&&!connection.snapshot.resources.some(r=>r.id===node.id))return 'unknown';
 if(node.provider==='Coolify'&&node.kind==='resource'&&applicationLifecycle(connection.snapshot.resources.find(r=>r.id===node.id),connection.snapshot,now))return 'prepared';
 if(node.kind==='component'&&serviceDetailStale(data.connection?.snapshot?.serviceDetails?.find(d=>d.serviceId===node.parentId),now))return 'unknown';
 if(node.kind==='component'&&!data.connection?.snapshot?.serviceDetails?.some(d=>d.serviceId===node.parentId&&d.components.some(c=>c.id===node.id)))return 'unknown';
 const state=declaredState(node.status).key;
 return state==='stopped'||state==='warning'?'warning':state==='healthy'?'healthy':'unknown';
}
/** @param {import('./infrastructure-types').CoolifyState} data @param {number} now */
export function healthItems(data,now=Date.now()){
 const nodes=data.topology?.nodes??[],byRef=new Map(nodes.map(n=>[n.ref,n]));
 const excluded=new Set();for(const d of data.connection?.snapshot?.serviceDetails??[])for(const c of d.components)if(c.excludedFromStatus)excluded.add(d.serviceId+':'+c.id);
 const active=(data.incidents?.items??[]).filter(i=>['open','acknowledged'].includes(i.state));
 const matchingAlerts=members=>active.filter(i=>members.some(n=>i.payload.provider===n.provider&&(i.payload.resourceId!==null&&(i.payload.resourceId===n.id||i.payload.resourceId===n.parentId)||i.payload.findingId==='backup:'+n.ref)));
 /** @param {string} id @param {string} name @param {import('./infrastructure-types').TopologyNode[]} members @param {string|null} projectId @param {string|null} ref @param {string} color */
 const summarize=(id,name,members,projectId=null,ref=null,color=tint(id))=>{
  const evaluated=members.filter(n=>n.kind!=='dns'&&!excluded.has(n.parentId+':'+n.id)),states=evaluated.map(n=>nodeHealth(data,n,now)),alerts=matchingAlerts(members);
  const warning=states.includes('warning')||alerts.some(i=>i.payload.severity==='warning');
  const state=warning?'warning':!states.length||states.includes('unknown')?'unknown':states.includes('prepared')?'prepared':'healthy';
  const mixed=state==='prepared'&&evaluated.some((n,i)=>n.type==='application'&&states[i]==='healthy');
  return {id,name,projectId,ref,color,state,label:mixed?'Incluye aplicaciones sin desplegar':healthLabels[state],members,alerts,providers:[...new Set(members.map(n=>n.provider))],checkedAt:evaluated.length&&evaluated.every(n=>n.checkedAt)?Math.min(...evaluated.map(n=>n.checkedAt)):null};
 };
 const projects=(data.organization?.projects??[]).map(p=>{
  const assignments=(data.organization?.assignments??[]).filter(a=>a.projectId===p.id),coherent=data.organization?.connectionRevision===data.topology?.revision;
  const refs=new Set(assignments.filter(a=>coherent&&!a.missing&&byRef.has(a.ref)).map(a=>a.ref));
  // Only observed containment expands local grouping, never a name or a DNS guess.
  for(let changed=true;changed;){changed=false;for(const e of data.topology?.edges??[])if(e.kind==='contained-in'&&e.origin==='observed'&&!e.missing&&refs.has(e.toRef)&&!refs.has(e.fromRef)&&byRef.has(e.fromRef)){refs.add(e.fromRef);changed=true}}
  const result=summarize(p.id,p.name,[...refs].map(r=>byRef.get(r)),p.id,null,colors[p.color]??tint(p.id));
  if(result.state==='healthy'&&assignments.some(a=>a.missing||a.stale)){result.state='unknown';result.label=healthLabels.unknown}
  return result;
 });
 const resources=nodes.filter(n=>n.kind==='resource').map(n=>summarize(n.ref,n.name,[n,...nodes.filter(c=>c.kind==='component'&&c.provider===n.provider&&c.parentId===n.id)],null,n.ref));
 return {projects,resources};
}
/** Only an observed provider job in progress is presented as an action in progress. */
export function actionLabel(request,now=Date.now()){
 if(request?.observation?.job?.state==='in_progress')return request.observation.job.checkedAt&&now-request.observation.job.checkedAt<=300000&&request.observation.job.checkedAt<=now?'Acción en curso en Coolify':'Estado de la acción pendiente de actualizar';
 if(request?.observation?.job?.state==='finished')return 'Trabajo finalizado · falta revisión';
 if(['failed','cancelled-by-user'].includes(request?.observation?.job?.state))return 'La acción requiere revisión';
 return ({planned:'Plan preparado · espera aprobación',checking:'Comprobando el plan',dispatched:'Solicitud enviada · sin resultado',queued:'Aceptada · resultado pendiente',uncertain:'Resultado sin confirmar',reviewed:'Revisión registrada'})[request?.state]??'Sin acción iniciada';
}
