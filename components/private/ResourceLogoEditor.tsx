"use client";
import {useRef,useState,type FormEvent} from 'react';
import {ImagePlus,Upload,Trash2} from 'lucide-react';
import type {ObservedProvider,ResourceLogo} from '@/lib/infrastructure-types';
export function ResourceLogoEditor({provider,resourceId,logo,onSaved}:{provider:ObservedProvider;resourceId:string;logo?:ResourceLogo;onSaved:()=>Promise<void>}){
 const input=useRef<HTMLInputElement>(null),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 function choose(value:File|null){
  setMessage('');setError('');
  if(value&&(value.size>512*1024||!['image/png','image/jpeg','image/webp'].includes(value.type))){setFile(null);if(input.current)input.current.value='';setError('Usa PNG, JPEG o WebP de hasta 512 KB.');return}
  setFile(value);
 }
 async function update(action:'save'|'remove'){
  setBusy(true);setMessage('');setError('');
  try{
   const image=action==='save'&&file?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('No se pudo leer el archivo.'));reader.readAsDataURL(file)}):undefined;
   const response=await fetch('/api/logos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,provider,resourceId,image})});
   const data=await response.json();if(!response.ok)throw new Error(data.error);
   await onSaved();setFile(null);if(input.current)input.current.value='';setMessage(action==='save'?'Logo guardado en esta instalación.':'Logo quitado. Se muestra el icono de la categoría.');
  }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el logo.')}finally{setBusy(false)}
 }
 function submit(event:FormEvent){event.preventDefault();if(file)void update('save')}
 return <details className="resource-logo-editor"><summary><ImagePlus size={16}/>{logo?'Cambiar logo propio':'Añadir logo propio'}</summary><form onSubmit={submit}><p>Elige el logo de esta aplicación o recurso. Se guarda en tu instalación y se oculta en modo presentación. No cambia su estado ni el logo del proveedor.</p><label>Imagen del recurso<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>choose(event.target.files?.[0]??null)}/></label><small>PNG, JPEG o WebP estático · máximo 512 KB y 2048 × 2048 píxeles. Se reduce a 128 px y se eliminan sus metadatos.</small><div><button className="action" disabled={busy||!file} type="submit"><Upload size={14}/>{busy?'Procesando…':'Guardar logo'}</button>{logo?<button className="action" disabled={busy} type="button" onClick={()=>void update('remove')}><Trash2 size={14}/>Quitar logo</button>:null}</div>{error?<p className="logo-error" role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}</form></details>;
}
