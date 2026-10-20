// A grouping is local metadata. It does not establish a dependency or service health.
export function organizedRefs(report,{projectId='',tag=''}={}){
 tag=tag.trim().normalize('NFC').toLocaleLowerCase('es');
 if(!projectId&&!tag)return null;
 return report.assignments.filter(a=>!a.missing&&(!projectId||a.projectId===projectId)&&(!tag||a.tags.includes(tag))).map(a=>a.ref);
}
