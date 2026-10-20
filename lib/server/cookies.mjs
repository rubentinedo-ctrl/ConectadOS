import {createHash} from 'node:crypto';
import path from 'node:path';
// Local cookies isolate folders sharing a hostname. HTTPS uses __Host- cookies.
export function cookieNames(root,secure=false){const suffix=createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,16),prefix=secure?'__Host-':'';return {session:prefix+'conectados_session_'+suffix,google:prefix+'conectados_google_flow_'+suffix}}
export function cookiePolicy(root,config){const secure=config.mode==='server';return {...cookieNames(root,secure),secure,httpOnly:true,sameSite:'strict',path:'/',googlePath:secure?'/':'/api/google'}}
