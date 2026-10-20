import {BlockList, isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {performance} from 'node:perf_hooks';
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,bits,'ipv4');
export function publicIPv4(ip) {return isIP(ip)===4&&!blocked.check(ip,'ipv4');}
export function origin(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('invalid target');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname) || isIP(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('invalid target');
  return url.origin;
}
export async function probe(value, {resolve=lookup, request=httpsRequest, signal:outer, now=Date.now}={}) {
  const url = origin(value), start = performance.now();
  const signal = outer ? AbortSignal.any([outer,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const failure = kind => ({checkedAt:now(),kind,status:null,durationMs:null,certificateExpiresAt:null});
  try {
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => { abort=()=>reject(new Error('cancelled')); signal.addEventListener('abort',abort,{once:true}); if(signal.aborted) abort(); });
    let addresses;
    try {addresses=await Promise.race([resolve(new URL(url).hostname,{family:4,all:true}),cancelled]);} finally {signal.removeEventListener('abort',abort);}
    if (!Array.isArray(addresses) || !addresses.length || addresses.length>256 || addresses.some(a=>a.family!==4 || !publicIPv4(a.address))) return failure('blocked');
    return await new Promise(done => {
      const fail=()=>done(failure('unreachable'));
      let req;
      try {
        req=request(url,{method:'HEAD',agent:false,rejectUnauthorized:true,maxHeaderSize:16384,signal,headers:{'User-Agent':'ConectadOS-observer/0.1'},lookup:(_h, options, cb)=>options.all?cb(null,addresses):cb(null,addresses[0].address,4)},res=>{
          const status=res.statusCode;
          if(res.socket?.authorized!==true || !Number.isInteger(status) || status<100 || status>599) {res.destroy();fail();return;}
          const expiry=Date.parse(res.socket.getPeerCertificate?.()?.valid_to ?? '');
          const kind=status>=200&&status<400?'responding':status===401||status===403?'protected':status===405?'unsupported':'http-error';
          const result={checkedAt:now(),kind,status,durationMs:Math.max(0,Math.round(performance.now()-start)),certificateExpiresAt:Number.isFinite(expiry)?expiry:null};
          res.on('error',()=>{});done(result);res.destroy();
        });
        req.on('error',fail);req.end();
      } catch {req?.destroy();fail();}
    });
  } catch {return failure('unreachable');}
}
