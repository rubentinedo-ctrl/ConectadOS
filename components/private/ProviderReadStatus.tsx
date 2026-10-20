'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import type {CoolifyState,ObservedProvider} from '@/lib/infrastructure-types';
import {connectionFor,dateLabel} from '@/lib/workspace-explorer.mjs';
import {observationStale} from '@/lib/observations.mjs';
export function ProviderReadStatus({provider,data,now,onChanged,mappedCount,readOnly=false}:{provider:ObservedProvider;data:CoolifyState|null;now:number;onChanged:()=>Promise<void>;mappedCount:number;readOnly?:boolean}){
 const connection=connectionFor(data,provider),stale=observationStale(connection,now),connected=Boolean(connection?.hasToken);
 const active=useRef(new Map<string,AbortController>()),attempted=useRef(new Map<string,number>()),mounted=useRef(true);
 const [pending,setPending]=useState<string[]>([]),[messages,setMessages]=useState<Record<string,string>>({});
 useEffect(()=>{mounted.current=true;const requests=active.current;return()=>{mounted.current=false;for(const controller of requests.values())controller.abort();requests.clear()}},[]);
 const refresh=useCallback(async()=>{
  if(readOnly||active.current.has(provider))return;
  const controller=new AbortController();active.current.set(provider,controller);attempted.current.set(provider,Date.now());setPending(v=>[...v,provider]);setMessages(v=>({...v,[provider]:''}));
  try{
   const r=await fetch(provider==='Coolify'?'/api/coolify':'/api/infrastructure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh',...(provider==='Coolify'?{}:{provider})}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
   if(r.status===401){window.location.assign('/access');return}
   const result=await r.json();if(!r.ok)throw Error(result.error??'No se pudo consultar el proveedor.');
   if(controller.signal.aborted)return;
   await onChanged();
   if(mounted.current)setMessages(v=>({...v,[provider]:result.result?.busy?'Ya hay una consulta en curso. La lectura se actualizará al finalizar.':result.result?.cached?'Mostrando la lectura reciente guardada.':'Consulta terminada. Se muestra la lectura disponible.'}));
  }catch(e){if(!controller.signal.aborted&&mounted.current)setMessages(v=>({...v,[provider]:e instanceof Error&&e.name!=='TimeoutError'?e.message:'La consulta tardó demasiado. Se conserva la lectura anterior; puedes reintentar.'}));}
  finally{active.current.delete(provider);if(mounted.current)setPending(v=>v.filter(p=>p!==provider))}
 },[provider,onChanged,readOnly]);
 useEffect(()=>{if(connected&&stale&&!readOnly&&Date.now()-(attempted.current.get(provider)??0)>60000)void refresh()},[provider,connected,stale,readOnly,refresh]);
 const busy=pending.includes(provider),count=connection?.snapshot?.resources.length;
 return <div className="map-provider-reading"><div><strong>{provider} · {count===undefined?'Sin inventario guardado':`${count} ${provider==='Cloudflare'?'zonas DNS':'recursos'} en el inventario`}</strong><span>{busy?'Consultando al proveedor · conservamos la lectura disponible':!connected?'Conexión sin configurar':stale?'Última lectura sin vigencia confirmada':'Lectura guardada vigente'} · {dateLabel(connection?.snapshot?.checkedAt)}</span>{count!==undefined&&count!==mappedCount&&<span>El mapa incluye {mappedCount} de esos {count} recursos; su cobertura es parcial.</span>}</div><button type="button" disabled={busy||readOnly||!connected} onClick={()=>void refresh()}><RefreshCw size={15} className={busy?'is-spinning':''}/>{busy?'Consultando…':`Actualizar ${provider}`}</button>{messages[provider]&&<p role="status">{messages[provider]}</p>}</div>;
}
