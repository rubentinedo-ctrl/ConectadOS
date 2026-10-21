import {inventoryConnectors,manualPlatformExamples,optionalConnections,connectionBoundary} from '@/lib/connection-catalog.mjs';
import {ProviderLogo} from './ProviderLogo';

export function ConnectionCatalog({compact=false,links=true}:{compact?:boolean;links?:boolean}){
 return <section className={`connection-catalog${compact?' is-compact':''}`} aria-label="Plataformas compatibles">
  <div className="catalog-heading"><span>PRIMEROS PASOS</span><h2>Qué puedes conectar en esta versión</h2><p>{connectionBoundary}</p></div>
  {compact?<><div className="catalog-chips">{inventoryConnectors.map(p=><span key={p.name}><ProviderLogo provider={p.name} size={18}/>{p.name}</span>)}</div><p>Conectores de inventario disponibles. Necesitan tus accesos y una consulta correcta; todavía no están conectados.</p></>:<div className="catalog-grid">{inventoryConnectors.map(p=><article key={p.name}><h3><ProviderLogo provider={p.name} size={22}/>{p.name}</h3><span className="catalog-badge">Conector de inventario disponible</span><p>{p.scope}</p><small><strong>Necesitas:</strong> {p.needs}</small><small>{p.limit}</small>{links&&<a href={p.href}>Configurar {p.name} ↗</a>}</article>)}</div>}
  <div className="catalog-manual"><strong>Registro manual · sin consulta automática</strong><p>{manualPlatformExamples.join(', ')} y otras plataformas pueden guardarse como fichas con enlace y aplicación relacionada. No tienen conector API en esta versión; una ficha no confirma su salud.</p>{links&&!compact&&<a href="/#platforms">Registrar otra plataforma ↗</a>}</div>
  {!compact&&<details><summary>Correo, copias e IA: funciones opcionales separadas</summary><ul>{optionalConnections.map(p=><li key={p.name}><strong>{p.name}:</strong> {p.purpose} {p.limit}</li>)}</ul></details>}
 </section>;
}
