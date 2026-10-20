import {Mail,Inbox,ShieldCheck,Clock3} from 'lucide-react';
import './monitoring.css';
import {ProviderLogo} from '@/components/ProviderLogo';
import type {ExternalMailObservation} from '@/lib/external-observer-types';
const readerLabels={unconfigured:'Sin conexión',disabled:'Lectura apagada',paused:'Lector pausado',error:'Lectura fallida',waiting:'Esperando lectura',stale:'Lectura vencida',observed:'Lectura actual'};
const policyLabels={'not-configured':'Acceso de envío pendiente',waiting:'Configuración por revisar','review-required':'Revisión requerida',paused:'Envíos pausados',muted:'Silencio temporal',active:'Automáticos habilitados'};
const kindLabels={test:'Prueba solicitada',issue:'Comprobación para revisar',recovered:'Respuesta restablecida'};
const intentLabels={planned:'Prueba preparada',queued:'En cola',sending:'Intento registrado',accepted:'Aceptado por API',retryable:'Reintento acotado',uncertain:'Resultado incierto',failed:'No aceptado',cancelled:'Cancelado'};
const stamp=(at:number|null|undefined)=>at==null?'Sin fecha':new Date(at).toLocaleString('es');
export function ExternalMail({mail,now}:{mail?:ExternalMailObservation;now:number}){
 const value=mail?.report,fresh=mail?.status==='observed'&&mail.attempted!==null&&mail.attempted<=now+30000&&now-mail.attempted<=180000&&!(value?.status==='muted'&&value.mutedUntil!==null&&value.mutedUntil<=now);
 const label=fresh&&value?policyLabels[value.status]:mail?readerLabels[mail.status==='observed'?'stale':mail.status]:'Sin lectura del canal';
 return <section className={'external-mail '+(fresh?'current':'outdated')} aria-labelledby="external-mail-title">
  <header><Mail size={21}/><div><span className="control-eyebrow">CORREO DESDE VERCEL</span><h3 id="external-mail-title">Avisos independientes del VPS</h3></div><strong className={'external-stamp '+(fresh&&value?.status==='active'?'':'inactive')}>{label}</strong></header>
  <p>El envío ocurre fuera del VPS. Esta vista consulta su política e historial mediante la clave de lectura; no crea accesos ni manda correos.</p>
  <div className="external-mail-line" aria-hidden="true"><span><ProviderLogo provider="Vercel" size={21}/><small>Observador</small></span><i/><span><ProviderLogo provider="Resend" size={21}/><small>Canal de correo</small></span><i/><span><Inbox size={21}/><small>Un destinatario</small></span></div>
  {!fresh&&<p className="external-mail-note">No hay un estado actual comprobado del canal. La evidencia guardada conserva su fecha; no confirma que puedas recibir avisos ahora.</p>}
  {fresh&&value&&!value.configured&&<div className="external-mail-note"><ShieldCheck size={17}/><p>El instalador debe preparar una clave exclusiva de Resend, fijar remitente y destinatario y comprobar una prueba en el buzón. El inventario y los avisos usan accesos independientes. <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">Ver dónde se crea el acceso de envío</a></p></div>}
  {value?.configured&&<dl><dt>{fresh?'Remitente configurado':'Remitente en la evidencia guardada'}</dt><dd>{value.from}</dd><dt>Destinatario fijo</dt><dd>{value.to}</dd><dt>Intentos restantes en la lectura</dt><dd>{value.remainingToday} de {value.limit} diarios</dd><dt>Recepción de la prueba</dt><dd>{value.receiptConfirmed?'Confirmada · '+stamp(value.receiptAt):'Pendiente de confirmar en el buzón'}</dd>{value.mutedUntil!==null&&<><dt>Silencio guardado hasta</dt><dd>{stamp(value.mutedUntil)}</dd></>}</dl>}
  <p className="external-mail-evidence"><Clock3 size={13}/>Última lectura del canal: <time>{stamp(mail?.attempted)}</time></p>
  <p role="alert" className="form-error">{mail?.error}</p>
  <details className="external-mail-history"><summary>{value?.items.length??0} solicitudes en la evidencia guardada</summary>
   <p>«Aceptado por API» confirma la respuesta de Resend. La recepción de la prueba se confirma aparte; los avisos de incidentes no tienen comprobación de entrega en este módulo.</p>
   {value?.items.length?<ol>{value.items.map(item=><li key={item.id}><div><strong>{kindLabels[item.kind]}</strong><span className={'external-mail-result '+item.status}>{intentLabels[item.status]}</span></div><small>{stamp(item.eventAt)} · {item.attempts} intentos{item.acceptedAt!==null?' · API: '+stamp(item.acceptedAt):''}{!item.currentConfiguration?' · Configuración anterior':''}</small></li>)}</ol>:<p>No hay solicitudes guardadas en esta lectura. Una lista vacía no demuestra recepción de avisos.</p>}
  </details>
  <small className="external-mail-source">Fuente privada: {mail?.source??'Sin conectar'}. Esta conexión no administra la política remota; activar la lectura no habilita envíos.</small>
 </section>;
}
