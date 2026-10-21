"use client";
import {useRef,useState} from "react";
import {useTheme} from "next-themes";
import {Network,Orbit,Settings2,List,SunMoon} from "lucide-react";
import {ConnectionCatalog} from './ConnectionCatalog';
import {inventoryConnectors} from '@/lib/connection-catalog.mjs';
import {InfrastructureMap} from "./InfrastructureMap";
import {resources,providers,type Resource} from "@/lib/preview/fixtures";

const planned = [
 ["Dominios y certificados","Zonas, subdominios, destinos, HTTPS y renovaciones. Separar registrador y proveedor DNS."],
 ["Salud y dependencias","Comprobaciones fechadas, incidentes y aplicaciones afectadas. Observación desconocida nunca equivale a sana."],
 ["Respaldos y restauración","Última copia, destino externo, antigüedad y evidencia de la última restauración comprobada."],
 ["Costos y capacidad","Gasto por aplicación, renovaciones, tendencias y estimaciones identificadas como tales."],
 ["Historial y alertas","Cambios, incidentes y avisos desde un monitor independiente de los servicios observados."],
 ["Texto, voz y acciones","Motor y clave propios. Consultas con fuentes. Cambios con aprobación explícita, permisos y auditoría."],
 ["Modo presentación","Ocultar IP, nombres internos y detalles privados sin alterar el inventario original."],
 ["Instalación y actualizaciones","Asistente, diagnóstico, configuración persistente, copias y recuperación de actualizaciones."],
];
export function Console(){
 const [view,setView]=useState("mapa"); const [query,setQuery]=useState(""); const [selected,setSelected]=useState<Resource|null>(null); const dialog=useRef<HTMLDialogElement>(null);
 const {resolvedTheme,setTheme}=useTheme();
 const filtered=resources.filter(r=>`${r.name} ${r.provider} ${r.kind}`.toLowerCase().includes(query.toLowerCase()));
 function detail(r:Resource){setSelected(r);dialog.current?.showModal()}
 return <div className="shell">
 <header className="top"><div className="wordmark"><Network size={29}/><strong>Conectad<span className="brand-os">OS</span></strong></div><span className="version">DEMO / DATOS FICTICIOS</span><a className="demo-return" href="/">← Volver a mi espacio</a><nav aria-label="Navegación"><button aria-current={view==='mapa'?'page':undefined} onClick={()=>setView('mapa')}><Orbit size={16}/>Ecosistema</button><button aria-current={view==='inventario'?'page':undefined} onClick={()=>setView('inventario')}><List size={16}/>Inventario</button><button aria-current={view==='setup'?'page':undefined} onClick={()=>setView('setup')}><Settings2 size={16}/>Instalación</button><button aria-label="Cambiar tema" onClick={()=>setTheme(resolvedTheme==='dark'?'light':'dark')}><SunMoon size={17}/></button></nav></header>
 <div className="notice"><strong>DEMOSTRACIÓN</strong>Recursos, relaciones y respuestas de ejemplo. Esta demostración no consulta tus cuentas. Las conexiones reales se configuran en el panel privado.</div>
 <main>{view==='mapa'?<InfrastructureMap onDetail={detail}/>:view==='inventario'?<section className="inventory"><header><h2>Inventario de ejemplo</h2><input aria-label="Buscar recursos" placeholder="Buscar recurso o proveedor…" value={query} onChange={e=>setQuery(e.target.value)}/></header><div className="table-scroll"><table><thead><tr><th>Recurso</th><th>Proveedor</th><th>Tipo</th><th>Estado simulado</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id}><td><button onClick={()=>detail(r)}>{r.name}</button></td><td>{r.provider}</td><td>{r.kind}</td><td>{r.health}</td></tr>)}</tbody></table></div>{!filtered.length&&<p className="empty">No hay coincidencias. <button className="action" onClick={()=>setQuery('')}>Limpiar búsqueda</button></p>}</section>:<Setup/>}
 <footer className="release">Aplicación independiente · Nombre provisional · Datos de ejemplo · <a href="/">Abrir panel privado</a></footer></main>
 <dialog ref={dialog} aria-labelledby="resource-title"><h2 id="resource-title">{selected?.name}</h2><p>{selected?.provider} · {selected?.kind}</p><p>{selected?.note}</p><p><strong>Respaldo: </strong>{selected?.backup}</p><p>Datos de demostración; no son lecturas de un proveedor.</p><button className="action" onClick={()=>dialog.current?.close()}>Cerrar detalle</button></dialog>
 </div>
}
function Setup(){
 const [chosen,setChosen]=useState<string[]>([]);const [ai,setAi]=useState('Sin IA');const [place,setPlace]=useState('Computadora local');const [voice,setVoice]=useState(false);const [saved,setSaved]=useState(false);
 function exportPlan(){
  const plan={schemaVersion:1,mode:'demo',installationTarget:place,requestedProviders:chosen,aiPreference:ai,voiceRequested:voice,notice:'Plan de instalación. No representa conexiones activas. No contiene credenciales.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='conectados-plan.json';a.click();URL.revokeObjectURL(url);setSaved(true);
 }
 return <div className="setup"><h1 className="page-title">Tu infraestructura. Tus claves.</h1><p className="sub">La demostración funciona sin cuentas ni APIs. Este plan guarda tus preferencias; las conexiones se configuran y comprueban por separado en el panel privado.</p>
 <section><h2>01 / Elige dónde usarla</h2><label htmlFor="place">Destino previsto</label><select id="place" value={place} onChange={e=>{setPlace(e.target.value);setSaved(false)}}><option>Computadora local</option><option>VPS / Coolify (requiere HTTPS y revisión)</option></select><p className="sub">La instalación local escucha en 127.0.0.1. El paquete Docker requiere un dominio HTTPS y volúmenes privados. Descargar este plan no despliega la aplicación ni abre puertos.</p></section>
 <ConnectionCatalog links={false}/><section><h2>02 / Conectores de inventario que quieres configurar</h2><div className="steps">{inventoryConnectors.map(item=>item.name).map(p=><label key={p}><input type="checkbox" checked={chosen.includes(p)} onChange={()=>{setChosen(chosen.includes(p)?chosen.filter(x=>x!==p):[...chosen,p]);setSaved(false)}}/>{p}</label>)}</div><small>Seleccionarlos no concede acceso. El asistente de conexión deberá explicar permisos mínimos y probar cada integración antes de marcarla como lista.</small></section>
 <section><h2>03 / Inteligencia y voz opcionales</h2><label htmlFor="ai">Preferencia de motor</label><select id="ai" value={ai} onChange={e=>{setAi(e.target.value);setSaved(false)}}><option>Sin IA</option><option>API comercial con mi clave</option><option>Modelo local compatible (pendiente)</option></select><label><input type="checkbox" checked={voice} onChange={e=>{setVoice(e.target.checked);setSaved(false)}}/>Quiero configurar consultas por voz</label><p className="sub">El asistente de texto se configura en el panel privado con una clave propia y límites. Texto y voz se configuran por separado con tus propios accesos. Estos servicios pueden tener costos en tu cuenta; una suscripción a un agente de programación no aporta automáticamente la API de esta aplicación.</p><small>No introduzcas secretos en este plan ni en el chat. Este formulario guarda preferencias y no solicita acceso al micrófono.</small></section>
 <section><h2>04 / Guarda tu plan</h2><pre>{`Destino: ${place}\nModo actual: demostración\nProveedores solicitados: ${chosen.join(', ')||'Ninguno'}\nIA: ${ai}\nVoz solicitada: ${voice?'Sí':'No'}`}</pre><button className="action" onClick={exportPlan}>Descargar plan sin credenciales</button><p role="status" className="sub">{saved?'Plan generado para descarga. Guárdalo en la carpeta del proyecto para que tu agente lo revise.':'Las preferencias de esta pantalla se pierden al recargar si no descargas el plan.'}</p></section>
 <h2>Alcance completo del producto</h2><p className="sub">Estas capacidades forman parte del producto. Consulta la guía del proyecto para conocer lo implementado y lo pendiente. Esta demostración no activa conexiones ni servicios.</p><div className="planned">{planned.map(([name,description])=><article key={name}><span>ALCANCE</span><h3>{name}</h3><p>{description}</p></article>)}</div>
 </div>
}
