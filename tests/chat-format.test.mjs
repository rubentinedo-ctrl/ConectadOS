import test from 'node:test';
import assert from 'node:assert/strict';
import {chatBlocks,chatInline} from '../lib/chat-format.mjs';
test('chat formats real answer paragraphs, emphasis, lists and dated citations without literal markers',()=>{
 const blocks=chatBlocks('## Revisión\n\n- **Coolify:** revisa R1. [S1]\n- **Respaldo:** pendiente.\n\n**Siguiente paso:** abrir Respaldos. [Ayuda]');
 assert.deepEqual(blocks.map(b=>b.type),['heading','list','paragraph']);assert.equal(blocks[1].items.length,2);
 assert.deepEqual(chatInline(blocks[1].items[0]).filter(p=>p.type!=='text'),[{type:'strong',text:'Coolify:'},{type:'alias',text:'R1'},{type:'citation',text:'S1'}]);
 assert.equal(chatInline(blocks[2].text).at(-1).text,'Ayuda');
});
test('HTML, javascript links, images and unclosed code remain inert text; ordered lists preserve start',()=>{
 const value='<img src=x onerror=alert(1)> [abrir](javascript:alert(1)) ![pixel](https://evil.example)';
 assert.equal(chatBlocks(value)[0].text,value);assert.deepEqual(chatInline(value),[{type:'text',text:value}]);
 assert.equal(chatBlocks('3. Primero\n4. Segundo')[0].start,3);
 assert.deepEqual(chatBlocks('```html\n<script>alert(1)</script>'),[{type:'code',text:'<script>alert(1)</script>'}]);
});

import {citationNote} from '../lib/app-help.mjs';
test('general knowledge has a distinct source label without claiming current infrastructure evidence',()=>{
 assert.deepEqual(chatInline('[General]'),[{type:'citation',text:'General'}]);
 const note=citationNote({text:'Una explicación técnica. [General]',sourceCount:4,citations:[]});assert.equal(note.kind,'general');assert.match(note.text,/No verifica tu instalación/);
 assert.equal(citationNote({text:'Funciona sin ninguna prueba.',sourceCount:4,citations:[]}).kind,'warning');
 assert.equal(citationNote({text:'Estado observado [S1].',sourceCount:1,citations:['S1']}),null);
});
