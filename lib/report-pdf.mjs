import {fontWidths} from './report-font-metrics.mjs';
import {reportDate} from './report-text.mjs';
import {reportColor} from './report-story.mjs';
// A small PDF 1.4 vector writer. Core fonts are part of PDF; no browser print dialog, server, network or font download.
const extra={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
function ansi(value){let s='';for(const c of String(value??'').normalize('NFC')){const n=c.codePointAt(0);s+=n===10?'\n':n===9?' ':n>=32&&n<=126||n>=160&&n<=255?c:extra[c]?String.fromCharCode(extra[c]):n<32?'':`[U+${n.toString(16).toUpperCase()}]`;}return s;}
const hex=s=>[...s].map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
const width=(s,size,bold=false)=>[...s].reduce((n,c)=>n+fontWidths[bold?1:0][c.charCodeAt(0)],0)*size/1000;
function wrap(value,size,max,bold=false){const lines=[];for(const para of ansi(value).split('\n')){let line='';for(let word of para.split(/\s+/).filter(Boolean)){if(line&&width(line+' '+word,size,bold)>max){lines.push(line);line='';}while(width(word,size,bold)>max){let n=1;while(n<word.length&&width(word.slice(0,n+1),size,bold)<=max)n++;lines.push(word.slice(0,n));word=word.slice(n);}line+=(line?' ':'')+word;}lines.push(line);}return lines;}
const color=c=>{const s=c.replace('#','');return [0,2,4].map(i=>(parseInt(s.slice(i,i+2),16)/255).toFixed(3)).join(' ')};
/** Same analytical model as HTML, paginated for reading, not a screenshot of tables. @returns {Uint8Array} */
export function reportPDF(report){
 if(!report.analysis)throw Error('Prepara el informe analizado antes de descargar el PDF.');
 const a=report.analysis,pages=[];let commands=[],y=0;
 const W=595.28,H=841.89,L=42,R=553.28,CW=R-L,BOTTOM=778;
 const rect=(x,top,w,h,fill)=>commands.push(`${color(fill)} rg ${x.toFixed(2)} ${(H-top-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
 const text=(value,x,top,size=10,bold=false,fill='#19334c')=>commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color(fill)} rg 1 0 0 1 ${x.toFixed(2)} ${(H-top-size).toFixed(2)} Tm <${hex(ansi(value))}> Tj ET`);
 const newPage=()=>{if(commands.length)pages.push(commands.join('\n'));commands=[];rect(L,27,CW,2,'#0891b2');text('ConectadOS / INFORMES',L,37,9,true);text(reportDate(report.generatedAt),R-175,37,8,false,'#526d80');y=70;};
 const need=h=>{if(y+h>BOTTOM)newPage();};
 const paragraph=(value,{size=10,bold=false,fill='#415f74',max=CW,x=L,gap=8}={})=>{const lines=wrap(value,size,max,bold),lineH=size*1.42;for(const line of lines){need(lineH);text(line,x,y,size,bold,fill);y+=lineH;}y+=gap;};
 const heading=value=>{need(65);paragraph(value,{size:17,bold:true,fill:'#19334c',gap:13});};
 newPage();
 const lead=wrap(a.lead,11,CW-40),headline=wrap(a.headline,26,CW-40,true),coverH=64+headline.length*30+lead.length*16;
 rect(L,y,CW,coverH,'#122f46');text(report.demo?'INFORME DE EJEMPLO':'INFORME DE INFRAESTRUCTURA',L+20,y+17,9,true,'#91dfee');let top=y+39;for(const line of headline){text(line,L+20,top,26,true,'#ffffff');top+=30;}top+=9;for(const line of lead){text(line,L+20,top,11,false,'#e0edf4');top+=16;}y+=coverH+14;
 paragraph(`${a.verdict} · ${report.privateNames?'Nombres e importes ocultos':'Incluye datos privados'}`,{size:10,bold:true,fill:'#126b87'});
 for(let i=0;i<a.stats.length;i+=4){need(130);const row=a.stats.slice(i,i+4),top=y;for(const [idx,s] of row.entries()){const x=L+idx*(CW/4+2),w=CW/4-5;rect(x,top,w,120,'#f0f7fb');text(s.value,x+10,top+10,18,true,'#126b87');let t=top+37;for(const line of wrap(s.label,8,w-20,true)){text(line,x+10,t,8,true);t+=11;}for(const line of wrap(s.detail,7.5,w-20)){text(line,x+10,t+5,7.5,false,'#526d80');t+=10;}}y+=132;}
 y+=8;need(180);heading('La situación, en gráficos');
 for(const c of a.charts){const caption=wrap(c.description,9,CW),h=30+caption.length*13+c.rows.length*45+12;need(Math.min(h,500));paragraph(c.title,{size:13,bold:true,fill:'#19334c',gap:5});paragraph(c.description,{size:9,gap:12});const max=c.kind==='capacity'?100:Math.max(1,...c.rows.map(r=>r.value??0));if(!c.rows.some(r=>r.value!==null)){paragraph('Sin datos actuales para dibujar esta gráfica.',{size:10});continue;}
  for(const r of c.rows){need(48);const labelLines=wrap(r.label,9,CW-130);text(labelLines[0],L,y,9,true);if(labelLines.length>1){y+=12;for(const line of labelLines.slice(1)){text(line,L,y,9,true);y+=12;}}const val=r.value===null?'Sin muestra actual':new Intl.NumberFormat('es',{maximumFractionDigits:1}).format(r.value)+' '+c.unit;text(val,R-width(ansi(val),9),y,9,false,'#415f74');rect(L,y+18,CW,8,'#e6eff5');if(r.value!==null)rect(L,y+18,Math.max(0,Math.min(CW,CW*r.value/max)),8,reportColor(r.color));y+=34;if(r.at){text(reportDate(r.at),L,y,7,false,'#526d80');y+=10;}y+=8;}
  y+=12;
 }
 if(!a.charts.length)paragraph(report.privateNames?'Los importes están ocultos. Activa los datos privados para ver gráficos de costos.':'Faltan importes recurrentes para generar una gráfica de costos.');
 if(a.findings.length){y+=6;need(240);heading('Qué significa y qué conviene hacer');for(const f of a.findings){const estimate=wrap(f.title,12,CW-16,true).length*17+[f.observation,f.meaning,f.next].reduce((v,s)=>v+wrap(s,10,CW-16).length*14.2+25,0)+15;need(Math.min(estimate,550));rect(L-9,y,3,16,f.tone==='attention'?'#d97706':f.tone==='unknown'?'#8294a6':'#1683bd');paragraph(f.title,{size:12,bold:true,fill:'#19334c',gap:10});for(const [label,value] of [['LO OBSERVADO',f.observation],['CÓMO INTERPRETARLO',f.meaning],['SIGUIENTE PASO',f.next]]){paragraph(label,{size:8,bold:true,fill:'#126b87',gap:3});paragraph(value,{size:10,gap:9});}y+=9;}}
 need(150);heading('Tu plan de revisión');for(const [i,item] of a.actions.entries()){need(70);paragraph(`${i+1}. ${item.title}`,{size:11,bold:true,fill:'#126b87',gap:5});paragraph(item.detail,{size:10,gap:13});}
 const notes=a.method+' '+report.limits;const endNote='El PDF contiene el análisis. El HTML conserva las tablas como anexo desplegable y Excel ofrece los datos de detalle.';need(43+Math.ceil(a.sources.length/2)*40+(wrap(notes,8,CW).length+wrap(endNote,8,CW).length)*12);heading('De dónde salen las conclusiones');for(let i=0;i<a.sources.length;i+=2){for(const [k,s] of a.sources.slice(i,i+2).entries()){const x=L+k*(CW/2+5),w=CW/2-13;let t=y;for(const line of wrap(s.name+' · '+(s.status??(s.fresh?'Lectura vigente':'Necesita actualizarse')),8,w,true)){text(line,x,t,8,true);t+=11;}text(reportDate(s.at),x,t+2,7,false,'#526d80');}y+=40;}
 paragraph(notes,{size:8,gap:8});paragraph(endNote,{size:8});
 pages.push(commands.join('\n'));
 const objects=['','<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
 const ids=[];for(const [i,p] of pages.entries()){const pageId=objects.length,streamId=pageId+1;ids.push(pageId);objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);commands=[];text(`ConectadOS · ${report.demo?'Ejemplo':'Informe privado'} · ${i+1} / ${pages.length}`,L,H-34,8,false,'#526d80');const stream=p+'\n'+commands.join('\n');objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);}
 objects[2]=`<< /Type /Pages /Kids [${ids.map(i=>i+' 0 R').join(' ')}] /Count ${ids.length} >>`;
 let out='%PDF-1.4\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets.push(out.length);out+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}const xref=out.length;out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 if(out.length>8*1024*1024)throw Error('El PDF supera 8 MB. Selecciona un informe más específico.');return Uint8Array.from(out,c=>c.charCodeAt(0));
}
