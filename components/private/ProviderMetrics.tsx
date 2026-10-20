'use client';
import {useState} from 'react';
import {HelpTip} from './ContextHelp';
import type {ProviderMetric} from '@/lib/infrastructure-types';
const names:Record<string,string>={cpu_usage:'CPU',ram_usage:'Memoria',disk_space:'Disco',incoming_traffic:'Tráfico entrante',outgoing_traffic:'Tráfico saliente',uptime:'Tiempo activo'};
function MetricGraph({metric}:{metric:ProviderMetric}){
 const [point,setPoint]=useState<number|null>(null);
 const selected=point!==null?metric.points[point]:metric.points.at(-1);
 const start=metric.points[0]?.at??0,end=metric.points.at(-1)?.at??start,min=Math.min(...metric.points.map(p=>p.value)),max=Math.max(...metric.points.map(p=>p.value)),range=max-min||1;
 const x=(at:number)=>metric.points.length===1?150:(at-start)*300/(end-start||1),y=(value:number)=>65-(value-min)*50/range;
 const path=metric.points.map((p,i)=>`${i?'L':'M'} ${x(p.at)} ${y(p.value)}`).join(' ');
 return <><svg viewBox="0 0 300 80" role="group" aria-label={`Muestras de ${names[metric.name]??metric.name}; escala ajustada a la serie`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2"/>{metric.points.map((p,i)=><circle key={i} cx={x(p.at)} cy={y(p.value)} r="5" tabIndex={0} role="img" aria-label={`${p.value.toLocaleString('es')} ${metric.unit}, ${new Date(p.at).toLocaleString('es')}`} onMouseEnter={()=>setPoint(i)} onFocus={()=>setPoint(i)} onClick={()=>setPoint(i)} fill="currentColor"><title>{`${p.value.toLocaleString('es')} ${metric.unit} · ${new Date(p.at).toLocaleString('es')}`}</title></circle>)}</svg><p className="metric-sample-detail">{selected?`${selected.value.toLocaleString('es')} ${metric.unit} · ${new Date(selected.at).toLocaleString('es')}`:'Sin muestras'}</p></>;
}
export function ProviderMetrics({metrics,now,stale}:{metrics:ProviderMetric[];now:number;stale:boolean}){
 return <section className="provider-metrics"><div><span className="control-eyebrow">MÉTRICAS DEL VPS / HOSTINGER</span><h2>Última hora observada</h2><p>Muestras del proveedor, con su fecha y unidad original. La fecha de consulta y la de cada muestra pueden ser diferentes.</p></div><div className="metric-grid">{metrics.map(metric=>{
  const last=metric.points.at(-1),old=stale||!last||now-last.at>3600000,min=Math.min(...metric.points.map(p=>p.value)),max=Math.max(...metric.points.map(p=>p.value));
  return <article key={metric.name} className={old?'metric-stale':''}><h3>{names[metric.name]??metric.name}<HelpTip text={`Serie de Hostinger en ${metric.unit}. La altura se ajusta al mínimo y máximo de esta serie; no es un porcentaje salvo que la unidad sea %. Pasa por un punto, tócalo o enfócalo con Tab para ver su valor y fecha.`} label={`Entender la serie de ${names[metric.name]??metric.name}`}/></h3><strong>{last?last.value.toLocaleString('es',{maximumFractionDigits:2}):'—'}<small>{metric.unit}</small></strong><span>{old?'Muestra vencida o ausente':'Muestra del proveedor'}</span>{last?<><MetricGraph metric={metric}/><time>{new Date(last.at).toLocaleString('es')}</time><small>Rango {min.toLocaleString('es',{maximumFractionDigits:2})}–{max.toLocaleString('es',{maximumFractionDigits:2})} {metric.unit}</small></>:<p>Hostinger no entregó muestras para esta serie.</p>}</article>;
 })}</div>{!metrics.length?<p>No hay métricas en esta lectura. El estado del VPS por sí solo no acredita el funcionamiento de las aplicaciones.</p>:null}</section>;
}
