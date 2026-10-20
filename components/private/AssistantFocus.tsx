"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Search,Network} from 'lucide-react';

type Target={target:string;name:string;kind:string;provider:string;type?:string;stale?:boolean;assigned?:number};
type Targets={items:Target[];total:number;omitted:number;catalogOmitted:number;checkedAt:number};
const kindNames:Record<string,string>={resource:'recurso',component:'componente',dns:'registro DNS',project:'proyecto'};
export function AssistantFocus({scope,target,onSelect,disabled}:{scope:'resource'|'project';target:string;onSelect:(value:string)=>void;disabled:boolean}){
 const [query,setQuery]=useState(''),[report,setReport]=useState<Targets|null>(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false);
 const active=useRef<AbortController|null>(null);
 const search=useCallback(async(value:string,controller:AbortController)=>{
  setLoading(true);setMessage('');
  try{const r=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'targets',scope,query:value}),signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);if(!controller.signal.aborted)setReport(data.targets)}catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'No se pudo consultar el inventario.')}finally{if(!controller.signal.aborted)setLoading(false)}
 },[scope]);
 useEffect(()=>{const c=new AbortController();active.current=c;void search('',c);return()=>{c.abort();active.current?.abort()}},[search]); // One local inventory read when selecting this scope; no provider request.
 function submit(e:FormEvent){e.preventDefault();active.current?.abort();const c=new AbortController();active.current=c;void search(query,c)}
 return <div className="assistant-focus"><div className="assistant-focus-title"><Network size={16}/><strong>{scope==='project'?'Un proyecto, sus recursos asignados y sus componentes':'Un recurso y sus componentes observados'}</strong></div>
 <p>La selección usa tu inventario guardado. Sus nombres permanecen en el panel; el contexto de IA usa referencias R1, R2… No se añaden dependencias por semejanza de nombres.</p>
 <form onSubmit={submit} className="assistant-focus-search"><label htmlFor="assistant-target-query">Buscar en el inventario<input id="assistant-target-query" maxLength={100} value={query} disabled={disabled||loading} onChange={e=>setQuery(e.target.value)} placeholder={scope==='project'?'Nombre del proyecto':'Nombre, proveedor o tipo'}/></label><button className="action" disabled={disabled||loading}><Search size={15}/>Buscar</button></form>
 <label htmlFor="assistant-target">{scope==='project'?'Proyecto que deseas consultar':'Recurso que deseas consultar'}<select id="assistant-target" value={target} disabled={disabled||loading} onChange={e=>onSelect(e.target.value)}><option value="">Selecciona una opción</option>{target&&report&&!report.items.some(item=>item.target===target)?<option value={target}>Selección conservada · fuera de esta búsqueda</option>:null}{report?.items.map(item=><option key={item.target} value={item.target}>{item.name} · {item.provider} · {kindNames[item.kind]??item.kind}{item.type?` / ${item.type}`:''}{item.stale?' · lectura vencida':''}{item.assigned!==undefined?` · ${item.assigned} asignaciones`:''}</option>)}</select></label>
 <p role="status">{loading?'Consultando el inventario local…':message||(!report?'':`${report.total} coincidencias · consulta ${new Date(report.checkedAt).toLocaleString('es')}.${report.omitted?` Se muestran las primeras 100; precisa la búsqueda para ver las otras ${report.omitted}.`:''}${report.catalogOmitted?` El catálogo omite ${report.catalogOmitted} nodos por su límite.`:''}`)}</p>
 {scope==='project'?<small>Si falta una asignación, puedes añadirla desde Organización. Una agrupación local no prueba disponibilidad, costos ni respaldo.</small>:<small>Los registros DNS y componentes también se pueden seleccionar individualmente. Las lecturas vencidas conservan su fecha.</small>}
 </div>;
}
