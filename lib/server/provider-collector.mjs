import {AppError} from './store.mjs';import {collectVercel} from './vercel.mjs';import {collectCloudflare} from './cloudflare.mjs';import {collectSupabase} from './supabase.mjs';import {collectHostinger} from './hostinger.mjs';
export const providerCollectors={Vercel:collectVercel,Cloudflare:collectCloudflare,Supabase:collectSupabase,Hostinger:collectHostinger};
export async function refreshProvider(db,provider,{force=false,collect=providerCollectors[provider]}={}){
 if(!collect)throw new AppError('Conector no disponible.');
 const connection=db.providerConnections().find(row=>row.provider===provider);if(!connection?.hasToken)throw new AppError(`Configura primero ${provider}.`,409);
 const interval=provider==='Cloudflare'?600000:['Supabase','Hostinger'].includes(provider)?300000:60000;
 if(!force&&connection.attempted&&Date.now()-connection.attempted<interval-5000)return connection.error?{retryDeferred:true}:{cached:true};
 const lease=db.acquireProvider(provider);if(!lease)return {busy:true};const identity=db.credentialIdentity(provider);
 try{const token=db.credential(provider);const snapshot=await collect(token,connection.scope);db.saveProviderSnapshot(provider,connection.scope,snapshot,identity);return {updated:true}}
 catch(e){const safe=e instanceof AppError?e.message:`No se pudo consultar ${provider}.`;db.failProvider(provider,connection.scope,safe,identity);throw e instanceof AppError?e:new AppError(safe,502)}
 finally{db.releaseProvider(provider,lease)}
}
