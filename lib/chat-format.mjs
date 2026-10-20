/** A deliberately small Markdown grammar. Text stays text; HTML, URLs and images never execute. */
export function chatBlocks(text){
 const lines=String(text).replace(/\r\n?/g,'\n').split('\n'),blocks=[];let i=0;
 const special=s=>/^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|>\s)/.test(s);
 while(i<lines.length){
  const line=lines[i];if(!line.trim()){i++;continue}
  if(/^\s*```/.test(line)){const body=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))body.push(lines[i++]);if(i<lines.length)i++;blocks.push({type:'code',text:body.join('\n')});continue}
  const heading=line.match(/^\s*#{1,6}\s+(.+)$/);if(heading){blocks.push({type:'heading',text:heading[1]});i++;continue}
  const list=line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
  if(list){const ordered=Boolean(list[2]),items=[];while(i<lines.length){const row=lines[i].match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);if(!row||Boolean(row[2])!==ordered)break;let item=row[3];i++;while(i<lines.length&&lines[i].trim()&&!special(lines[i]))item+=' '+lines[i++].trim();items.push(item)}blocks.push({type:'list',ordered,start:ordered?Number(list[2]):1,items});continue}
  if(/^\s*>\s/.test(line)){const body=[];while(i<lines.length&&/^\s*>\s/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s/,''));blocks.push({type:'quote',text:body.join('\n')});continue}
  const body=[line];i++;while(i<lines.length&&lines[i].trim()&&!special(lines[i]))body.push(lines[i++]);blocks.push({type:'paragraph',text:body.join('\n')});
 }
 return blocks;
}
export function chatInline(text){
 const parts=[],pattern=/(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*|\[(S\d+|Ayuda|General)\]|\bR\d+\b)/g;let from=0;
 for(const m of text.matchAll(pattern)){if(m.index>from)parts.push({type:'text',text:text.slice(from,m.index)});parts.push(m[2]||m[3]?{type:'strong',text:m[2]??m[3]}:m[4]?{type:'code',text:m[4]}:m[5]?{type:'em',text:m[5]}:m[6]?{type:'citation',text:m[6]}:{type:'alias',text:m[0]});from=m.index+m[0].length}
 if(from<text.length)parts.push({type:'text',text:text.slice(from)});return parts;
}
