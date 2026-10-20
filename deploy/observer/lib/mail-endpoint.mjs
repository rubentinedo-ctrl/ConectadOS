import {authorized} from './endpoint.mjs';
import {configuration} from './monitor.mjs';
import {mailConfiguration,mailReport,validateMailState,prepareMail,planMailTest,dispatchMailTest,confirmMailReceipt,setMailPolicy,mailTick} from './mail.mjs';

const keys=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
const validSecret=value=>typeof value==='string'&&value.length>=32&&value.length<=512&&!/[\r\n]/.test(value);
function controlAccess(env,header){
 const secret=env.OBSERVER_MAIL_CONTROL_SECRET;
 return validSecret(secret)&&![env.CRON_SECRET,env.OBSERVER_REPORT_SECRET,env.OBSERVER_MAIL_KEY,env.OBSERVER_MAIL_INSTANCE].includes(secret)&&authorized(header,secret);
}
function controlBody(req){
 if(req.headers?.origin||req.headers?.['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error('Invalid request');
 let value=req.body;if(typeof value==='string'){if(Buffer.byteLength(value)>2048)throw Error('Invalid request');value=JSON.parse(value)}
 if(!value||Buffer.byteLength(JSON.stringify(value))>2048||value.consent!==true)throw Error('Invalid request');
 const fields={prepare:['action','revision','consent'],plan:['action','revision','consent'],send:['action','revision','consent','id'],receipt:['action','revision','consent','id','code'],policy:['action','revision','consent','active','mutedUntil']};
 if(!keys(value,fields[value.action]??[])||value.revision!==null&&(typeof value.revision!=='string'||value.revision.length!==36))throw Error('Invalid request');
 return value;
}
// Server-to-server control only. A read or cron secret can never send or activate mail.
// Sender, recipient, body and provider access cannot be supplied by a request.
export function mailEndpoint(kind,{store,env=process.env,now=Date.now,send,record=value=>console.info(JSON.stringify(value))}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');const reply=(code,value)=>res.status(code).json(value);
  if(req.method!==(kind==='control'?'POST':'GET'))return reply(405,{error:'Method not allowed'});
  if(Object.keys(req.query??{}).length)return reply(400,{error:'No parameters accepted'});
  const access=kind==='control'?controlAccess(env,req.headers?.authorization):validSecret(env.CRON_SECRET)&&env.CRON_SECRET!==env.OBSERVER_REPORT_SECRET&&authorized(req.headers?.authorization,env.OBSERVER_REPORT_SECRET);
  if(!access)return reply(401,{error:'Unauthorized'});
  let request;if(kind==='control'){try{request=controlBody(req)}catch{return reply(400,{error:'Invalid mail request'})}}
  try{
   const config=configuration(env),cfg=mailConfiguration(env,config);
   if(!cfg)return kind==='report'?reply(200,mailReport(null,null,{now:now()})):reply(409,{error:'Mail is not configured'});
   if(kind==='report')return reply(200,mailReport((await store.read())?.value??null,cfg,{now:now()}));
   if(kind==='export'){
    const loaded=await store.read();if(!loaded)return reply(409,{error:'No mail state to export'});
    return reply(200,{backupVersion:1,exportedAt:now(),state:validateMailState(loaded.value)});
   }
   if(kind!=='control')return reply(404,{error:'Not found'});
   const options={revision:request.revision,consent:true,now:now()};let result;
   if(request.action==='prepare')await prepareMail(store,cfg,options);
   else if(request.action==='plan')result=await planMailTest(store,cfg,options);
   else if(request.action==='send')result=await dispatchMailTest(store,cfg,{...options,id:request.id,now,...(send?{send}:{})});
   else if(request.action==='receipt')await confirmMailReceipt(store,cfg,{...options,id:request.id,code:request.code});
   else if(request.action==='policy')await setMailPolicy(store,cfg,{...options,active:request.active,mutedUntil:request.mutedUntil});
   const report=mailReport((await store.read())?.value??null,cfg,{now:now()});record({component:'observer-mail-control',action:request.action,outcome:'completed',at:now()});return reply(200,{...(result?{result}:{}),report});
  }catch{if(kind==='control')record({component:'observer-mail-control',action:request.action,outcome:'failed',at:now()});return reply(503,{error:'Mail request could not be completed; read current state before retrying'})}
 };
}
export async function automaticMail({store,source,env=process.env,now=Date.now,send,record=value=>console.info(JSON.stringify(value))}){
 // Disabled means no second object read and no DNS, POST, quota or storage write.
 if(env.OBSERVER_ENABLED!=='1'||env.OBSERVER_MAIL_ENABLED!=='1')return;
 try{const config=configuration(env),cfg=mailConfiguration(env,config),result=await mailTick(store,source,cfg,config,{now,...(send?{send}:{})});record({component:'observer-mail',outcome:result.status,at:now()})}
 catch{record({component:'observer-mail',outcome:'failed',at:now()})}
}
