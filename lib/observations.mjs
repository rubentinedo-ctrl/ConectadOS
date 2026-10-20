// Classification requires fresh, identity-bound evidence, never a resource name.
export function applicationLifecycle(resource,snapshot,now=Date.now()){
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(resource?.id??'')||resource?.type!=='application'||!(/^(exited|stopped)(:|$)/.test(resource.status??'')))return null;
 const h=snapshot?.applicationDeployments?.find(h=>h.applicationId===resource.id);
 let source;try{source=new URL('/api/v1/deployments/applications/'+encodeURIComponent(resource.id)+'?skip=0&take=1',snapshot.source).href}catch{return null}
 if(!h||h.error||h.count!==0||h.source!==source||!Number.isSafeInteger(h.checkedAt)||!Number.isSafeInteger(snapshot.checkedAt)||h.checkedAt<snapshot.checkedAt||h.checkedAt>now||now>h.expiresAt||h.expiresAt!==h.checkedAt+300000)return null;
 return {state:'prepared',label:'Preparada · sin desplegar',checkedAt:h.checkedAt,expiresAt:h.expiresAt,source:h.source};
}
export function declaredState(status){
 if(status==='server:running')return {key:'healthy',label:'VPS encendido'};
 if(status==='server:stopped')return {key:'stopped',label:'VPS detenido'};
 if(status==='server:stopping')return {key:'unknown',label:'VPS apagándose'};
 if(status?.startsWith('server:'))return {key:'unknown',label:'Estado del VPS: '+status.slice(7)};
 if(status==='project:ACTIVE_HEALTHY')return {key:'healthy',label:'Activo según Supabase'};
 if(status==='project:INACTIVE')return {key:'stopped',label:'Proyecto pausado'};
 if(['project:ACTIVE_UNHEALTHY','project:RESTORE_FAILED','project:UPGRADING_FAILED','project:REMOVED'].includes(status))return {key:'warning',label:'Advertencia de proyecto'};
 if(status?.startsWith('project:'))return {key:'unknown',label:'Estado de proyecto: '+status.slice(8)};
 if(status==='deployment:READY')return {key:'healthy',label:'Despliegue listo'};
 if(status==='deployment:ERROR')return {key:'warning',label:'Error de despliegue'};
 if(status?.startsWith('deployment:'))return {key:'unknown',label:status==='deployment:NO_PRODUCTION'?'Sin despliegue de producción':'Estado de despliegue: '+status.slice(11)};
 if(status==='zone:active')return {key:'healthy',label:'Zona activa'};
 if(status?.startsWith('zone:'))return {key:'unknown',label:'Estado de zona: '+status.slice(5)};
 if(typeof status!=='string')return {key:'unknown',label:'Sin estado informado'};
 if(status.startsWith('exited')||status.startsWith('stopped'))return {key:'stopped',label:'Detenido'};
 if(status.includes('unhealthy')||status.startsWith('degraded'))return {key:'warning',label:'Advertencia'};
 if(status==='running:healthy')return {key:'healthy',label:'Saludable según Coolify'};
 return {key:'unknown',label:'Salud sin comprobar'};
}
export function resourceCategory(type){return type==='server'?'server':type==='cloud-project'?'project':type==='zone'?'zone':type==='application'?'application':type==='service'?'service':type?.startsWith('standalone-')?'database':'other'}
export function observationStale(connection,now=Date.now()){
 const snapshot=connection?.snapshot;
 return !snapshot||!connection.hasToken||Boolean(connection.error)||now>(snapshot.expiresAt??snapshot.checkedAt+300000);
}
export function serviceDetailStale(detail,now=Date.now()){
 return !detail?.checkedAt||Boolean(detail.error)||now>(detail.expiresAt??detail.checkedAt+900000);
}
export function resourceNeedsAttention(resource,serviceDetails=[]){
 if(['stopped','warning'].includes(declaredState(resource.status).key))return true;
 const detail=serviceDetails.find(d=>d.serviceId===resource.id);
 return Boolean(detail&&(detail.error||detail.components.some(c=>!c.excludedFromStatus&&['stopped','warning'].includes(declaredState(c.status).key))));
}
export function resourceContainsDatabase(resource,serviceDetails=[],now=Date.now()){
 if(resourceCategory(resource.type)==='database')return true;
 if(resource.type!=='service')return false;
 const detail=serviceDetails.find(d=>d.serviceId===resource.id);
 return serviceDetailStale(detail,now)||detail.components.some(c=>c.type==='database');
}
export function orbitPositions(resources){
 const ordered=[...resources].sort((a,b)=>resourceCategory(a.type).localeCompare(resourceCategory(b.type))||a.id.localeCompare(b.id));
 return ordered.map((resource,i)=>{const angle=-Math.PI/2+i*2*Math.PI/Math.max(ordered.length,1);return {...resource,x:50+39*Math.cos(angle),y:50+36*Math.sin(angle)}});
}
