import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,AppError} from './store.mjs';
import {readConfig,installationOrigin} from '../../scripts/config.mjs';
// Filesystem fallback; the optional public email flow uses a separately verified destination.
export async function issueRecoveryCode(root,{minutes=15}={}){
 if(!path.isAbsolute(root)||!Number.isInteger(minutes)||minutes<5||minutes>30)throw new AppError('Usa una carpeta absoluta y una caducidad de 5 a 30 minutos.');
 const config=await readConfig(root),db=new Store(root),file=path.join(root,'.keys','account-recovery-'+randomUUID()+'.json');let saved=false,written=false;
 try{
  const stamp=db.ownerStamp();if(!stamp)throw new AppError('Crea primero la cuenta administradora.',409);
  const code=randomBytes(32).toString('base64url'),created=Date.now(),expires=created+minutes*60000;
  const username=db.db.prepare('SELECT username FROM owner WHERE id=1').get().username;
  await writeFile(file,JSON.stringify({version:1,code,username,expiresAt:new Date(expires).toISOString(),origin:installationOrigin(config)},null,2)+'\n',{mode:0o600,flag:'wx'});written=true;
  db.db.exec('BEGIN IMMEDIATE');try{
   if(db.ownerStamp()!==stamp)throw new AppError('La cuenta cambió mientras se preparaba el código.',409);
   db.db.prepare('INSERT INTO account_recovery VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,owner_stamp=excluded.owner_stamp,created=excluded.created,expires=excluded.expires').run(createHash('sha256').update(code).digest('hex'),stamp,created,expires);
   db.clearAttempts('recovery');db.record('owner_recovery_prepared');db.db.exec('COMMIT');saved=true;
  }catch(e){db.db.exec('ROLLBACK');throw e}
  return {file,expiresAt:new Date(expires).toISOString()};
 }finally{db.close();if(written&&!saved)await rm(file,{force:true})}
}
