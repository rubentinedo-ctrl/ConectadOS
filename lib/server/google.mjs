import {OAuth2Client} from 'google-auth-library';
import {AppError} from './store.mjs';

export function validateGoogleIdentity(payload,clientId,nonce,now=Date.now()){
 if(!payload||!['accounts.google.com','https://accounts.google.com'].includes(payload.iss)||payload.aud!==clientId||payload.exp*1000<=now||!Number.isFinite(payload.exp)||payload.nonce!==nonce||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255||payload.email_verified!==true||typeof payload.email!=='string'||payload.email.length>320)throw new AppError('Google no pudo verificar esta identidad. Vuelve a comenzar.',403);
 return {sub:payload.sub,email:payload.email};
}
export async function verifyGoogleCredential(credential,clientId,nonce,client=new OAuth2Client({clientId,transporterOptions:{timeout:8000,retry:false}})){
 if(typeof credential!=='string'||credential.length>12000)throw new AppError('Respuesta de Google no válida.',403);
 try{const ticket=await client.verifyIdToken({idToken:credential,audience:clientId});return validateGoogleIdentity(ticket.getPayload(),clientId,nonce)}catch{throw new AppError('No se pudo verificar la respuesta de Google. Reintenta o usa tu contraseña.',403)}
}
