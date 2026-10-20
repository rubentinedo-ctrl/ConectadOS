import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceHelp,glossary,assistantHelp,settingsHelp,citationNote,guideTitle} from '../lib/app-help.mjs';
import {instructions} from '../lib/server/assistant.mjs';
import {workspaceReport} from '../lib/workspace-explorer.mjs';
test('Technical component explanations do not infer business ownership or reclassify applications by name',()=>{
 for(const [name,id] of [['auth','auth'],['storage','storage'],['api-gw','api-gw'],['rest','rest'],['realtime','realtime'],['supavisor','pooler']]){
  assert.equal(resourceHelp({name,type:'application',kind:'component'}).id,id);
  assert.equal(resourceHelp({name,type:'application',kind:'resource'}).id,'application');
 }
 assert.equal(resourceHelp({name:'auth',type:'database',kind:'component'}).id,'db');
 assert.equal(resourceHelp({name:'unknown',type:'server',kind:'resource'}).id,'vps');
 assert.equal(resourceHelp({name:'unknown',type:'service',kind:'resource'}).id,'service');
});
test('The same public product knowledge grounds text and voice without claiming live state or operations',()=>{
 assert.equal(new Set(glossary.map(t=>t.id)).size,glossary.length);
 for(const term of glossary)assert.ok(assistantHelp.includes(term.text));
 for(const section of Object.values(settingsHelp))assert.ok(assistantHelp.includes(section.purpose));
 assert.ok(instructions.includes(assistantHelp));
 assert.ok(assistantHelp.includes('[Ayuda]'));assert.ok(assistantHelp.includes('[S1]'));
 assert.ok(assistantHelp.includes('no el estado de la infraestructura'));
});
test('Backup report preserves missing evidence, freshness and masks names in the default export',()=>{
 const now=2000,data={connection:null,integrations:[],topology:{nodes:[],edges:[]},resourceBackups:{expiresAt:1000,items:[{ref:'private-db',name:'Private customer DB',state:'unverified',latest:{backupAt:500,drive:{state:'included'}},lastRestored:null}]}};
 const masked=workspaceReport(data,{scope:'backups',now});
 assert.equal(JSON.stringify(masked).includes('Private customer DB'),false);
 const rows=masked.sections[0].rows;
 assert.equal(rows[0][4],'Sin verificar');assert.equal(rows[0][5],'Incluida en lote');assert.equal(rows[0][6],'Lectura vencida o sin confirmar');
 assert.ok(masked.sections[0].note.includes('no acreditan recuperación externa'));
 assert.equal(workspaceReport(data,{scope:'backups',now,privateNames:false}).sections[0].rows[0][0],'Private customer DB');
});

test('The assistant knows the exact free-help control shown by the interface',()=>{assert.ok(assistantHelp.includes(guideTitle));assert.ok(assistantHelp.includes('Buscar en la ayuda'));assert.ok(assistantHelp.includes('Ajustes → IA y voz'))});
test('Product help citations are explained without certifying current service health',()=>{
 const help=citationNote({text:'Auth gestiona usuarios. [Ayuda]',citations:[],sourceCount:2});assert.equal(help.kind,'help');assert.ok(help.text.includes('No confirma el estado actual'));
 assert.equal(citationNote({text:'Todo funciona [S99]',citations:[],sourceCount:1}).kind,'warning');
 assert.equal(citationNote({text:'Observado [S1]',citations:['S1'],sourceCount:1}),null);
 assert.equal(citationNote({text:'Sin fuentes',citations:[],sourceCount:0}),null);
});
