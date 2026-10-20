export const relationLabels={'depends-on':'Depende de','hosted-in':'Alojado en','resolves-to':'Resuelve hacia','backed-up-in':'Respaldado en','contained-in':'Pertenece a','domain-match':'Coincidencia de dominio'};
// Only declarations explicitly marked as dependencies participate in impact.
// Containment, DNS matches and backup declarations do not establish propagation.
export function potentialDependents(report,ref){
 const reverse=new Map(),nodes=new Map(report.nodes.map(n=>[n.ref,n]));
 for(const edge of report.edges){if(edge.kind!=='depends-on'||edge.origin!=='declared'||edge.missing||edge.stale||!nodes.has(edge.fromRef)||!nodes.has(edge.toRef))continue;if(!reverse.has(edge.toRef))reverse.set(edge.toRef,[]);reverse.get(edge.toRef).push(edge.fromRef)}
 const visited=new Set([ref]),queue=[ref],result=[];
 for(let i=0;i<queue.length;i++)for(const source of reverse.get(queue[i])??[]){if(visited.has(source))continue;visited.add(source);queue.push(source);result.push(nodes.get(source))}
 return result;
}
