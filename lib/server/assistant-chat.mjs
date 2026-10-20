import {mentionedInventoryProviders,assistantInventoryBinding} from './assistant-inventory.mjs';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {AppError} from './store.mjs';
import {organizationReport} from './organization.mjs';
import {previewAssistant,askAssistant,assertNoAssistantSecrets} from './assistant.mjs';
export const chatGuidance='MODO CONVERSACIÓN: Eres ConectadOS, un agente técnico de conversación: explicas programación, bases de datos, redes, DNS, infraestructura, seguridad, APIs, Docker, Cloudflare Workers y otros temas técnicos, además de esta aplicación. Empieza por la respuesta útil a la pregunta, sin preámbulos. Por defecto responde en menos de 180 palabras; amplía solo si el usuario pide detalle. Usa Markdown sencillo: párrafos breves, negritas y listas con un elemento por línea. Evita tablas, HTML y bloques de información técnica innecesaria. Explica los términos técnicos cuando aparezcan. Cita junto a los hechos, sin llenar la respuesta de límites repetidos: incluye solo la incertidumbre que cambia la decisión. La ayuda integrada es tu manual versionado, no un entrenamiento personalizado ni una consulta en vivo. No pidas seleccionar el proyecto si observations.scope es project: ya fue seleccionado; explica sus recursos mediante los alias R1, R2 (la interfaz mostrará sus nombres). Distingue tres casos: conocimiento técnico general [General], funciones de ConectadOS [Ayuda] y hechos de esta instalación [S1], [S2]. Para preguntas generales, contesta directamente desde tus conocimientos: no necesitas identificar recursos del usuario, no repitas límites del inventario y no pidas dónde vio un término si la pregunta ya permite explicarlo. Por ejemplo, si aclara que Worker es de Cloudflare, explica Cloudflare Workers y un caso práctico; no exijas que aparezca en HUB. La selección de proyecto solo acota los datos operativos, no los temas de conversación; el usuario puede cambiar de tema sin cambiarla. Pide aclaración únicamente si las interpretaciones cambian materialmente la respuesta. Si solicita un diagnóstico de sus recursos y falta evidencia, indica qué falta y dónde comprobarlo. Ofrece un siguiente paso concreto, sin afirmar que ejecutaste acciones ni prometer reparaciones. No hagas un inventario de todos los proveedores si preguntan por una función. No inventes nombres ni relaciones. Cuando resource-catalog contiene filas, enumera sus alias: la interfaz muestra los nombres reales. questionMatches identifica los alias cuyos nombres aparecen en la pregunta literal; úsalos para responder sobre ese recurso concreto. No infieras dependencias por esa coincidencia. Identifica el recurso de estado desconocido por su alias; no respondas que solo conoces conteos. Mantén las referencias de fuente internas, sin explicar al usuario el sistema de citas ni consumo. Para listar inventarios puedes superar 180 palabras si hace falta para incluir todos los recursos disponibles.';
// Resolve only an exact, unambiguous project name on the first general turn.
function namedProject(db,question){
 if(typeof question!=='string')return null;const q=question.normalize('NFC').toLocaleLowerCase('es');
 const matches=organizationReport(db).projects.filter(p=>{const name=p.name.normalize('NFC').toLocaleLowerCase('es');if(name.length<3)return false;let i=q.indexOf(name);while(i!==-1){const before=q.slice(0,i),after=q.slice(i+name.length);if(!/[\p{L}\p{N}_]$/u.test(before)&&!/^[/\p{L}\p{N}_]/u.test(after))return true;i=q.indexOf(name,i+1)}return false});return matches.length===1?matches[0]:null;
}
const maxBytes=9000,maxTurns=6,ttl=60*60*1000;
const sign=(db,value)=>createHmac('sha256',db.key).update('assistant-chat-v1\0'+JSON.stringify(value)).digest('hex');
function identity(db,p){return {owner:db.ownerStamp(),revision:p.revision,binding:p.binding,selection:p.selection?.binding??null,scope:p.context.scope,runtime:p.runtimeBinding,inventory:assistantInventoryBinding(db)}}
function history(db,receipt,p,now){
 if(receipt===undefined||receipt===null)return [];
 if(typeof receipt!=='object'||Array.isArray(receipt)||Buffer.byteLength(JSON.stringify(receipt))>12000)throw new AppError('La conversación no es válida. Inicia una nueva.',400);
 const {value,signature}=receipt;
 if(!value||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(sign(db,value)),Buffer.from(signature)))throw new AppError('La conversación cambió. Inicia una nueva.',403);
 if(!Number.isSafeInteger(value.expires)||value.expires<now||value.expires>now+ttl||JSON.stringify(value.identity)!==JSON.stringify(identity(db,p)))throw new AppError('La conversación venció o cambió su conexión. Inicia una nueva.',409);
 if(!Array.isArray(value.turns)||value.turns.length>maxTurns||Buffer.byteLength(JSON.stringify(value.turns))>maxBytes||value.turns.some(t=>typeof t.question!=='string'||t.question.length>1000||typeof t.answer!=='string'||t.answer.length>32000||!Number.isSafeInteger(t.at)))throw new AppError('El contexto de la conversación no es válido.',400);
 assertNoAssistantSecrets(db,JSON.stringify(value.turns));return value.turns;
}
/** Browser-memory only, authenticated transcript. Nothing is written to the ledger except existing usage metadata. */
export async function chatAssistant(db,{question,scope='all',target,conversation,id,consent}={},dependencies={}){
 if(consent!==true)throw new AppError('Autoriza el envío del chat a tu proveedor de IA.',400);
 const project=scope==='all'&&!target&&!conversation?namedProject(db,question):null;
 const resolvedSelection=project?{scope:'project',target:project.id,name:project.name}:null;
 const priorQuestions=conversation?.value?.turns;
 const previous=Array.isArray(priorQuestions)?[...priorQuestions].reverse().find(t=>typeof t.question==='string'&&mentionedInventoryProviders(t.question).length)?.question:'';
 const inventoryQuestion=mentionedInventoryProviders(question).length?question:previous||question;
 const now=dependencies.now??Date.now,p=previewAssistant(db,{question,inventoryQuestion,scope:resolvedSelection?.scope??scope,target:resolvedSelection?.target??target},now()),turns=history(db,conversation,p,now());
 const answer=await askAssistant(db,{id,preview:p,consent:true},{...dependencies,dialogue:turns,conversationGuidance:chatGuidance});
 const retained=[...turns,{question:p.question,answer:answer.text,at:now()}];let omitted=0;
 while(retained.length>maxTurns||Buffer.byteLength(JSON.stringify(retained))>maxBytes){retained.shift();omitted++}
 const value={identity:identity(db,p),turns:retained,expires:now()+ttl};
 return {answer,conversation:{value,signature:sign(db,value)},contextTrimmed:omitted>0,resolvedSelection};
}
