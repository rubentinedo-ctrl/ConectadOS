'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Database,RefreshCw,ShieldCheck,TriangleAlert} from 'lucide-react';
import {declaredState} from '@/lib/observations.mjs';
import type {ResourceBackupsReport} from '@/lib/resource-backup-types';
import './resource-backups.css';
const names={unknown:'Sin evidencia',stale:'Lectura vencida',failed:'Último intento con fallo',working:'Copia en curso',overdue:'Copia anterior a 25 horas',restored:'Restauración local registrada',unverified:'Copia sin restauración'};
const date=(v:number|null|undefined)=>v?new Date(v).toLocaleString('es'):'Sin comprobación';
export function ResourceBackups({report,privateNames,now,resourceRefs,onChanged}:{report:ResourceBackupsReport|undefined;privateNames:boolean;now:number;resourceRefs:string[]|null;onChanged:(r:ResourceBackupsReport)=>void}){
 const [query,setQuery]=useState(''),[onlyGaps,setOnlyGaps]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);useEffect(()=>{if(privateNames)controller.current?.abort()},[privateNames]);
 if(privateNames)return null;
 const expired=!!report?.expiresAt&&now>report.expiresAt;
 const items=(report?.items??[]).filter(i=>(!resourceRefs||resourceRefs.includes(i.ref)||!!i.parentRef&&resourceRefs.includes(i.parentRef))&&i.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))&&(!onlyGaps||i.state!=='restored'||expired));
 async function refresh(){if(busy)return;const c=new AbortController();controller.current=c;setBusy(true);setError('');try{const r=await fetch('/api/resource-backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh'}),signal:c.signal}),v=await r.json();if(!r.ok)throw Error(v.error);if(!c.signal.aborted){onChanged(v.resourceBackups);if(v.result?.unconfigured)setError('Falta instalar y vincular el lector de informes del host. La guía explica cómo hacerlo.')}}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'No se pudo leer la evidencia.')}finally{if(controller.current===c){controller.current=null;setBusy(false)}}}
 return <section className="resource-backups" id="resource-backups" aria-labelledby="resource-backups-title">
  <header><ShieldCheck size={26}/><div><span className="control-eyebrow">CONTINUIDAD / BASES OBSERVADAS</span><h2 id="resource-backups-title">Protección de tus bases</h2></div><button className="action" onClick={refresh} disabled={busy||!report}><RefreshCw size={15}/>{busy?'Leyendo…':'Actualizar evidencia'}</button></header>
  <p>El estado del servicio y la recuperación de sus datos se comprueban por separado. Esta vista lee trabajos existentes; no inicia copias ni detiene aplicaciones.</p>
  <p>Conteos de todo el inventario Coolify; los filtros se aplican a la lista.</p><div className="resource-backup-summary"><strong>{report?.counts.restored??'—'}<span>con restauración local registrada</span></strong><strong>{report?.counts.unknown??'—'}<span>con cobertura por confirmar</span></strong><strong>{report?.counts.attention??'—'}<span>con fallos o copias antiguas</span></strong></div>
  <div className="resource-backup-controls"><label>Buscar base<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre de aplicación o base" type="search"/></label><label className="resource-backup-toggle"><input type="checkbox" checked={onlyGaps} onChange={e=>setOnlyGaps(e.target.checked)}/>Mostrar pendientes</label><small>Informe: {date(report?.sampledAt)}{expired?' · vencido':''}</small></div>
  {(error||report?.error)?<p role="alert" className="protection-error">{error||report?.error}</p>:null}
  {!report&&<p role="status">Cargando evidencia de las bases…</p>}<div className="resource-backup-list">{items.map(item=>{const state=expired&&item.latest?'stale':item.state,health=item.healthStale?'Lectura de salud vencida':declaredState(item.status).label,r=item.latest;
   return <details key={item.ref} className={'resource-backup-item '+state}><summary><Database size={19}/><span><strong>{item.name}</strong><small>{health} · {date(item.healthCheckedAt)}</small></span><span className="resource-backup-badge">{state==='restored'?<ShieldCheck size={14}/>:<TriangleAlert size={14}/>} {names[state]}</span></summary>
    <div className="resource-backup-detail"><div className="resource-backup-flow" aria-label="Evidencia de la última copia"><div><small>COPIA LOCAL</small><strong>{date(r?.backupAt)}</strong><span>{r?.bytes?new Intl.NumberFormat('es',{maximumFractionDigits:2}).format(r.bytes/1048576)+' MiB':'Tamaño sin comprobar'}</span></div><ArrowRight aria-hidden="true" size={17}/><div><small>RESTAURACIÓN LOCAL</small><strong>{r?.restored?date(r.reportedAt):'Sin prueba de esta copia'}</strong><span>{r?.source??'Falta vincular un trabajador'}</span></div><ArrowRight aria-hidden="true" size={17}/><div><small>LOTE EN DRIVE</small><strong>{r?.drive?.state==='included'?'Componente incluido':r?.drive?.state==='failed'?'Transferencia con fallo':'Sin inclusión confirmada'}</strong><span>{date(r?.drive?.reportedAt)}</span></div></div>
     <p>{r?.coverage??'No hay un informe vinculado a esta base. Sus copias pueden existir; ConectadOS todavía no tiene evidencia.'}</p><p>Drive verifica el lote enviado. No demuestra que esa versión individual se restauró fuera del VPS. Salud de servicio: {item.healthSource}; no incluye una transacción de la aplicación.</p>
     {item.lastRestored&&r&&!r.restored?<p>Última restauración anterior registrada: {date(item.lastRestored.reportedAt)}. No acredita el intento actual.</p>:null}
     {item.history.length?<div className="resource-backup-history"><h3>Recibos locales conservados</h3>{item.history.map(h=><p key={h.backupAt}><time>{date(h.backupAt)}</time><span>{h.restored?'Restauración registrada':'Sin restauración'}</span></p>)}</div>:null}
    </div>
   </details>;
  })}{!items.length?<p>No hay bases que coincidan con este filtro.</p>:null}</div>
  <details className="resource-backup-scope"><summary>Cómo interpretar esta vista</summary><p>{report?.coverage}</p><p>Los comprobantes vienen del trabajador autorizado del host; esta lectura no repite la restauración. La edad de la copia se calcula desde sus datos, aunque el lector siga activo. Las bases sin evidencia permanecen visibles. Los filtros de proyecto usan asignaciones explícitas.</p><a href="/docs/resource-backups">Guía de protección por recurso</a></details>
 </section>;
}
