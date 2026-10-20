"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {Database,Layers,Box,Globe,ZoomIn,ZoomOut,RotateCcw,Pause,Play,Maximize2,Minimize2} from 'lucide-react';
import {ProviderLogo} from '@/components/ProviderLogo';
import {declaredState,orbitPositions,resourceCategory} from '@/lib/observations.mjs';
import type {InfrastructureResource,ObservedProvider,ResourceLogo as LogoMetadata} from '@/lib/infrastructure-types';
import {ResourceLogo} from './ResourceLogo';
export function ObservedMap({resources,selected,onSelect,privateNames,stale,provider="Coolify",logos=[]}:{resources:InfrastructureResource[];selected:string|null;onSelect:(id:string)=>void;privateNames:boolean;stale:boolean;provider?:ObservedProvider;logos?:LogoMetadata[]}){
 const [zoom,setZoom]=useState(1),[paused,setPaused]=useState(false),[expanded,setExpanded]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!expanded)return;
  const previous=document.activeElement as HTMLElement|null;root.current?.focus();
  function keydown(event:KeyboardEvent){
   if(event.key==='Escape'){setExpanded(false);return}
   if(event.key!=='Tab')return;
   const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')??[]);
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===root.current)){event.preventDefault();first?.focus()}
  }
  document.addEventListener('keydown',keydown);
  return ()=>{document.removeEventListener('keydown',keydown);previous?.focus()};
 },[expanded]);
 const positions=orbitPositions(resources);
 return <div ref={root} tabIndex={expanded?-1:undefined} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} aria-label={expanded?'Mapa ampliado':undefined} className={`observed-map ${paused?'motion-paused':''} ${expanded?'map-expanded':''} ${stale?'map-stale':''}`}>
  <div className="map-tools"><span>CONSTELACIÓN / {provider.toUpperCase()}</span><div><button aria-label={paused?'Reanudar efectos':'Pausar efectos'} onClick={()=>setPaused(!paused)}>{paused?<Play size={16}/>:<Pause size={16}/>}</button><button aria-label="Alejar" disabled={zoom<=.8} onClick={()=>setZoom(Math.max(.8,zoom-.2))}><ZoomOut size={16}/></button><output>{Math.round(zoom*100)}%</output><button aria-label="Acercar" disabled={zoom>=1.6} onClick={()=>setZoom(Math.min(1.6,zoom+.2))}><ZoomIn size={16}/></button><button aria-label="Restablecer vista" onClick={()=>setZoom(1)}><RotateCcw size={16}/></button><button aria-label={expanded?'Reducir mapa':'Ampliar mapa'} aria-pressed={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div></div>
  <div className="orbit-scroll" tabIndex={0} role="region" aria-label="Mapa real desplazable; selecciona un recurso para consultar su estado. Usa el inventario como alternativa.">
   <div className="orbit-canvas" style={{width:`${960*zoom}px`,height:`${620*zoom}px`}}>
    <div className="orbit-grid" aria-hidden="true"/><div className="orbit-rings" aria-hidden="true"><i/><i/><i/></div>
    <svg className="orbit-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{positions.map(resource=><g key={resource.id} className={selected===resource.id?'edge-selected':''}><path d={`M 50 50 Q 50 ${resource.y} ${resource.x} ${resource.y}`}/></g>)}</svg>
    <div className="orbit-hub"><div className="hub-gyro" aria-hidden="true"/><ProviderLogo provider={provider} size={42}/><strong>{provider}</strong><span>{resources.length} RECURSOS</span></div>
    {positions.map((resource,i)=>{const state=declaredState(resource.status);const category=resourceCategory(resource.type);const Icon=category==='zone'?Globe:category==='application'?Box:category==='database'?Database:Layers;const name=privateNames?`Recurso ${String(i+1).padStart(2,'0')}`:resource.name;
     return <button key={resource.id} className={`orbit-node state-${stale?'unknown':state.key} ${selected===resource.id?'node-selected':''}`} style={{left:`${resource.x}%`,top:`${resource.y}%`,'--reveal':`${Math.min(i,12)*30}ms`} as CSSProperties} onClick={()=>onSelect(resource.id)} aria-pressed={selected===resource.id} aria-label={`${name}, ${stale?'Lectura vencida':state.label}`}><span className="node-symbol"><ResourceLogo logo={logos.find(logo=>logo.provider===provider&&logo.resourceId===resource.id)} privateNames={privateNames}><Icon size={20}/></ResourceLogo><i/></span><strong title={name}>{name}</strong></button>;
    })}
    {!resources.length&&<p className="orbit-empty">No hay recursos para este filtro.</p>}
   </div>
  </div>
  <footer className="orbit-legend"><span><i/>Inventariado en {provider}</span><span>Los efectos no representan tráfico ni dependencias de aplicación.</span></footer>
 </div>;
}
