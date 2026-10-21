"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {Network,LockKeyhole,LogOut,RefreshCw} from 'lucide-react';
import {providers} from '@/lib/preview/fixtures';
import {ConnectionCatalog} from '@/components/ConnectionCatalog';
import {providerGuides} from '@/lib/provider-guides';
import {Assistant} from './Assistant';
import {AccountSecurity} from './AccountSecurity';
import {BackupSettings} from './BackupSettings';
import {ProviderHelp} from './ProviderHelp';
import {GoogleSettings} from './GoogleSettings';
import {ProviderConnections} from './ProviderConnections';
import {CoolifyInventory} from './CoolifyInventory';
type Credential={provider:string;label:string;updated:number};
type Audit={event:string;created:number};
import {ExternalObserver} from './ExternalObserver';
import {Notifications} from './Notifications';
import {WebProbes} from './WebProbes';
import type {CoolifyState} from '@/lib/infrastructure-types';
import './settings-workspace.css';
import {settingsHelp} from '@/lib/app-help.mjs';
import {SettingsIntroduction,ProductGuide} from './ContextHelp';
type SettingsTab='providers'|'assistant'|'account'|'backups'|'monitoring'|'activity';
const settingsTabs=settingsHelp;
function settingsTab(hash:string):SettingsTab{if(hash.includes('assistant')||hash.includes('voice'))return 'assistant';if(hash.includes('account')||hash.includes('google'))return 'account';if(hash.includes('backup'))return 'backups';if(hash.includes('monitor')||hash.includes('observer')||hash.includes('notifications')||hash.includes('web-probes'))return 'monitoring';if(hash.includes('activity'))return 'activity';return 'providers'}
function MonitoringSettings(){
 const [data,setData]=useState<CoolifyState|null>(null),[error,setError]=useState('');
 async function load(){try{const r=await fetch('/api/infrastructure',{cache:'no-store'});if(r.status===401){window.location.assign('/access');return}const v=await r.json();if(!r.ok)throw Error(v.error??'No se pudo cargar la supervisión.');setData(v);setError('')}catch{setError('No se pudo cargar la supervisión. Reintenta la lectura.')}}
 useEffect(()=>{void load()},[]);
 return <>{error&&<p className="form-error" role="alert">{error}<button className="action" onClick={()=>void load()}>Reintentar</button></p>}{data?<><Notifications report={data.notifications} privateNames={false} onChanged={load}/><ExternalObserver report={data.externalObserver} now={Date.now()} privateNames={false} onChanged={()=>void load()} configurationOnly/><WebProbes probes={data.probes??[]} privateNames={false} observing={data.collector.enabled} onChanged={load}/></>:!error&&<p role="status">Cargando monitores y avisos…</p>}</>;
}
const labels:Record<string,string>={billing_entry_created:'Gasto o renovación registrado',billing_entry_changed:'Gasto o renovación actualizado',billing_entry_archived:'Gasto archivado',billing_entry_restored:'Gasto recuperado',provider_configured:'Conexión de proveedor guardada',provider_refreshed:'Inventario de proveedor consultado',collector_enabled:'Observación automática activada',collector_disabled:'Observación automática pausada',coolify_configured:'Conexión Coolify guardada',coolify_refreshed:'Inventario Coolify consultado',coolify_failed:'Consulta Coolify fallida',google_configured:'Cliente de Google guardado',google_linked:'Cuenta Google vinculada',google_login:'Acceso con Google correcto',google_denied:'Cuenta Google no autorizada',google_unlinked:'Cuenta Google desvinculada',owner_created:'Cuenta administradora creada',settings_saved:'Preferencias guardadas',credential_saved:'Credencial guardada',credential_deleted:'Credencial retirada',login_success:'Inicio de sesión correcto',login_failed:'Intento de acceso fallido',logout:'Sesión cerrada'};
export function PrivateConsole(){
 const [tab,setTab]=useState<SettingsTab>('providers');
 useEffect(()=>{const update=()=>setTab(settingsTab(window.location.hash));update();window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
 function selectTab(next:SettingsTab){setTab(next);setMessage('');window.history.replaceState(null,'','#'+settingsTabs[next].anchor)}
 const [provider,setProvider]=useState(providers[0]);
 const guide=providerGuides[provider];
 const [credentials,setCredentials]=useState<Credential[]>([]);const [audit,setAudit]=useState<Audit[]>([]);const [ready,setReady]=useState(false);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function load(){setMessage('');try{const r=await fetch('/api/settings',{cache:'no-store'});if(r.status===401){window.location.assign('/access');return}const data=await r.json();if(!r.ok)throw new Error(data.error);setCredentials(data.credentials);setAudit(data.audit);setReady(true)}catch(e){setMessage(e instanceof Error?e.message:'No se pudo cargar la configuración.')}}
 useEffect(()=>{void load()},[]);
 async function post(body:unknown){const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data}
 async function add(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!guide.manual||['Coolify','Vercel','Cloudflare','Supabase','Hostinger'].includes(provider))return;setBusy(true);const element=e.currentTarget;const form=new FormData(element);try{await post({action:'credential',provider:form.get('provider'),label:form.get('label'),secret:form.get('secret')});element.reset();await load();setMessage('Clave guardada cifrada. La conexión está pendiente de comprobar.')}catch(e){setMessage(e instanceof Error?e.message:'No se pudo guardar la clave.')}finally{setBusy(false)}}
 async function remove(provider:string){setBusy(true);try{await post({action:'deleteCredential',provider});await load();setMessage('Credencial retirada de esta instalación. Si deseas revocarla, hazlo también en su proveedor.')}catch(e){setMessage(e instanceof Error?e.message:'No se pudo retirar.')}finally{setBusy(false)}}
 async function logout(){const r=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})});if(r.ok)window.location.assign('/access');else setMessage('No se pudo cerrar la sesión. Reintenta.')}
 return <div className="shell settings-shell"><header className="top"><div className="wordmark"><Network/><strong>Conectad<span className="brand-os">OS</span></strong></div><nav aria-label="Navegación privada"><a href="/">← Volver al Dashboard</a><button onClick={logout}><LogOut size={16}/>Cerrar sesión</button></nav></header><main className="setup settings-workspace"><h1 className="page-title">Ajustes</h1><p className="sub">Configura cada servicio en su sección. Guardar una clave no inicia una conversación ni una operación.</p><nav className="settings-sections" aria-label="Secciones de ajustes">{Object.entries(settingsTabs).map(([id,t])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>selectTab(id as SettingsTab)}>{t.label}</button>)}</nav><div className="settings-section-heading"><h2>{settingsTabs[tab].label}</h2><p>{settingsTabs[tab].description}</p></div><SettingsIntroduction tab={tab}/><p className="form-message" role="status">{message}</p>
 {!ready?<section><p>Cargando configuración…</p><button className="action" onClick={load}><RefreshCw size={16}/>Reintentar</button></section>:<>
 {tab==='assistant'&&<><ProductGuide/><Assistant configurationOnly/></>}
 {tab==='account'&&<><GoogleSettings/><AccountSecurity/></>}
 {tab==='backups'&&<BackupSettings/>}
 {tab==='monitoring'&&<MonitoringSettings/>}
 {tab==='providers'&&<><ConnectionCatalog/><CoolifyInventory/><ProviderConnections/>
 <section><h2><LockKeyhole size={20}/> Guías y accesos guardados</h2>
 <p className="sub">Los cinco conectores de inventario se configuran arriba. Aquí puedes consultar sus guías; Resend sirve para correo y Drive requiere su instalador independiente. Guardar una clave en la bóveda no crea un conector nuevo.</p>
 <form className="credential-form" onSubmit={add}>
   <label htmlFor="provider">Proveedor</label>
   <select id="provider" name="provider" value={provider} disabled={busy} onChange={e=>{setProvider(e.target.value);setMessage('')}}>{providers.map(p=><option key={p}>{p}{p==='Resend'?' · correo, sin inventario':p==='Google Drive'?' · respaldo, instalador aparte':' · inventario API'}</option>)}</select>
   <ProviderHelp provider={provider} guide={guide}/>
   {guide.manual&&!['Coolify','Vercel','Cloudflare','Supabase','Hostinger'].includes(provider) ? <div key={provider}>
     <label htmlFor="label">Etiqueta para reconocer este acceso</label>
     <input id="label" name="label" required maxLength={80} placeholder={`Por ejemplo, ${provider} · ConectadOS`} aria-describedby="label-help"/>
     <small id="label-help">Elige un nombre descriptivo. No escribas la clave aquí.</small>
     <label htmlFor="secret">{guide.credential}</label>
     <input id="secret" name="secret" type="password" required minLength={8} maxLength={4096} autoComplete="off" placeholder="Pega aquí el valor completo" aria-describedby="secret-help"/>
     <small id="secret-help">Pega solo la clave, sin comillas ni el prefijo Bearer. Se guarda cifrada y no vuelve a mostrarse. No la compartas en chats.</small>
     {credentials.some(c=>c.provider===provider)&&<p className="sub">Ya hay una clave guardada para {provider}. Guardar otra reemplazará la anterior en esta instalación.</p>}
     <button className="action" disabled={busy}>Guardar clave cifrada</button>
   </div> : provider==='Coolify'?<a className="action" href="#coolify-inventory">Configurar y consultar Coolify</a>:['Vercel','Cloudflare','Supabase','Hostinger'].includes(provider)?<a className="action" href="#provider-connections">Configurar y consultar {provider}</a>:<p className="oauth-pending">Autorización con Google pendiente de implementar. Aquí no se solicita una clave manual.</p>}
 </form>
 {credentials.length?<ul className="credential-list">{credentials.map(c=><li key={c.provider}><div><strong>{c.provider}</strong><p>{c.label} · Guardada {new Date(c.updated).toLocaleString('es')}</p><small>El estado de la conexión se comprueba en su conector.</small></div><button className="action" disabled={busy} onClick={()=>remove(c.provider)}>Retirar clave</button></li>)}</ul>:<p className="sub">Todavía no hay claves guardadas.</p>}</section>
 </>}
 {tab==='activity'&&<section><h2>Actividad de esta instalación</h2><ul className="audit-list">{audit.map((a,i)=><li key={`${a.created}-${i}`}><span>{labels[a.event]??'Evento registrado'}</span><time>{new Date(a.created).toLocaleString('es')}</time></li>)}</ul></section>}</>}
 </main></div>
}
