import {AppError} from './store.mjs';
import {providerJSON,safeText} from './provider-http.mjs';
export function supabaseScope(value){if(value==='all')return value;throw new AppError('Selecciona all para los proyectos Cloud autorizados por tu token.');}
export async function collectSupabase(token,scope,{get=providerJSON}={}){
 supabaseScope(scope);const value=await get('Supabase','/v1/projects',token);
 if(!Array.isArray(value)||value.length>10000)throw new AppError('Supabase devolvió un inventario no compatible; se conserva la lectura anterior.',502);
 const seen=new Set();const resources=value.map(row=>{
  const id=safeText(row?.id,100,token);if(!id||!/^[a-z0-9]{20}$/.test(id)||seen.has(id))throw new AppError('Supabase devolvió identificadores ausentes o repetidos.',502);seen.add(id);
  return {id,name:safeText(row.name,200,token)??'Proyecto sin nombre',type:'cloud-project',status:'project:'+(safeText(row.status,100,token)??'UNKNOWN'),region:safeText(row.region,100,token),organizationId:safeText(row.organization_id,100,token),databaseVersion:safeText(row.database?.version,100,token)};
 });
 const checkedAt=Date.now();return {resources,source:'https://api.supabase.com',checkedAt,expiresAt:checkedAt+900000,coverage:'Proyectos Supabase Cloud autorizados y estado declarado por Management API. No incluye consultas SQL, Auth, Storage, claves de proyecto ni costos. Supabase en el VPS pertenece al inventario Coolify.'};
}
