"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {ExternalLink,ShieldCheck} from 'lucide-react';
import {GoogleSignIn} from './GoogleSignIn';
type Status={configured:boolean;linked:boolean;clientId:string;email:string|null;authorizedOrigin:string};
export function GoogleSettings(){
 const [status,setStatus]=useState<Status|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/google',{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error);setStatus(data)}catch(e){setMessage(e instanceof Error?e.message:'No se pudo cargar Google.')}}
 useEffect(()=>{void load()},[]);
 async function submit(e:FormEvent<HTMLFormElement>,action:'configure'|'unlink'){
  e.preventDefault();const element=e.currentTarget;const form=new FormData(element);setBusy(true);setMessage('');
  try{const r=await fetch('/api/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,clientId:form.get('clientId'),password:form.get('password')})});const data=await r.json();element.reset();if(!r.ok)throw new Error(data.error);await load();setMessage(action==='configure'?'Cliente guardado. Ahora vincula tu cuenta con el botón de Google.':'Google desvinculado. Las otras sesiones se cerraron; tu acceso con contraseña sigue disponible.')}catch(e){setMessage(e instanceof Error?e.message:'No se pudo guardar Google.')}finally{setBusy(false)}
 }
 return <section className="google-settings"><h2><ShieldCheck size={20}/> Acceso con Google</h2><p className="sub">Añade Google a tu cuenta administradora. Tu contraseña seguirá funcionando. Una cuenta de Google sin vincular no tendrá acceso.</p><p className="form-message" role="status">{message}</p>
 {!status?<button className="action" onClick={load}>Cargar configuración</button>:<>
 <div className="notice"><strong>{status.linked?'VINCULADO':status.configured?'FALTA VINCULAR TU CUENTA':'FALTA CONFIGURAR GOOGLE CLOUD'}</strong>{status.linked?status.email:'El acceso con Google todavía no está activo.'}</div>
 {!status.linked&&<>
 <ol className="google-steps"><li>En Google Cloud selecciona un proyecto y prepara Google Auth Platform. Si está en modo de prueba, añade tu cuenta como usuario de prueba.</li><li>Crea un cliente OAuth del tipo <strong>Aplicación web</strong>. En <strong>Orígenes autorizados de JavaScript</strong> añade exactamente <code>{status.authorizedOrigin}</code>.</li><li>Copia su <strong>Client ID</strong> y guárdalo aquí. Este flujo usa una ventana de Google y no pide Client Secret ni acceso a Drive.</li><li>Confirma tu contraseña y vincula la cuenta Google que utilizarás para entrar.</li></ol>
 <div className="help-links"><a className="action" href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Abrir Google Cloud<ExternalLink size={15}/></a><a className="action" href="https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid" target="_blank" rel="noopener noreferrer">Guía oficial<ExternalLink size={15}/></a></div>
 <form className="credential-form" onSubmit={e=>void submit(e,'configure')}><label htmlFor="google-client-id">Client ID de Google</label><input id="google-client-id" name="clientId" required maxLength={250} placeholder="…apps.googleusercontent.com" defaultValue={status.clientId}/><label htmlFor="google-config-password">Tu contraseña actual de ConectadOS</label><input id="google-config-password" name="password" type="password" required maxLength={128} autoComplete="current-password"/><button className="action" disabled={busy}>Guardar cliente de Google</button></form>
 {status.configured&&<GoogleSignIn mode="link"/>}</>}
 {status.linked&&<form className="credential-form" onSubmit={e=>void submit(e,'unlink')}><label htmlFor="google-unlink-password">Confirma tu contraseña para desvincular Google</label><input id="google-unlink-password" name="password" type="password" required maxLength={128} autoComplete="current-password"/><button className="action" disabled={busy}>Desvincular Google</button></form>}
 </>}<p className="sub">Cada instalación configura su propio cliente. Al publicar la aplicación habrá que registrar su dirección HTTPS y comprobar de nuevo el acceso.</p></section>;
}
