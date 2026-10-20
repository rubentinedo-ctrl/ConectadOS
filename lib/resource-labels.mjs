// Presentation only: never rename provider resources or change their references.
export const isDatabase=n=>n.type==='database'||n.type?.startsWith('standalone-')||n.type==='cloud-project';
export function resourceLabels(data){
 const nodes=data.topology?.nodes??[],byRef=new Map(nodes.map(n=>[n.ref,n])),owners=new Map(),parents=new Map(nodes.filter(n=>n.kind==='resource').map(n=>[JSON.stringify([n.provider,n.id]),n]));
 if(data.organization?.connectionRevision===data.topology?.revision)for(const p of data.organization?.projects??[]){
  const refs=new Set((data.organization.assignments??[]).filter(a=>a.projectId===p.id&&!a.missing&&byRef.has(a.ref)).map(a=>a.ref));
  for(let changed=true;changed;){changed=false;for(const e of data.topology?.edges??[])if(e.origin==='observed'&&e.kind==='contained-in'&&!e.missing&&refs.has(e.toRef)&&byRef.has(e.fromRef)&&!refs.has(e.fromRef)){refs.add(e.fromRef);changed=true}}
  for(const ref of refs){if(!owners.has(ref))owners.set(ref,[]);owners.get(ref).push(p.name)}
 }
 return new Map(nodes.map(n=>{
  const apps=owners.get(n.ref)??[],parent=parents.get(JSON.stringify([n.provider,n.parentId])),database=isDatabase(n);
  const application=apps.length?apps.join(' / '):n.type==='cloud-project'?n.name:null,base=application??parent?.name;
  return [n.ref,{name:database&&base&&base!==n.name&&!n.name.startsWith(base+' · ')?base+' · '+n.name:n.name,technicalName:n.name,application,hosting:database?(n.provider==='Coolify'?'Coolify · VPS':n.provider==='Supabase'?'Supabase Cloud':n.provider):null,association:apps.length?'Asignación local por referencia':n.type==='cloud-project'?'Nombre del proyecto Cloud':parent?'Servicio observado · aplicación pendiente de asignar':'Aplicación pendiente de asignar'}];
 }));
}
