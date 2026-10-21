/** A manual HTTPS shortcut, never a probe or a claim that a site exists. */
export function dnsWebsiteURL(name,type){
 if(!['zone','A','AAAA','CNAME'].includes(type)||typeof name!=='string')return null;
 const host=name.toLowerCase().replace(/\.$/,'');
 if(host.length>253||!host.includes('.')||!/^[a-z0-9.-]+$/.test(host))return null;
 const labels=host.split('.');
 if(labels.some(label=>!label||label.length>63||! /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))return null;
 if(!/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1))||['localhost','local','internal','lan','onion'].includes(labels.at(-1)))return null;
 try{const url=new URL('https://'+host+'/');return url.hostname===host?url.href:null;}catch{return null;}
}
