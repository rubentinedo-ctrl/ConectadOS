import {ExternalLink} from 'lucide-react';
import {dnsWebsiteURL} from '@/lib/domain-web.mjs';
type DomainNode={provider:string;name:string;type:string};
export function DomainWebsiteLink({name,type,privateNames=false,label='Abrir web'}:{name:string;type:string;privateNames?:boolean;label?:string}){
 if(privateNames)return null;
 const url=dnsWebsiteURL(name,type);
 return url?<a className="domain-web-link" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Abrir web de ${name} en otra pestaña`}>{label}<ExternalLink size={14}/></a>:null;
}
export function DomainWebLinks({nodes,privateNames}:{nodes:DomainNode[];privateNames:boolean}){
 if(privateNames)return null;
 const seen=new Set<string>(),sites=nodes.filter(n=>{if(n.provider!=='Cloudflare')return false;const url=dnsWebsiteURL(n.name,n.type);if(!url||seen.has(url))return false;seen.add(url);return true});
 if(!sites.length)return null;
 return <div className="domain-web-links"><h3>Probar webs de Cloudflare</h3><p>Abre el dominio en otra pestaña para comprobarlo. Un nombre DNS no garantiza que tenga una web; esto no cambia su estado en ConectadOS.</p><ul>{sites.map(n=><li key={dnsWebsiteURL(n.name,n.type)}><DomainWebsiteLink name={n.name} type={n.type} label={n.name}/></li>)}</ul></div>;
}
