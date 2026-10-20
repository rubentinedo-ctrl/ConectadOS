import {readerConfiguration,privateObserverRead} from './private-reader.mjs';
import {recoverExport} from './recovery.mjs';
export const clientConfig=readerConfiguration;
export async function readExport(value,{now=Date.now,...transport}={}){
 try{
  const result=await privateObserverRead(value,'/api/export',transport),recovered=recoverExport(result.text),backup=JSON.parse(result.text),at=now();
  if(backup.exportedAt>at+30000||at-backup.exportedAt>120000)throw Error('Stale observer export');
  return {...result,exportedAt:backup.exportedAt,config:recovered.config,state:recovered.state};
 }catch{throw Error('Could not read a valid private observer export')}
}
