import {applicationLifecycle,declaredState,resourceNeedsAttention,serviceDetailStale} from './observations.mjs';
/** Project only explanatory fields from the actual dated snapshot, never current resources or raw errors. */
export function dashboardHistorySample(snapshot){
 const at=Math.max(snapshot.checkedAt,...(snapshot.applicationDeployments??[]).map(h=>h.checkedAt??0));
 const warnings=snapshot.resources.filter(r=>!applicationLifecycle(r,snapshot,at)&&resourceNeedsAttention(r,snapshot.serviceDetails)).map(r=>{
  const state=declaredState(r.status).key,detail=snapshot.serviceDetails?.find(d=>d.serviceId===r.id);
  const components=(detail?.components??[]).filter(c=>!c.excludedFromStatus&&['stopped','warning'].includes(declaredState(c.status).key)).map(c=>({name:c.name,state:declaredState(c.status).label}));
  const kind=state==='stopped'?'stopped':state==='warning'?'unhealthy':detail?.error?'reading':'components';
  return {name:r.name,kind,components,detailStale:detail?serviceDetailStale(detail,snapshot.checkedAt):false};
 });
 return {checkedAt:snapshot.checkedAt,total:snapshot.resources.length,attention:warnings.length,warnings};
}
export const warningKinds={stopped:{label:'Detenidos',color:'#dc8845',meaning:'Coolify informó que el recurso estaba detenido. Puede ser una pausa intencional; esta lectura no identifica la causa.'},unhealthy:{label:'Control de salud con advertencias',color:'#d95d72',meaning:'El control de salud de Coolify informó una advertencia. Hay que revisar el recurso antes de concluir si la aplicación falla.'},components:{label:'Componentes por revisar',color:'#9b74cb',meaning:'Uno o varios componentes internos estaban detenidos o con advertencias. El servicio se cuenta una sola vez, aunque tenga varios componentes afectados.'},reading:{label:'Detalle sin consultar',color:'#8299af',meaning:'No se pudo consultar el detalle del servicio. Esto indica falta de información, no confirma una caída.'}};
