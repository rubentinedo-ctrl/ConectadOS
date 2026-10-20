// No networking, files, transcription, or playback. Downsample microphone PCM to 16 kHz.
class ConectadosVoiceCapture extends AudioWorkletProcessor {
 constructor(){super();this.values=[];this.sum=0;this.count=0;this.phase=0;this.total=0;this.stopped=false;this.port.onmessage=e=>{if(e.data?.kind==='stop'){this.stopped=true;this.flush();this.port.postMessage({kind:'done'})}}}
 flush(){if(!this.values.length)return;const samples=Int16Array.from(this.values);let squared=0;for(const sample of samples)squared+=(sample/32768)**2;this.port.postMessage({kind:'pcm',samples,level:Math.sqrt(squared/samples.length)},[samples.buffer]);this.values=[]}
 process(inputs){if(this.stopped)return false;const input=inputs[0]?.[0];if(!input)return true;const ratio=sampleRate/16000;
  for(const sample of input){this.sum+=sample;this.count++;this.phase++;if(this.phase>=ratio){const value=Math.max(-1,Math.min(1,this.sum/this.count));this.values.push(Math.round(value*(value<0?32768:32767)));this.sum=0;this.count=0;this.phase-=ratio;this.total++;if(this.values.length>=1600)this.flush();if(this.total>=480000){this.stopped=true;this.flush();this.port.postMessage({kind:'done'});return false}}}return true;
 }
}
registerProcessor('conectados-voice-capture',ConectadosVoiceCapture);
