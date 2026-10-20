// Fixed PCM format lets the server verify duration without trusting a browser timestamp.
export function voiceWav(samples){
 if(!(samples instanceof Int16Array)||samples.length<8000||samples.length>480000)throw new Error('La grabación debe durar entre 0,5 y 30 segundos.');
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer),bytes=new Uint8Array(buffer);
 const text=(offset,value)=>{for(let i=0;i<value.length;i++)bytes[offset+i]=value.charCodeAt(i)};
 text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,samples[i],true);return bytes;
}
export function voiceBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)}
export class VoiceCapture {
 constructor({onComplete,onLevel=(_level)=>{},onState=(_state)=>{},environment=null}){this.onComplete=onComplete;this.onLevel=onLevel;this.onState=onState;this.environment=environment;this.chunks=[];this.samples=0;this.cancelled=false;this.finished=false;this.stopping=false;this.context=null;this.stream=null;this.node=null;this.timer=null;this.flushTimer=null;}
 async start(){
  const e=this.environment??{media:globalThis.navigator?.mediaDevices,Context:globalThis.AudioContext,Node:globalThis.AudioWorkletNode};
  if(!e.media?.getUserMedia||!e.Context||!e.Node)throw new Error('Este navegador no admite la grabación requerida. Puedes escribir la pregunta o cargar un WAV compatible.');
  try{
   this.stream=await e.media.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
   if(this.cancelled){this.cleanup();return}
   this.onState('initializing');
   this.context=new e.Context();if(this.context.sampleRate<16000)throw new Error('Unsupported sample rate');
   let deadline;try{await Promise.race([(async()=>{await this.context.resume();await this.context.audioWorklet.addModule('/voice-capture-worklet.js')})(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Audio setup timeout')),8000)})])}finally{clearTimeout(deadline)}
   if(this.cancelled){this.cleanup();return}
   this.node=new e.Node(this.context,'conectados-voice-capture');const input=this.context.createMediaStreamSource(this.stream);input.connect(this.node);this.node.connect(this.context.destination);
   this.node.port.onmessage=event=>{if(this.finished||this.cancelled)return;const data=event.data;if(data.kind==='pcm'&&data.samples instanceof Int16Array){const value=data.samples.subarray(0,Math.max(0,480000-this.samples));this.chunks.push(value);this.samples+=value.length;this.onLevel(Number.isFinite(data.level)?Math.min(1,Math.max(0,data.level)):0);if(this.samples>=480000)this.stop()}else if(data.kind==='done')this.finish()};
   this.onState('recording');this.timer=setTimeout(()=>this.stop(),30000);
  }catch(error){this.cancel();throw new Error(error?.name==='NotAllowedError'?'El micrófono no fue autorizado. Puedes seguir escribiendo.':error?.name==='NotFoundError'?'No se encontró un micrófono. Puedes escribir o cargar una grabación.':'No se pudo iniciar el micrófono. Revisa el permiso o usa el texto.');}
 }
 stop(){if(this.finished||this.cancelled||this.stopping)return;this.stopping=true;if(!this.node){this.cancel();return}clearTimeout(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.node.port.postMessage({kind:'stop'});this.flushTimer=setTimeout(()=>this.finish(),1000)}
 finish(){if(this.finished||this.cancelled)return;this.finished=true;const samples=new Int16Array(this.samples);let offset=0;for(const chunk of this.chunks){samples.set(chunk,offset);offset+=chunk.length}this.chunks=[];this.cleanup();try{this.onComplete({bytes:voiceWav(samples),seconds:samples.length/16000,error:null})}catch(e){this.onComplete({bytes:null,seconds:0,error:e.message})}finally{samples.fill(0)}}
 cancel(){this.cancelled=true;for(const chunk of this.chunks)chunk.fill(0);this.chunks=[];this.cleanup()}
 cleanup(){clearTimeout(this.timer);clearTimeout(this.flushTimer);this.stream?.getTracks().forEach(t=>t.stop());this.node?.disconnect();if(this.node)this.node.port.onmessage=null;void this.context?.close().catch(()=>{});this.onLevel(0)}
}
