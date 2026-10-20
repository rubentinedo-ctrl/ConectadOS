import {Fragment,type ReactNode} from 'react';
import {chatBlocks,chatInline} from '@/lib/chat-format.mjs';
type Label={alias:string;name:string};
export function ChatMessage({text,labels=[]}:{text:string;labels?:Label[]}){
 const inline=(value:string):ReactNode=>chatInline(value).map((p:{type:string;text:string},i:number)=>p.type==='strong'?<strong key={i}>{inline(p.text)}</strong>:p.type==='em'?<em key={i}>{inline(p.text)}</em>:p.type==='code'?<code key={i}>{labels.find(l=>l.alias===p.text)?.name??p.text}</code>:p.type==='citation'?null:p.type==='alias'?<span key={i}>{labels.find(l=>l.alias===p.text)?.name??p.text}</span>:<Fragment key={i}>{p.text}</Fragment>);
 return <div className="chat-markdown">{chatBlocks(text).map((b:{type:string;text?:string;items?:string[];ordered?:boolean;start?:number},i:number)=>b.type==='heading'?<h3 key={i}>{inline(b.text!)}</h3>:b.type==='code'?<pre key={i}><code>{b.text}</code></pre>:b.type==='quote'?<blockquote key={i}>{inline(b.text!)}</blockquote>:b.type==='list'?(b.ordered?<ol key={i} start={b.start}>{b.items!.map((s,j)=><li key={j}>{inline(s)}</li>)}</ol>:<ul key={i}>{b.items!.map((s,j)=><li key={j}>{inline(s)}</li>)}</ul>):<p key={i}>{inline(b.text!)}</p>)}</div>;
}
