// Provider errors are classified locally; raw messages can contain private data.
export function realtimeFailure(error){
 const code=error?.code;
 if(['insufficient_quota','billing_hard_limit_reached','billing_not_active'].includes(code))return 'OpenAI no pudo responder por saldo o límite de facturación. Revisa la facturación de tu proyecto de API.';
 if(['rate_limit_exceeded','tokens_rate_limit_exceeded'].includes(code))return 'OpenAI alcanzó su límite de uso. La conversación se detuvo; no se reintenta automáticamente.';
 if(['model_not_found','model_not_available','permission_denied','invalid_api_key'].includes(code))return 'OpenAI no permite generar respuestas con este acceso o modelo. Revisa los permisos Realtime de la clave.';
 return 'OpenAI no pudo generar la respuesta. La conversación se detuvo; no se reintenta automáticamente.';
}
/** Owns one microphone/peer; only start() called by the user's button can acquire audio. */
export class RealtimeConversation {
 /** @param {{api:Function,onState?:Function,onMessage?:Function,onTranscript?:Function,onDiagnostics?:Function,environment?:any}} options */
 constructor({api,onState=()=>{},onMessage=()=>{},onTranscript=()=>{},onDiagnostics=()=>{},environment={}}){this.api=api;this.onState=onState;this.onMessage=onMessage;this.onTranscript=onTranscript;this.onDiagnostics=onDiagnostics;this.diagnostics={connected:false,heard:0,responses:0,interrupted:0,limited:0,expires:null,audioReceived:false,playback:false};this.env=environment;this.generation=0;this.peer=null;this.stream=null;this.channel=null;this.id=null;this.timer=null;this.controller=null;this.audio=null}
 snapshot(patch){this.diagnostics={...this.diagnostics,...patch};this.onDiagnostics({...this.diagnostics})}
 cleanup(){clearTimeout(this.connectTimer);this.connectTimer=null;clearTimeout(this.timer);this.timer=null;this.controller?.abort();this.controller=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.channel?.close();this.channel=null;this.peer?.close();this.peer=null;if(this.audio){this.audio.pause();this.audio.srcObject=null}this.audio=null}
 async stop(message='Conversación terminada · micrófono apagado.'){if(!this.peer&&!this.controller&&!this.id)return;++this.generation;const id=this.id;this.id=null;this.cleanup();this.onState('idle');this.onMessage(message);if(id)try{await this.api({action:'end',id});}catch(e){this.onMessage(e instanceof Error?e.message:'Micrófono apagado; cierre externo sin confirmar.')}}
 async start(preview,audio){if(this.peer||this.controller)return;const generation=++this.generation;const current=()=>generation===this.generation;this.controller=new AbortController();const controller=this.controller;this.snapshot({connected:false,heard:0,responses:0,interrupted:0,limited:0,expires:null,audioReceived:false,playback:false});this.onState('connecting');this.onMessage('Conectando. Puedes terminar en cualquier momento.');let pendingId;
 try{
  if(preview?.expires&&preview.expires<=Date.now())throw new Error('La autorización caducó. Prepara una conversación nueva antes de activar el micrófono.');
  const media=this.env.media??navigator.mediaDevices;const stream=await media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!current()){stream.getTracks().forEach(t=>t.stop());return}this.stream=stream;this.audio=audio;
  const Peer=this.env.Peer??RTCPeerConnection;const peer=new Peer();this.peer=peer;stream.getAudioTracks().forEach(track=>peer.addTrack(track,stream));peer.ontrack=event=>{if(!current())return;this.snapshot({audioReceived:true});audio.srcObject=event.streams?.[0]??new MediaStream([event.track]);void audio.play().then(()=>{if(current())this.snapshot({playback:true})}).catch(()=>{if(current()){this.snapshot({playback:false});this.onMessage('Pulsa reproducir en el control de audio para escuchar.')}})};
  const channel=peer.createDataChannel('oai-events');this.channel=channel;let text='',greeted=false,responseId=null,playing=false;channel.onmessage=event=>{if(!current())return;let value;try{if(event.data.length>131072)return;value=JSON.parse(event.data)}catch{return}
   if(value.type==='session.created'||value.type==='session.updated'){clearTimeout(this.connectTimer);this.connectTimer=null;this.snapshot({connected:true});this.onState('listening');this.onMessage('Conectado. Habla después del saludo; puedes interrumpir la respuesta.');if(!greeted&&channel.readyState==='open'){greeted=true;channel.send(JSON.stringify({type:'response.create',response:{instructions:'Saluda en español con una frase corta: Estoy conectado. ¿Qué quieres consultar de tu infraestructura?'}}))}}
   if(value.type==='response.created'){responseId=value.response?.id??null;playing=false;text='';this.onState('thinking')}
   if(value.type==='output_audio_buffer.started'&&(!responseId||!value.response_id||value.response_id===responseId)){playing=true;this.onState('speaking')}
   if(value.type==='output_audio_buffer.stopped'&&(!responseId||!value.response_id||value.response_id===responseId)){playing=false;this.onState('listening')}
   if(value.type==='output_audio_buffer.cleared'&&(!responseId||!value.response_id||value.response_id===responseId))playing=false;
   if(value.type==='input_audio_buffer.speech_started'){this.snapshot({heard:this.diagnostics.heard+1});this.onState('listening');text=''}
   if(value.type==='input_audio_buffer.speech_stopped')this.onState('thinking');
   if(value.type==='response.output_audio_transcript.delta'&&typeof value.delta==='string'&&(!responseId||!value.response_id||value.response_id===responseId)){text=(text+value.delta).slice(-4000);this.onTranscript(text);this.onState('speaking')}
   if(value.type==='response.done'){
    const stale=Boolean(responseId&&value.response?.id&&responseId!==value.response.id);
    if(value.response?.status==='cancelled'){this.snapshot({interrupted:this.diagnostics.interrupted+1});if(!stale)this.onMessage('Respuesta interrumpida. Estoy escuchando tu nueva pregunta.')}
    if(value.response?.status==='incomplete'){this.snapshot({limited:this.diagnostics.limited+1});if(!stale)this.onMessage(value.response.status_details?.reason==='max_output_tokens'?'La respuesta alcanzó el límite de longitud. Puedes pedir una respuesta más breve.':'La respuesta quedó incompleta. Puedes reformular tu pregunta.')}
    if(stale)return;
    if(value.response?.status==='failed'){void this.stop(realtimeFailure(value.response.status_details?.error));return}
    if(value.response?.status==='completed'){
     this.snapshot({responses:this.diagnostics.responses+1});
     if(!text){const parts=(value.response.output??[]).flatMap(item=>item.content??[]);text=parts.map(p=>typeof p.transcript==='string'?p.transcript:'').join(' ').slice(-4000);if(text)this.onTranscript(text)}
    }
    if(!playing)this.onState('listening');
   }
   if(value.type==='error')void this.stop(realtimeFailure(value.error));
  };
  peer.onconnectionstatechange=()=>{if(current()&&['failed','disconnected','closed'].includes(peer.connectionState))void this.stop('Conexión terminada · micrófono apagado. No se reconecta automáticamente.')};channel.onclose=()=>{if(current())void this.stop('Canal de voz cerrado · micrófono apagado.')};
  const offer=await peer.createOffer();if(!current())return;await peer.setLocalDescription(offer);if(!current())return;
  const value=await this.api({action:'start',id:crypto.randomUUID(),preview,sdp:peer.localDescription?.sdp??offer.sdp,consent:true},controller.signal);pendingId=value.conversation.id;
  if(!current()){await this.api({action:'end',id:pendingId});return}this.id=pendingId;this.snapshot({expires:value.conversation.expires});this.timer=setTimeout(()=>void this.stop('Límite de duración alcanzado · micrófono apagado.'),Math.max(0,value.conversation.expires-Date.now()));await peer.setRemoteDescription({type:'answer',sdp:value.conversation.answer});if(!current())return;if(!this.diagnostics.connected)this.connectTimer=setTimeout(()=>{if(current()&&!this.diagnostics.connected)void this.stop('No se abrió el canal de conversación. El micrófono está apagado; revisa la conexión del navegador.')},12000);
 }catch(e){if(!current())return;await this.stop(e?.name==='NotAllowedError'?'Permiso de micrófono denegado. Puedes usar la pregunta escrita.':e instanceof Error?e.message:'No se pudo conectar el audio.');}
 }
}
