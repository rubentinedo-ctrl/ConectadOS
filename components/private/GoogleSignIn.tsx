"use client";
import {useRef,useState,type FormEvent} from 'react';
type GoogleAPI={accounts:{id:{initialize(options:{client_id:string;nonce:string;callback:(result:{credential:string})=>void;ux_mode:'popup';auto_select:boolean}):void;renderButton(node:HTMLElement,options:{theme:string;size:string;text:string;locale:string}):void}}};
declare global{interface Window{google?:GoogleAPI}}
let loading:Promise<void>|undefined;
function loadGoogle(){
 if(window.google)return Promise.resolve();
 if(!loading)loading=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  const timer=setTimeout(()=>{script.remove();loading=undefined;reject(new Error('Google tardó demasiado. Reintenta o usa tu contraseña.'))},15000);
  script.onload=()=>{clearTimeout(timer);resolve()};script.onerror=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(new Error('No se pudo cargar Google. Revisa tu conexión o usa tu contraseña.'))};document.head.appendChild(script);
 });
 return loading;
}
export function GoogleSignIn({mode}:{mode:'login'|'link'}){
 const target=useRef<HTMLDivElement>(null);const [pending,setPending]=useState(false);const [message,setMessage]=useState('');
 async function start(e:FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget;const password=new FormData(form).get('password');setPending(true);setMessage('Preparando acceso con Google…');
  try{
   const r=await fetch('/api/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'begin',mode,password})});const flow=await r.json();form.reset();if(!r.ok)throw new Error(flow.error);
   await loadGoogle();if(!window.google||!target.current)throw new Error('No se pudo preparar el botón de Google.');
   window.google.accounts.id.initialize({client_id:flow.clientId,nonce:flow.nonce,ux_mode:'popup',auto_select:false,callback:result=>{void complete(result.credential,flow.nonce)}});
   target.current.replaceChildren();window.google.accounts.id.renderButton(target.current,{theme:'outline',size:'large',text:'continue_with',locale:'es'});
   setMessage('Pulsa el botón de Google y elige tu cuenta. Si cancelas, puedes volver a preparar el acceso.');
  }catch(e){setMessage(e instanceof Error?e.message:'No se pudo preparar Google.')}finally{setPending(false)}
 }
 async function complete(credential:string,nonce:string){
  setPending(true);setMessage('Verificando tu identidad…');
  try{const r=await fetch('/api/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'complete',credential,nonce})});const data=await r.json();if(!r.ok)throw new Error(data.error);window.location.assign('/')}catch(e){target.current?.replaceChildren();setMessage(e instanceof Error?e.message:'No se pudo verificar Google.')}finally{setPending(false)}
 }
 return <div className="google-signin"><form onSubmit={start}>
 {mode==='link'&&<><label htmlFor="google-link-password">Confirma tu contraseña de ConectadOS para vincular Google</label><input id="google-link-password" name="password" type="password" required maxLength={128} autoComplete="current-password"/></>}
 <button className="action" disabled={pending}>{pending?'Preparando…':mode==='link'?'Preparar vinculación con Google':'Preparar acceso con Google'}</button>
 </form><div ref={target} className="google-button-target"/><p role="status" className="sub">{message}</p><small>Google solo verificará tu identidad. Si el navegador integrado bloquea el acceso, abre esta instalación en Chrome.</small></div>;
}
