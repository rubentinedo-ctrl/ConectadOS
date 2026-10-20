import {createHash,timingSafeEqual} from 'node:crypto';
import {configuration,report,tick,validateState} from './monitor.mjs';
export function authorized(header,secret) {
  if(typeof secret!=='string'||secret.length<32||secret.length>512||typeof header!=='string'||header.length>520||/[\r\n]/.test(secret))return false;
  return timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+secret).digest());
}
export function endpoint(kind,{store,env=process.env,now=Date.now,check,afterCheck,record=value=>console.info(JSON.stringify(value))}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,value)=>res.status(status).json(value);
    if(req.method!=='GET')return send(405,{error:'Method not allowed'});
    if(Object.keys(req.query??{}).length)return send(400,{error:'No parameters accepted'});
    if(kind==='health')return send(200,{service:'conectados-observer',version:1});
    const cron=env.CRON_SECRET,read=env.OBSERVER_REPORT_SECRET;
    if(!authorized(req.headers?.authorization,kind==='check'?cron:read)||cron===read)return send(401,{error:'Unauthorized'});
    if(env.OBSERVER_ENABLED!=='1')return send(409,{error:'Observer paused'});
    try {
      const config=configuration(env);
      if(kind==='check'){const result=await tick(store,config,{now,...(check?{check}:{})});record({component:'observer-check',outcome:result.status,at:now()});if(afterCheck&&['observed','not-due'].includes(result.status)){try{await afterCheck()}catch{record({component:'observer-mail',outcome:'failed',at:now()})}}return send(200,result);}
      if(kind==='report')return send(200,report((await store.read())?.value??null,config,now()));
      if(kind==='export'){const loaded=await store.read();if(!loaded)return send(409,{error:'No observations to export'});return send(200,{backupVersion:1,exportedAt:now(),configuration:{targets:config.targets,intervalSeconds:config.intervalSeconds},state:validateState(loaded.value,config)});}
      return send(404,{error:'Not found'});
    } catch {if(kind==='check')record({component:'observer-check',outcome:'failed',at:now()});return send(503,{error:'Observer could not complete the request'});}
  };
}
