'use client';
import {useEffect,useState} from 'react';
import {Activity,Check,RefreshCw,ShieldCheck,Sparkles,TriangleAlert} from 'lucide-react';
import {dateLabel} from '@/lib/workspace-explorer.mjs';
type CheckResult={key:string;name:string;provider:string;state:'pass'|'fail'|'unknown'|'excluded'|'prepared';checkedAt:number|null;reportedStatus?:string|null;source:string;finding:string;nextStep:string;recovered:boolean;reclassified?:boolean};
type Run={id:string;name:string;startedAt:number;finishedAt:number;previousAt:number|null;state:'warning'|'unknown'|'clear'|'prepared';checks:CheckResult[];limits:string};
type Report={name:string;runs:Run[]};
const labels={prepared:'Preparada · sin desplegar',pass:'Sin fallo reportado',fail:'Fallo observado',unknown:'Sin verificar',excluded:'Excluido del estado agregado'};
export function ResourceDiagnosis({selection,privateNames,preview,onChanged,onInterpret}:{selection:{scope:string;target:string}|null;privateNames:boolean;preview:boolean;onChanged:()=>Promise<void>;onInterpret:()=>void}){
 const [report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const scope=selection?.scope,target=selection?.target;
 useEffect(()=>{
  const controller=new AbortController();setReport(null);setError('');
  if(preview||privateNames||!scope||!target){setLoading(false);return()=>controller.abort()}
  setLoading(true);
  void fetch('/api/diagnosis?'+new URLSearchParams({scope,target}),{cache:'no-store',signal:controller.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error??'No se pudo consultar el historial.');if(!controller.signal.aborted)setReport(body)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[scope,target,preview,privateNames]);
 async function check(){
  if(!scope||!target||busy)return;setBusy(true);setError('');
  try{const r=await fetch('/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',scope,target})});const body=await r.json();if(!r.ok)throw Error(body.error??'No se pudo completar el diagnóstico.');setReport(body);void onChanged().catch(()=>{})}catch(e){setError(e instanceof Error?e.message:'No se pudo completar el diagnóstico.')}finally{setBusy(false)}
 }
 if(privateNames)return <p>Diagnóstico privado oculto. Pulsa Mostrar nombres para consultarlo.</p>;
 if(preview)return <section className="workspace-empty"><ShieldCheck size={38}/><h2>Diagnóstico de solo lectura</h2><p>En tu instalación consultará los estados actuales y comparará el resultado con la comprobación anterior. Esta demostración no consulta proveedores.</p></section>;
 if(!selection)return <p>Vuelve al mapa y elige la aplicación o la base que deseas comprobar.</p>;
 const latest=report?.runs[0],failed=latest?.checks.filter(c=>c.state==='fail').length??0,recovered=latest?.checks.filter(c=>c.recovered).length??0;
 return <section className="resource-diagnosis" aria-label="Diagnóstico de solo lectura" aria-busy={busy||loading}>
  <header className="workspace-alert-summary"><ShieldCheck size={30}/><div><h2>{report?.name??'Preparando selección…'}</h2><p>Consulta nueva al proveedor. Sin reparaciones ni consumo de IA.</p></div></header>
  <button className="workspace-primary" disabled={busy||loading} onClick={()=>void check()}><RefreshCw size={17} className={busy?'is-spinning':''}/>{busy?'Comprobando estados actuales…':latest?'Volver a comprobar':'Ejecutar diagnóstico'}</button>
  {error&&<p className="workspace-error" role="alert">{error}</p>}
  {loading&&<p role="status">Cargando comprobaciones anteriores…</p>}
  {busy&&<p role="status">Consultando los proveedores de esta selección. El resultado anterior se conserva mientras termina.</p>}
  {latest?<><div className={'diagnosis-summary health-'+(latest.state==='clear'?'healthy':latest.state)} role="status"><strong>{latest.state==='warning'?`${failed} ${failed===1?'fallo observado':'fallos observados'}`:latest.state==='unknown'?'Hay comprobaciones sin verificar':latest.state==='prepared'?'Preparada · sin desplegar':'Sin fallos en las comprobaciones'}</strong><p>{dateLabel(latest.finishedAt)}{latest.previousAt?' · Comparado con '+dateLabel(latest.previousAt):' · Primera comprobación'}</p>{recovered>0&&<p><Check size={16}/> {recovered} {recovered===1?'fallo anterior ya no aparece':'fallos anteriores ya no aparecen'} en la lectura nueva.</p>}<small>No se ha ejecutado ningún cambio en tus servicios.</small></div>
   <div className="diagnosis-checks">{latest.checks.map(c=><article key={c.key} className={'diagnosis-check '+c.state}><header>{c.state==='fail'?<TriangleAlert size={21}/>:c.state==='pass'?<Check size={21}/>:<Activity size={21}/>}<div><h3>{c.name}</h3><small>{c.provider} · {labels[c.state]}</small></div></header><p>{c.finding}</p>{c.reclassified&&<p className="diagnosis-reclassified">Clasificación corregida con evidencia de despliegues. No se ejecutó una reparación.</p>}{c.recovered&&<p className="diagnosis-recovered">Recuperación observada: este fallo ya no aparece en el estado del proveedor.</p>}<p><strong>Siguiente paso: </strong>{c.nextStep}</p><small>{c.source} · {dateLabel(c.checkedAt)}</small>{c.reportedStatus&&<details><summary>Estado técnico informado</summary><p>{c.reportedStatus}</p></details>}</article>)}</div>
   <details className="workspace-advanced"><summary>Qué confirma este diagnóstico</summary><p>{latest.limits}</p></details>
   {report&&report.runs.length>1&&<details className="workspace-advanced"><summary>Historial · {report.runs.length} comprobaciones</summary><ul>{report.runs.slice(1).map(r=><li key={r.id}>{dateLabel(r.finishedAt)} · {r.checks.filter(c=>c.state==='fail').length} fallos · {r.checks.filter(c=>c.state==='unknown').length} sin verificar</li>)}</ul><p>Últimas diez comprobaciones de esta misma selección. Se conservan hasta treinta días.</p></details>}
   <button className="workspace-primary" onClick={onInterpret}><Sparkles size={16}/>Consultar al asistente</button><p>El asistente usa las fuentes que revises antes de enviar. Su interpretación es opcional y no ejecuta reparaciones.</p>
  </>:!loading&&!error&&<p>Aún no hay comprobaciones guardadas para esta selección. Pulsa Ejecutar diagnóstico.</p>}
 </section>;
}
