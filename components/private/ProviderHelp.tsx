import { ExternalLink, BookOpen, KeyRound } from 'lucide-react';
import type { ProviderGuide } from '@/lib/provider-guides';

export function ProviderHelp({provider, guide}: {provider: string; guide: ProviderGuide}) {
  const inventory=['Coolify','Vercel','Cloudflare','Supabase','Hostinger'].includes(provider),available=inventory||provider==='Resend';
  return <aside className="provider-help" aria-labelledby="provider-help-title">
    <div className="help-heading"><KeyRound size={18}/><h3 id="provider-help-title">Cómo preparar {provider}</h3><span>{available?'Configuración disponible':'Implementación pendiente'}</span></div>
    <p>{guide.purpose}</p>
    <p><strong>Dato necesario:</strong> {guide.credential}.</p>
    <div className="help-links">
      {guide.portal && <a className="action help-primary" href={guide.portal} target="_blank" rel="noopener noreferrer">Abrir página de credenciales<ExternalLink size={15}/><span className="sr-only"> (nueva pestaña)</span></a>}
      <a className="action" href={guide.docs} target="_blank" rel="noopener noreferrer"><BookOpen size={15}/>Guía oficial<span className="sr-only"> (nueva pestaña)</span></a>
    </div>
    <ol>{guide.steps.map(step=><li key={step}>{step}</li>)}</ol>
    <p className="help-permissions"><strong>Permisos:</strong> {guide.permissions}</p>
    <p>{guide.note}</p>
    <p className="help-status">{inventory?'El conector de inventario está disponible. Configura el token y su alcance en la sección indicada y consulta para comprobar el acceso. Guardarlo por sí solo no verifica la conexión.':provider==='Resend'?'Guarda la clave de envío y prepara Avisos por correo en el panel de infraestructura. El canal necesita una prueba y tu activación explícita para enviar avisos.':'La autorización de Drive todavía no está implementada. Aquí no se solicita una clave manual.'}</p>
  </aside>;
}
