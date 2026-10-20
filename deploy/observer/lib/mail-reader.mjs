import {privateObserverRead} from './private-reader.mjs';
import {mailAddress} from './mail-transport.mjs';
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const nullableTime=v=>v===null||time(v);
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const states=new Set(['planned','queued','sending','accepted','retryable','uncertain','failed','cancelled']);
export function validateMailReport(v,{now=Date.now()}={}){
 if(!exact(v,['version','status','configured','binding','revision','from','to','limit','remainingToday','receiptConfirmed','receiptAt','mutedUntil','items','coverage'])||v.version!==1||!['not-configured','waiting','review-required','paused','muted','active'].includes(v.status)||typeof v.configured!=='boolean'||typeof v.receiptConfirmed!=='boolean'||!nullableTime(v.receiptAt)||v.receiptAt!==null&&v.receiptAt>now+30000||!nullableTime(v.mutedUntil)||!Array.isArray(v.items)||v.items.length>50||typeof v.coverage!=='string'||v.coverage.length>512||Buffer.byteLength(JSON.stringify(v))>32768)throw Error('Invalid mail report');
 if(v.configured){if(!digest(v.binding)||v.revision!==null&&!uuid(v.revision)||mailAddress(v.from)!==v.from||mailAddress(v.to)!==v.to||!Number.isInteger(v.limit)||v.limit<1||v.limit>50||!Number.isInteger(v.remainingToday)||v.remainingToday<0||v.remainingToday>v.limit||v.status==='not-configured')throw Error('Invalid mail policy')}
 else if(v.status!=='not-configured'||['binding','revision','from','to','limit','remainingToday','receiptAt','mutedUntil'].some(k=>v[k]!==null)||v.receiptConfirmed||v.items.length)throw Error('Invalid absent mail configuration');
 if(v.receiptConfirmed?(v.receiptAt===null||v.revision===null):v.receiptAt!==null)throw Error('Invalid receipt proof');
 if(['active','muted'].includes(v.status)&&(!v.configured||!v.receiptConfirmed||v.revision===null)||v.status==='muted'&&!(v.mutedUntil>now-30000))throw Error('Invalid active policy');
 const ids=new Set();for(const r of v.items){
  if(!exact(r,['id','kind','eventAt','status','attempts','acceptedAt','currentConfiguration'])||!uuid(r.id)||ids.has(r.id)||!['test','issue','recovered'].includes(r.kind)||!states.has(r.status)||!time(r.eventAt)||r.eventAt>now+30000||!Number.isInteger(r.attempts)||r.attempts<0||r.attempts>3||!nullableTime(r.acceptedAt)||r.acceptedAt!==null&&(r.acceptedAt>now+30000||r.acceptedAt<r.eventAt)||typeof r.currentConfiguration!=='boolean'||(r.status==='accepted'?(r.acceptedAt===null||r.attempts===0):r.acceptedAt!==null))throw Error('Invalid mail intent');ids.add(r.id);
 }
 return v;
}
export async function readMailReport(value,{now=Date.now,...transport}={}){
 try{const result=await privateObserverRead(value,'/api/mail-report',{timeoutMs:5000,...transport});return {...result,report:validateMailReport(JSON.parse(result.text),{now:now()})}}
 catch{throw Error('Could not read valid private mail metadata')}
}
