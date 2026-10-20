import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {readConfig} from './scripts/config.mjs';
import {securityHeaders} from './lib/server/headers.mjs';
export async function proxy(request:NextRequest){
 try{const c=await readConfig(process.env.CONECTADOS_ROOT||process.cwd()),nonce=randomBytes(24).toString('base64'),headers=securityHeaders(nonce,{server:c.mode==='server',development:process.env.NODE_ENV==='development'}),requestHeaders=new Headers(request.headers);
 requestHeaders.set('x-nonce',nonce);requestHeaders.set('Content-Security-Policy',headers['Content-Security-Policy']);const response=NextResponse.next({request:{headers:requestHeaders}});for(const [name,value] of Object.entries(headers))response.headers.set(name,value);return response;
 }catch{return NextResponse.json({error:'Configuración de la instalación no disponible.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
