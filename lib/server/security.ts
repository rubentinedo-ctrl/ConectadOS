import "server-only";
import {readJSONBody} from './request-body.mjs';
import {cookies} from 'next/headers';
import {Store,AppError} from './store.mjs';
import {readConfig,installationOrigin} from '@/scripts/config.mjs';
import {cookieNames,cookiePolicy} from './cookies.mjs';
const root=process.env.CONECTADOS_ROOT || process.cwd();
export function store(){return new Store(root)}
export const cookieName=cookieNames(root).session;
export const googleCookieName=cookieNames(root).google;
export async function sessionPolicy(){return cookiePolicy(root,await readConfig(root))}
export async function sessionToken(){const policy=await sessionPolicy(),jar=await cookies();return jar.get(policy.session)?.value??(!policy.secure?jar.get('conectados_session')?.value:undefined)}
export async function isAuthenticated(){const db=store();try{return db.authenticate(await sessionToken())}finally{db.close()}}
export async function origin(){const c=await readConfig(root);return installationOrigin(c)}
export async function guardRequest(request:Request){
 const expected=await origin();
 if(request.headers.get('origin')!==expected||request.headers.get('host')!==new URL(expected).host)throw new AppError('La solicitud debe venir de esta instalación.',403);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new AppError('Formato de solicitud no permitido.',415);
}
export async function readBody(request:Request,limit=16384,timeoutMs=5000):Promise<Record<string,unknown>>{return readJSONBody(request,limit,timeoutMs)}
export function response(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function errorResponse(error:unknown){return error instanceof AppError?response({error:error.message},error.status):response({error:'No se pudo completar la operación. Revisa la configuración del servidor.'},500)}
export async function setSession(token:string){const p=await sessionPolicy();(await cookies()).set(p.session,token,{httpOnly:true,sameSite:'strict',secure:p.secure,path:'/',maxAge:8*60*60})}
export async function clearSession(){const p=await sessionPolicy(),jar=await cookies();jar.set(p.session,'',{httpOnly:true,sameSite:'strict',secure:p.secure,path:'/',maxAge:0});if(!p.secure)jar.delete('conectados_session')}
