import {AppError} from './store.mjs';import {providerJSON,safeText,domainName} from './provider-http.mjs';
export function vercelScope(value){if(value==='personal')return value;if(typeof value==='string'&&/^team_[A-Za-z0-9_-]{1,100}$/.test(value))return value;throw new AppError('Selecciona cuenta personal o el identificador team_ de tu equipo Vercel.')}
export async function listVercelTeams(token,{get=providerJSON}={}){
 const signal=AbortSignal.timeout(25000),teams=[],cursors=new Set();let cursor=null;
 for(let page=0;page<100;page++){
  const query=new URLSearchParams({limit:'100'});if(cursor!==null)query.set('until',String(cursor));
  const body=await get('Vercel','/v2/teams?'+query,token,{signal});
  if(!Array.isArray(body?.teams)||!body.pagination)throw new AppError('Vercel devolvió un formato de equipos no compatible.',502);
  for(const row of body.teams){const id=vercelScope(safeText(row?.id,100,token));if(teams.some(team=>team.id===id))throw new AppError('Vercel devolvió equipos repetidos.',502);teams.push({id,name:safeText(row.name,150,token)??'Equipo Vercel'})}
  const next=body.pagination.next;if(next===null||next===undefined)return teams;
  if(!Number.isSafeInteger(next)||next<0||cursors.has(next))throw new AppError('Vercel devolvió una paginación no compatible.',502);cursors.add(next);cursor=next;
 }
 throw new AppError('No se completó la lista de equipos Vercel.',502);
}
export async function collectVercel(token,scope,{get=providerJSON}={}){
 vercelScope(scope);const signal=AbortSignal.timeout(25000);const resources=[],seen=new Set(),cursors=new Set();let cursor=null;
 for(let page=0;page<100;page++){
  const params=new URLSearchParams({limit:'100'});if(scope!=='personal')params.set('teamId',scope);if(cursor!==null)params.set('until',String(cursor));
  const body=await get('Vercel','/v10/projects?'+params,token,{signal});
  if(!body||!Array.isArray(body.projects)||!body.pagination)throw new AppError('Vercel devolvió un formato de proyectos no compatible.',502);
  for(const row of body.projects){
   const id=safeText(row?.id,100,token);if(!id||seen.has(id))throw new AppError('Vercel devolvió identificadores ausentes o repetidos.',502);seen.add(id);
   const deployment=row.targets?.production;
   const aliases=Array.isArray(deployment?.alias)?deployment.alias.map(alias=>domainName(safeText(alias,253,token))).filter(Boolean):[];
   const state=safeText(deployment?.readyState,80,token)??'NO_PRODUCTION';
   resources.push({id,name:safeText(row.name,200,token)??'Proyecto sin nombre',type:'application',status:'deployment:'+state,domains:aliases,framework:safeText(row.framework,80,token),deploymentId:safeText(deployment?.id,100,token),deploymentAt:Number.isSafeInteger(deployment?.createdAt)?deployment.createdAt:null});
  }
  if(resources.length>10000)throw new AppError('El inventario Vercel excede el límite de esta versión.',502);
  const next=body.pagination.next;if(next===null||next===undefined)return {resources,source:'https://api.vercel.com',checkedAt:Date.now(),coverage:'Proyectos del equipo o cuenta seleccionados y estado del despliegue de producción. No incluye sondas, costos ni variables de entorno.'};
  if(!Number.isSafeInteger(next)||next<0||cursors.has(next))throw new AppError('Vercel devolvió una paginación no compatible.',502);cursors.add(next);cursor=next;
 }
 throw new AppError('No se completó la paginación Vercel; se conserva la lectura anterior.',502);
}
