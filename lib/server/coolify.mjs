import {BlockList,isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {AppError} from './store.mjs';
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
export function publicIPv4(address){return isIP(address)===4&&!blocked.check(address,'ipv4')}
export function coolifyURL(value){
 let url;try{if(typeof value!=='string'||value.length>500)throw new Error();url=new URL(value)}catch{throw new AppError('Introduce la dirección HTTPS de tu panel Coolify.')}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname)||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.startsWith('[')||isIP(url.hostname)!==0)throw new AppError('Usa un dominio HTTPS, sin credenciales, puerto, rutas ni parámetros.');
 return url.origin;
}
async function publicAddresses(hostname,resolve){
 let timer;try{
  const result=await Promise.race([resolve(hostname,{family:4,all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('dns timeout')),8000)})]);
  if(!Array.isArray(result)||!result.length||result.some(row=>row.family!==4||!publicIPv4(row.address)))throw new AppError('La dirección debe resolver únicamente a IPv4 públicas.',400);
  return result;
 }finally{clearTimeout(timer)}
}
function getJSON(url,token,addresses,request,{signal,rate}={}){
 return new Promise((resolve,reject)=>{
  if(rate?.remaining<1){reject(new AppError('Coolify no tiene consultas disponibles en esta ventana. Se conservaron las lecturas anteriores.',502));return}
  if(rate&&Number.isFinite(rate.remaining))rate.remaining--;
  const abort=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);
  const req=request(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:abort,lookup:(_host,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,4)}},res=>{
   const status=res.statusCode??0;
   const remaining=Number(res.headers['x-ratelimit-remaining']);if(rate&&Number.isInteger(remaining)&&remaining>=0)rate.remaining=Math.min(rate.remaining,remaining);
   if(status!==200){res.resume();const message=status===401?'Token de Coolify vencido o no válido.':status===403?'El token no tiene permiso para consultar estos recursos.':status===429?'Coolify limitó las consultas. Espera antes de reintentar.':status>=300&&status<400?'Coolify redirigió la consulta. Revisa la dirección; no se reenvió el token.':'Coolify no pudo devolver el inventario.';reject(new AppError(message,502));return}
   if(!String(res.headers['content-type']??'').includes('application/json')){res.resume();reject(new AppError('Coolify devolvió un formato distinto de JSON.',502));return}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(new AppError('El inventario excede el límite de esta versión.',502));return}chunks.push(chunk)});
   res.on('error',()=>reject(new AppError('La respuesta de Coolify se interrumpió.',502)));
   res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new AppError('Coolify devolvió un JSON no válido.',502))}});
  });
  req.on('error',()=>reject(new AppError('No se pudo conectar con Coolify. Revisa dirección, certificado y acceso a la API.',502)));req.end();
 });
}
export function normalizeResources(value,token=''){
 if(!Array.isArray(value)||value.length>10000)throw new AppError('Formato de inventario no compatible; no se reemplazaron tus datos anteriores.',502);
 const text=(v,max)=>typeof v==='string'&&v.length<=max&&(!token||!v.includes(token))?v:null;
 const seen=new Set();return value.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw new AppError('El inventario contiene un recurso no compatible.',502);
  const id=text(row.uuid,100);if(!id||seen.has(id))throw new AppError('El inventario contiene identificadores ausentes o duplicados.',502);seen.add(id);
  return {id,name:text(row.name,200)??'Recurso sin nombre',type:text(row.type,100)??'Tipo no informado',status:text(row.status,150)??'Estado no informado'};
 });
}
export function normalizeCoolifyServer(raw,id,token='',now=Date.now()){
 if(!raw||Array.isArray(raw)||raw.uuid!==id||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new AppError('Coolify devolvió otro servidor o un formato no compatible.',502);
 const name=typeof raw.name==='string'&&raw.name.length<=200&&(!token||!raw.name.includes(token))?raw.name:'Servidor de Coolify';
 const flag=v=>typeof v==='boolean'?v:null;
 return {id,name,reachable:flag(raw.is_reachable??raw.settings?.is_reachable),usable:flag(raw.is_usable??raw.settings?.is_usable),sentinelEnabled:flag(raw.settings?.is_sentinel_enabled),sentinelMetricsEnabled:flag(raw.settings?.is_metrics_enabled),checkedAt:now};
}
export async function inspectCoolifyServer(value,token,id,{resolve=lookup,request=httpsRequest}={}){
 const url=coolifyURL(value);if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)||typeof token!=='string'||!token||/[\r\n]/.test(token))throw new AppError('Acceso o servidor de Coolify no válido.',409);
 try{const addresses=await publicAddresses(new URL(url).hostname,resolve),source=new URL('/api/v1/servers/'+id,url),raw=await getJSON(source,token,addresses,request,{signal:AbortSignal.timeout(10000)});return {...normalizeCoolifyServer(raw,id,token),source:source.href}}
 catch(e){throw e instanceof AppError?e:new AppError('No se pudo comprobar el servidor de Coolify.',502)}
}
export function normalizeServiceComponents(value,serviceId,token=''){
 const text=(v,max)=>typeof v==='string'&&v.length<=max&&(!token||!v.includes(token))?v:null;
 if(!value||typeof value!=='object'||Array.isArray(value)||value.uuid!==serviceId||!Array.isArray(value.applications)||!Array.isArray(value.databases)||value.applications.length+value.databases.length>500)throw new AppError('Detalle de servicio no compatible o de otro recurso. Se conservó la lectura anterior.',502);
 const seen=new Set();return [['application',value.applications],['database',value.databases]].flatMap(([type,rows])=>rows.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw new AppError('Componente de servicio no compatible.',502);
  const id=text(row.uuid,100);if(!id||!/^[a-zA-Z0-9_-]+$/.test(id)||seen.has(id))throw new AppError('Componentes sin identificador válido o duplicados.',502);seen.add(id);
  const image=text(row.image,250);
  return {id,name:text(row.human_name,200)||text(row.name,200)||'Componente sin nombre',type,status:text(row.status,150)||'Estado no informado',image:image&&/^(?:[a-zA-Z0-9.-]+(?::[0-9]+)?\/)?[a-z0-9]+(?:[._\/-][a-z0-9]+)*(?::[A-Za-z0-9_.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/.test(image)?image:null,excludedFromStatus:row.exclude_from_status===true};
 }));
}
export function normalizeDeploymentCount(value){
 if(!value||Array.isArray(value)||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.deployments)||value.deployments.length>1||value.count===0&&value.deployments.length!==0||value.count>0&&value.deployments.length!==1)throw new AppError('El historial de despliegues no permite confirmar la clasificación.',502);
 return value.count;
}
function previousServiceDetail(previous,serviceId,source,token,now){
 const old=previous?.serviceDetails?.find(d=>d.serviceId===serviceId&&d.source===source);
 if(!old||!Array.isArray(old.components)||!Number.isSafeInteger(old.attemptedAt)||old.attemptedAt>now||old.checkedAt!==null&&(!Number.isSafeInteger(old.checkedAt)||old.checkedAt>now))return null;
 try{
  const rows=type=>old.components.filter(c=>c.type===type).map(c=>({uuid:c.id,name:c.name,status:c.status,image:c.image,exclude_from_status:c.excludedFromStatus}));
  if(old.components.some(c=>!['application','database'].includes(c.type)))return null;
  const components=normalizeServiceComponents({uuid:serviceId,applications:rows('application'),databases:rows('database')},serviceId,token);
  return {serviceId,components,checkedAt:old.checkedAt,expiresAt:old.checkedAt===null?null:old.checkedAt+900000,attemptedAt:old.attemptedAt,source,error:typeof old.error==='string'&&old.error.length<=300&&!old.error.includes(token)?old.error:null};
 }catch{return null}
}
export async function collectCoolify(value,token,{resolve=lookup,request=httpsRequest,previous=null,forceDetails=false,detailIds=null}={}){
 const url=coolifyURL(value);if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw new AppError('Guarda un token de Coolify válido.',409);
 try{
  const signal=AbortSignal.timeout(25000),rate={remaining:Infinity};
  const addresses=await publicAddresses(new URL(url).hostname,resolve),json=await getJSON(new URL('/api/v1/resources',url),token,addresses,request,{signal,rate});
  const resources=normalizeResources(json,token),checkedAt=Date.now(),services=resources.filter(r=>r.type==='service'),serviceDetails=new Array(services.length);
  const priorDetails=new Map(services.map(service=>[service.id,previousServiceDetail(previous?.source===url?previous:null,service.id,new URL('/api/v1/services/'+encodeURIComponent(service.id),url).href,token,checkedAt)]));
  let cursor=0,totalComponents=[...priorDetails.values()].reduce((total,detail)=>total+(detail?.components.length??0),0),stopReason=null;
  if(totalComponents>10000)throw new AppError('Los componentes anteriores exceden el límite de esta versión. No se reemplazó el inventario.',502);
  async function worker(){while(cursor<services.length){
   const index=cursor++,service=services[index],source=new URL('/api/v1/services/'+encodeURIComponent(service.id),url).href;
   const old=priorDetails.get(service.id);
   if(detailIds&&!detailIds.includes(service.id)){serviceDetails[index]=old??{serviceId:service.id,source,components:[],checkedAt:null,expiresAt:null,attemptedAt:checkedAt,error:'Detalle no solicitado en este diagnóstico.'};continue}
   if(!forceDetails&&old&&checkedAt-old.attemptedAt<300000){serviceDetails[index]=old;continue}
   const failure=message=>({...old,serviceId:service.id,source,components:old?.components??[],checkedAt:old?.checkedAt??null,expiresAt:old?.expiresAt??null,attemptedAt:Date.now(),error:message});
   if(index>=100||stopReason||signal.aborted){serviceDetails[index]=failure(stopReason??'No se consultó este servicio: límite de tiempo o de 100 servicios por ciclo.');continue}
   try{
    const detail=await getJSON(new URL(source),token,addresses,request,{signal,rate}),components=normalizeServiceComponents(detail,service.id,token);
    if(totalComponents-(old?.components.length??0)+components.length>10000)throw new AppError('Los componentes exceden el límite de 10.000 por ciclo.',502);
    totalComponents+=components.length-(old?.components.length??0);const at=Date.now();serviceDetails[index]={serviceId:service.id,components,source,checkedAt:at,expiresAt:at+900000,attemptedAt:at,error:null};
   }catch(e){const message=e instanceof AppError?e.message:'No se pudo consultar el detalle del servicio.';serviceDetails[index]=failure(message);if(rate.remaining<1||message.includes('limitó las consultas')||message.includes('Token de Coolify'))stopReason=message}
  }}
  const pending=resources.filter(r=>r.type==='application'&&/^(exited|stopped)(:|$)/.test(r.status)),applicationDeployments=new Array(pending.length);let nextApplication=0;
  async function deploymentWorker(){while(nextApplication<pending.length){
   const i=nextApplication++,r=pending[i],source=new URL('/api/v1/deployments/applications/'+encodeURIComponent(r.id)+'?skip=0&take=1',url).href;
   const failure=()=>({applicationId:r.id,count:null,source,checkedAt:null,expiresAt:null,error:'No se pudo verificar el historial. No se clasifica como preparada.'});
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(r.id)||i>=20||signal.aborted||rate.remaining<1){applicationDeployments[i]=failure();continue}
   try{const raw=await getJSON(new URL(source),token,addresses,request,{signal,rate}),count=normalizeDeploymentCount(raw),at=Date.now();applicationDeployments[i]={applicationId:r.id,count,source,checkedAt:at,expiresAt:at+300000,error:null}}
   catch{applicationDeployments[i]=failure()}
  }}
  await Promise.all([...Array.from({length:Math.min(3,services.length)},()=>worker()),...Array.from({length:Math.min(2,pending.length)},()=>deploymentWorker())]);
  return {resources,serviceDetails,applicationDeployments,source:url,checkedAt,coverage:'Inventario y componentes de Coolify; historial de hasta 20 aplicaciones sin arrancar para distinguir cero despliegues registrados. GET únicamente, fechas y errores propios. No incluye sondas ni pruebas de base de datos.'};
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('No se pudo resolver o consultar Coolify. Revisa su dirección y vuelve a probar.',502)}
}
