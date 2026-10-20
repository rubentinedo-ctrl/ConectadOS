import {AppError} from '@/lib/server/store.mjs';
import {decodeLogoInput,normalizeLogo,logoBodyLimit} from '@/lib/server/logos.mjs';
import {store,guardRequest,readBody,response,errorResponse,sessionToken} from '@/lib/server/security';
export const runtime='nodejs';
export async function GET(request:Request){
 try{const db=store();try{
  if(!db.authenticate(await sessionToken()))throw new AppError('Inicia sesión.',401);
  const ref=new URL(request.url).searchParams.get('ref');
  if(!ref)throw new AppError('Logo no encontrado.',404);
  const bytes=db.resourceLogo(ref);
  return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }finally{db.close()}}catch(e){return errorResponse(e)}
}
export async function POST(request:Request){
 try{await guardRequest(request);const db=store();try{
  const session=await sessionToken();if(!db.authenticate(session))throw new AppError('Inicia sesión.',401);
  db.takeAttempt('resource_logos',10,60000);
  const body=await readBody(request,logoBodyLimit),provider=String(body.provider),resourceId=String(body.resourceId);
  const ref=db.resourceLogoBinding(provider,resourceId);
  if(body.action==='save'){
   const lease=db.acquireProvider('_logo_processing');if(!lease)throw new AppError('Hay otra imagen procesándose. Espera un momento antes de guardar.',409);
   try{
    const content=await normalizeLogo(decodeLogoInput(body.image));
    if(!db.authenticate(session))throw new AppError('La sesión caducó durante la carga.',401);
    db.saveResourceLogo(provider,resourceId,content,ref);
   }finally{db.releaseProvider('_logo_processing',lease)}
  }else if(body.action==='remove')db.deleteResourceLogo(provider,resourceId);
  else throw new AppError('Acción no válida.');
  return response({logos:db.resourceLogoMetadata()});
 }finally{db.close()}}catch(e){return errorResponse(e)}
}
