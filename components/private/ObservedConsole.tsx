"use client";
import {useEffect,useMemo,useState} from 'react';
import type {CoolifyState} from '@/lib/infrastructure-types';
import {createWorkspaceLoader} from '@/lib/workspace-loader.mjs';
import {WelcomeWizard} from './WelcomeWizard';
import {HealthWorkspace} from './HealthWorkspace';
type WorkspaceJob={id:string;state:string;target:{id:string;parentId?:string;name:string};observation?:{job?:{state:string}}|null};
export function ObservedConsole(){
 const [data,setData]=useState<CoolifyState|null>(null),[jobs,setJobs]=useState<WorkspaceJob[]>([]),[jobsUnavailable,setJobsUnavailable]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const load=useMemo(()=>createWorkspaceLoader({
  read:async(path:string,signal?:AbortSignal)=>{const r=await fetch(path,{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});if(r.status===401){window.location.assign('/access');throw Error('Inicia sesión.')}const v=await r.json();if(!r.ok)throw Error(v.error??'No se pudo leer el panel.');return v},
  inventory:(value:CoolifyState)=>{setData(value);setError('');setNow(Date.now())},
  inventoryError:()=>setError('No se pudo actualizar el inventario.'),
  jobs:(value:{operations:{requests:WorkspaceJob[]}})=>{setJobs(value.operations.requests);setJobsUnavailable(false)},
  jobsError:()=>{setJobsUnavailable(true)}
 }),[]);
 useEffect(()=>{const c=new AbortController();let reading=false;const update=async()=>{if(reading)return;reading=true;try{await load(c.signal)}finally{reading=false}};void update();const timer=setInterval(()=>{setNow(Date.now());if(!document.hidden)void update()},15000);return()=>{c.abort();load.invalidate();clearInterval(timer)}},[load]);
 async function refresh(){if(busy)return;setBusy(true);try{await load()}finally{setBusy(false)}}
 async function logout(){try{const r=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(r.ok)window.location.assign('/access');else setError('No se pudo cerrar la sesión.')}catch{setError('No se pudo cerrar la sesión.')}}
 return <><WelcomeWizard automatic onChanged={load}/><HealthWorkspace data={data} now={now} error={error} busy={busy} jobs={jobs} jobsUnavailable={jobsUnavailable} onChanged={load} onRefresh={()=>void refresh()} onLogout={()=>void logout()}/></>;
}
