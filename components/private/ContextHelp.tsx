'use client';
import {useEffect,useId,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {BookOpen,HelpCircle,Search} from 'lucide-react';
import {glossary,helpFor,helpVersion,settingsHelp,guideTitle} from '@/lib/app-help.mjs';
import './settings-workspace.css';
import './product-ux.css';
export function HelpTip({term,text,label='Qué significa',children}:{term?:string;text?:string;label?:string;children?:ReactNode}){
 const id=useId(),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[pinned,setPinned]=useState(false);
 const open=hovered||focused||pinned;
 const trigger=useRef<HTMLButtonElement|null>(null),[position,setPosition]=useState<CSSProperties>({});
 function place(){const r=trigger.current?.getBoundingClientRect();if(!r)return;const width=Math.min(280,window.innerWidth-32),below=r.top<175;setPosition({position:'fixed',left:Math.max(16,Math.min(window.innerWidth-width-16,r.left+r.width/2-width/2)),top:below?r.bottom+10:r.top-10,width,maxWidth:'none',right:'auto',bottom:'auto',transform:below?'none':'translateY(-100%)'})}
 useEffect(()=>{if(!open)return;const close=()=>{setHovered(false);setFocused(false);setPinned(false)};window.addEventListener('scroll',close,true);window.addEventListener('resize',close);return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close)}},[open]);
 return <span className={"context-help "+(children?"context-help-labeled":"")} onMouseEnter={()=>{place();setHovered(true)}} onMouseLeave={()=>setHovered(false)}><button ref={trigger} type="button" aria-label={label} aria-expanded={open} aria-controls={id} aria-describedby={open?id:undefined} onFocus={e=>{place();setFocused(e.currentTarget.matches(':focus-visible'))}} onBlur={()=>{setFocused(false);setPinned(false)}} onClick={()=>{place();setPinned(value=>!value)}} onKeyDown={e=>{if(e.key==='Escape'){setHovered(false);setFocused(false);setPinned(false);e.stopPropagation()}}}>{children}<HelpCircle size={15}/></button>{open&&<span id={id} className="context-help-popover" style={position} role="tooltip">{text??helpFor(term)}</span>}</span>;
}
export function ProductGuide(){
 const [query,setQuery]=useState('');
 const terms=glossary.filter(t=>(t.name+' '+t.text).toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
 return <details className="product-guide"><summary><BookOpen size={18}/>{guideTitle}</summary><p>Busca una función o un término. Esta ayuda funciona sin claves ni consumo de IA.</p><label className="guide-search"><Search size={17}/><input aria-label="Buscar en la ayuda" placeholder="Por ejemplo: auth, respaldo, costos…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="guide-terms">{terms.map(t=><details key={t.id}><summary>{t.name}</summary><p>{t.text}</p></details>)}</div>{!terms.length&&<p>No encontramos ese término. Prueba con su nombre técnico o consulta al asistente.</p>}<small>Ayuda del producto · versión {helpVersion}. El asistente de texto y voz utiliza este mismo catálogo; la salud se consulta por separado.</small></details>;
}
export function SettingsIntroduction({tab}:{tab:keyof typeof settingsHelp}){const t=settingsHelp[tab];return <div className="settings-purpose"><strong>¿Para qué sirve?</strong><p>{t.purpose}</p><small>{t.examples}</small></div>}
export function SettingsPreview({initialTab='providers'}:{initialTab?:keyof typeof settingsHelp}){const [tab,setTab]=useState<keyof typeof settingsHelp>(initialTab);return <section className="settings-preview"><p className="workspace-demo-note">Vista de Ajustes · ejemplo de diseño. No solicita ni guarda claves.</p><nav className="settings-sections" aria-label="Secciones de ajustes">{Object.entries(settingsHelp).map(([id,t])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id as keyof typeof settingsHelp)}>{t.label}</button>)}</nav><h2>{settingsHelp[tab].label}</h2><p>{settingsHelp[tab].description}</p><SettingsIntroduction tab={tab}/><ProductGuide/></section>}
