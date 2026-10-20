import {observationStale} from './observations.mjs';
const mb=1024**2,gb=1024**3;
const positive=n=>Number.isFinite(n)&&n>0?n:null;
export const vpsBytes=n=>Number.isFinite(n)?`${new Intl.NumberFormat('es',{maximumFractionDigits:1}).format(n/gb)} GB`:'—';
export function hostingerDashboard(connection,now=Date.now()){
 const snapshot=connection?.snapshot,server=snapshot?.resources?.find(r=>r.type==='server');
 const metric=(name,unit)=>{const s=snapshot?.metrics?.find(m=>m.name===name),points=s?.unit===unit?s.points.filter(p=>Number.isFinite(p.value)&&p.value>=0&&Number.isSafeInteger(p.at)).sort((a,b)=>a.at-b.at):[],last=points.at(-1);return {points,last: last??null,current:!observationStale(connection,now)&&!!last&&last.at<=now+60000&&now-last.at<=3600000}};
 const cpu=metric('cpu_usage','%'),ram=metric('ram_usage','bytes'),disk=metric('disk_space','bytes'),incoming=metric('incoming_traffic','bytes'),outgoing=metric('outgoing_traffic','bytes');
 const totalRam=positive(server?.memoryMB)?server.memoryMB*mb:null,totalDisk=positive(server?.diskMB)?server.diskMB*mb:null;
 return {server:server??null,checkedAt:snapshot?.checkedAt??null,cpu,ram,disk,incoming,outgoing,totalRam,totalDisk,ramPercent:ram.current&&totalRam?100*ram.last.value/totalRam:null,diskPercent:disk.current&&totalDisk?100*disk.last.value/totalDisk:null,bandwidthTB:positive(server?.bandwidthMB)?server.bandwidthMB/1024/1000:null};
}
