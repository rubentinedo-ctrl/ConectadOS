import {isIP} from 'node:net';import {AppError} from './store.mjs';import {providerJSON,safeText,domainName} from './provider-http.mjs';
export function cloudflareScope(value){if(value==='all')return value;if(typeof value==='string'&&/^[a-f0-9]{32}$/i.test(value))return value;throw new AppError('Usa el identificador de cuenta Cloudflare o all para las zonas autorizadas por el token.')}
async function pages(path,token,get,signal){
 const all=[],seen=new Set();
 for(let page=1;page<=100;page++){
  const params=new URLSearchParams({per_page:path.includes('/dns_records')?'100':'50',page:String(page)});const body=await get('Cloudflare',path+(path.includes('?')?'&':'?')+params,token,{signal});
  if(body?.success!==true||!Array.isArray(body.result))throw new AppError('Cloudflare no pudo devolver el inventario autorizado.',502);
  const info=body.result_info;if(!info||!Number.isSafeInteger(info.total_pages)||info.total_pages<0||info.total_pages>100||info.page!==page)throw new AppError('Cloudflare devolvió una paginación no compatible.',502);
  for(const row of body.result){const id=safeText(row?.id,100,token);if(!id||!/^[a-f0-9]{32}$/i.test(id)||seen.has(id))throw new AppError('Cloudflare devolvió identificadores ausentes o repetidos.',502);seen.add(id);all.push(row)}
  if(all.length>10000)throw new AppError('El inventario Cloudflare excede el límite de esta versión.',502);
  if(page>=info.total_pages)return all;
 }
 throw new AppError('No se completó la paginación Cloudflare; se conserva la lectura anterior.',502);
}
export async function collectCloudflare(token,scope,{get=providerJSON}={}){
 cloudflareScope(scope);const signal=AbortSignal.timeout(25000);
 const zones=await pages('/client/v4/zones'+(scope==='all'?'':'?account.id='+scope),token,get,signal);const resources=[],records=[];
 for(const zone of zones){
  const dns=await pages('/client/v4/zones/'+zone.id+'/dns_records',token,get,signal);const name=domainName(safeText(zone.name,253,token));if(!name)throw new AppError('Cloudflare devolvió un nombre de zona no compatible.',502);
  resources.push({id:zone.id,name,type:'zone',status:'zone:'+(safeText(zone.status,50,token)??'unknown'),recordCount:dns.length,paused:zone.paused===true});
  for(const row of dns){
   const type=safeText(row.type,30,token)??'UNKNOWN',name=domainName(safeText(row.name,253,token));if(!name)throw new AppError('Cloudflare devolvió un nombre DNS no compatible.',502);
   const raw=safeText(row.content,500,token);
   const value=['A','AAAA'].includes(type)&&isIP(raw??'')?raw:['CNAME','MX','NS'].includes(type)?domainName(raw):null;
   records.push({id:row.id,zoneId:zone.id,name,type,value,valueRedacted:value===null,proxied:typeof row.proxied==='boolean'?row.proxied:null,ttl:Number.isSafeInteger(row.ttl)?row.ttl:null,priority:Number.isSafeInteger(row.priority)?row.priority:null});
  }
  if(records.length>10000)throw new AppError('Los registros DNS exceden el límite de esta versión.',502);
 }
 return {resources,records,source:'https://api.cloudflare.com',checkedAt:Date.now(),expiresAt:Date.now()+1800000,coverage:'Zonas y registros DNS autorizados por el token. Destinos A/AAAA/CNAME/MX/NS; contenido de verificación omitido. DNS y zona activa no prueban disponibilidad de aplicaciones.'};
}
