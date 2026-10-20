import {isIP} from 'node:net';
import {AppError} from './store.mjs';
import {providerJSON,safeText} from './provider-http.mjs';
export function hostingerScope(value){if(typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value)))return value;throw new AppError('Selecciona el identificador numérico del VPS que quieres consultar.');}
function machineId(value){if(!Number.isSafeInteger(value)||value<=0)throw new AppError('Hostinger devolvió un identificador de VPS no compatible.',502);return String(value);}
export async function listHostingerServers(token,{get=providerJSON}={}){
 const rows=await get('Hostinger','/api/vps/v1/virtual-machines',token);if(!Array.isArray(rows)||rows.length>10000)throw new AppError('Hostinger devolvió un listado de VPS no compatible.',502);
 const seen=new Set();return rows.map(row=>{const id=machineId(row?.id);if(seen.has(id))throw new AppError('Hostinger devolvió VPS repetidos.',502);seen.add(id);return {id,name:safeText(row.hostname,200,token)??'VPS '+id};});
}
const metricNames=['cpu_usage','ram_usage','disk_space','incoming_traffic','outgoing_traffic','uptime'];
export function normalizeMetrics(value,from,to,token=''){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('Hostinger devolvió métricas no compatibles.',502);
 return metricNames.flatMap(name=>{
  const series=value[name];if(series===null||series===undefined)return [];
  if(!series||typeof series!=='object'||!series.usage||typeof series.usage!=='object'||Array.isArray(series.usage)||Object.keys(series.usage).length>2000)throw new AppError('Hostinger devolvió una serie de métricas no compatible.',502);
  const unit=safeText(series.unit,30,token);if(!unit)throw new AppError('Hostinger no informó la unidad de una métrica.',502);
  const points=Object.entries(series.usage).map(([time,value])=>{
   const seconds=Number(time);if(!/^\d{10}$/.test(time)||!Number.isSafeInteger(seconds)||seconds*1000<from-60000||seconds*1000>to+60000||typeof value!=='number'||!Number.isFinite(value)||value<0)throw new AppError('Hostinger devolvió muestras o fechas no compatibles.',502);
   return {at:seconds*1000,value};
  }).sort((a,b)=>a.at-b.at);
  return [{name,unit,points}];
 });
}
export async function collectHostinger(token,scope,{get=providerJSON,now=Date.now}={}){
 hostingerScope(scope);const signal=AbortSignal.timeout(25000),to=now(),from=to-3600000;
 const query=new URLSearchParams({date_from:new Date(from).toISOString(),date_to:new Date(to).toISOString()});
 const [vm,metrics,accountServers]=await Promise.all([get('Hostinger','/api/vps/v1/virtual-machines/'+scope,token,{signal}),get('Hostinger','/api/vps/v1/virtual-machines/'+scope+'/metrics?'+query,token,{signal}),listHostingerServers(token,{get}).catch(()=>null)]);
 if(machineId(vm?.id)!==scope)throw new AppError('Hostinger devolvió un VPS distinto del seleccionado.',502);
 const positive=value=>Number.isSafeInteger(value)&&value>0?value:null;
 const addresses=[...(Array.isArray(vm.ipv4)?vm.ipv4:[]),...(Array.isArray(vm.ipv6)?vm.ipv6:[])].map(row=>safeText(row?.address,60,token)).filter(address=>isIP(address??''));
 const resource={id:scope,name:safeText(vm.hostname,200,token)??'VPS '+scope,type:'server',status:'server:'+(safeText(vm.state,100,token)??'unknown'),plan:safeText(vm.plan,80,token),osTemplate:safeText(vm.template?.name,160,token),cpuCount:positive(vm.cpus),memoryMB:positive(vm.memory),diskMB:positive(vm.disk),bandwidthMB:positive(vm.bandwidth),addresses};
 const normalized=normalizeMetrics(metrics,from,to,token),checkedAt=now();return {resources:[resource],accountServers,metrics:normalized,source:'https://developers.hostinger.com',checkedAt,expiresAt:checkedAt+900000,coverage:'Listado de VPS accesibles a esta clave cuando está disponible; detalle y métricas solo del VPS seleccionado. No prueba Docker, PostgreSQL ni recorridos de aplicación. No incluye compras, renovaciones, acciones ni secretos SSH.'};
}
