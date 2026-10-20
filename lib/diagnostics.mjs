import {declaredState,observationStale,serviceDetailStale,applicationLifecycle} from './observations.mjs';
export function buildDiagnostics(data,now=Date.now(),privateNames=false){
 if(!data)return {readings:[],findings:[],localOnly:true};
 const connections=[...(data.connection?[{provider:'Coolify',...data.connection}]:[]),...(data.integrations??[])];
 const readings=[],findings=[];
 for(const connection of connections){
  const snapshot=connection.snapshot;if(!connection.hasToken)continue;
  if(!snapshot){findings.push({id:'missing:'+connection.provider,severity:'unknown',provider:connection.provider,title:'Inventario sin comprobar',detail:'Hay un acceso guardado, pero no una lectura disponible. Consulta el proveedor para verificarlo.',checkedAt:null});continue;}
  const stale=observationStale(connection,now),resources=snapshot.resources;
  readings.push({provider:connection.provider,count:resources.length,checkedAt:snapshot.checkedAt,stale,source:privateNames?'Fuente privada':snapshot.source});
  if(stale)findings.push({id:'stale:'+connection.provider,severity:'warning',provider:connection.provider,title:connection.error?'La última consulta falló':'Lectura vencida',detail:'La evidencia anterior conserva su fecha. No permite concluir que los recursos estén caídos o funcionando ahora.',checkedAt:snapshot.checkedAt});
  for(const [index,resource] of resources.entries()){
   if(connection.provider==='Coolify'&&!stale&&applicationLifecycle(resource,snapshot,now))continue;
   const state=declaredState(resource.status);if(!['stopped','warning'].includes(state.key))continue;
   findings.push({id:connection.provider+':'+resource.id,severity:stale?'unknown':'warning',provider:connection.provider,resourceId:resource.id,title:privateNames?'Recurso '+(index+1):resource.name,detail:`${connection.provider} informó «${resource.status}». ${stale?'La lectura está vencida. ':''}Revisa su detalle y los registros del proveedor antes de decidir una acción.`,checkedAt:snapshot.checkedAt});
  }
  for(const [index,detail] of (snapshot.serviceDetails??[]).entries()){
   const parent=resources.find(r=>r.id===detail.serviceId);if(!parent)continue;
   const title=privateNames?'Servicio '+(index+1):parent.name;
   if(serviceDetailStale(detail,now))findings.push({id:'components-stale:'+detail.serviceId,severity:'unknown',provider:connection.provider,resourceId:detail.serviceId,title,detail:detail.error?'No se pudo actualizar el detalle de este servicio. Sus componentes conservan la fecha anterior; su estado actual está sin comprobar.':'La lectura de componentes está vencida o todavía no existe. El estado general del servicio no acredita sus componentes.',checkedAt:detail.checkedAt});
   const attention=detail.components.filter(c=>!c.excludedFromStatus&&['stopped','warning'].includes(declaredState(c.status).key));
   if(attention.length)findings.push({id:'components-attention:'+detail.serviceId,severity:stale||serviceDetailStale(detail,now)?'unknown':'warning',provider:connection.provider,resourceId:detail.serviceId,title,detail:`${attention.length} componentes tienen un estado declarado detenido o con advertencias. Abre el servicio para consultar cuáles son, su tipo y su fecha. Los componentes excluidos por Coolify del estado general se muestran aparte.`,checkedAt:detail.checkedAt});
  }
 }
 for(const [index,probe] of (data.probes??[]).entries()){
  const r=probe.snapshot,title=privateNames?'Dirección '+(index+1):probe.label;
  const finding=(suffix,severity,detail)=>findings.push({id:'probe:'+probe.id+':'+suffix,provider:null,severity,title,detail,checkedAt:r?.checkedAt??null});
  if(!r){finding('missing','unknown','La dirección está configurada, pero todavía no tiene una comprobación HTTPS. No permite concluir que esté disponible.');continue}
  if(now>r.expiresAt){finding('stale','unknown','La comprobación HTTPS ha vencido. Conserva su fecha y sus valores; vuelve a consultar antes de concluir que la web funciona o está caída.');continue}
  if(['unreachable','blocked','http-error'].includes(r.kind))finding('response','warning',r.kind==='http-error'?`La consulta HEAD recibió HTTP ${r.httpStatus}. Revisa la respuesta y el servicio; no identifica la causa ni el estado de la base.`:r.kind==='blocked'?'El destino no resolvió únicamente a IPv4 públicas. El control de destinos impidió contactarlo.':'No se obtuvo una respuesta HTTPS válida. Revisa DNS, certificado y conectividad; no demuestra por sí solo una caída de la base.');
  if(['protected','unsupported'].includes(r.kind))finding('coverage','unknown',r.kind==='protected'?'La consulta sin sesión recibió una restricción de acceso. La aplicación continúa sin comprobar.':'La web no admite HEAD. Su disponibilidad continúa sin comprobar con esta sonda.');
  if(r.certificateExpiresAt!==null&&r.certificateExpiresAt<=now+14*86400000)finding('certificate','warning','El certificado observado alcanza su caducidad en 14 días o menos. Revisa su renovación y vuelve a comprobarlo; esta lectura conserva su fecha.');
 }
 const enabled=data.collector?.enabled,heartbeat=data.collector?.heartbeat;
 if(enabled&&(!heartbeat||now-heartbeat>90000))findings.unshift({id:'collector',severity:'warning',provider:null,title:'Recolector sin pulso reciente',detail:'El proceso local no ha registrado un pulso en 90 segundos. Las lecturas conservadas no prueban una caída del VPS.',checkedAt:heartbeat??null});
 return {readings,findings,localOnly:true};
}
