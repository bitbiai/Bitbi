// Synthetic realtime transport only. Auth, owner, D1, tools and accounting run
// unchanged in workerd. This fixture never contacts xAI or another provider.
import lifecycleProvider,{VoiceProviderFixture as LifecycleProvider} from './voice-lifecycle-provider.mjs';

export class VoiceProviderFixture extends LifecycleProvider {
  async fetch(request){
    const url=new URL(request.url);
    if(url.origin==='https://voice-fixture.invalid'&&url.pathname.startsWith('/journey/')){
      if(url.pathname==='/journey/state')return Response.json(this.snapshot());
      if(request.method!=='POST')return new Response(null,{status:405});
      const body=await request.json();
      if(url.pathname==='/journey/reset'){
        if(this.journey?.socket?.readyState===1)throw new Error('Close the original journey before reset');
        this.journey={sequence:0,connections:0,appends:0,silenceFrames:0,audioBytes:0,firstAudioAt:null,lastAudioAt:null,tools:[],responses:0,turns:0,closes:0,configurations:0,events:[],truncations:[],answerTexts:{}};
      }else if(url.pathname==='/journey/emit'){
        const state=this.journey;if(!state?.socket)return new Response(null,{status:409});
        if(body.command==='turn'){
          if(!/^[a-z0-9_-]{1,60}$/.test(body.id)||typeof body.text!=='string'||body.text.length>1000)throw new Error('Invalid fixture turn');
          if(!state.appends)throw new Error('Synthetic ASR requires actual browser capture first');
          state.turns++;state.currentItem=body.id;
          state.emit({type:'input_audio_buffer.speech_started',item_id:body.id});
          state.emit({type:'input_audio_buffer.speech_stopped',item_id:body.id});
          state.emit({type:'input_audio_buffer.committed',item_id:body.id});
          state.emit({type:'conversation.item.input_audio_transcription.updated',item_id:body.id,transcript:body.text.slice(0,6)});
          state.emit({type:'conversation.item.input_audio_transcription.updated',item_id:body.id,transcript:body.text});
          const completed={type:'conversation.item.input_audio_transcription.completed',item_id:body.id,transcript:body.text};
          state.emit(completed);if(body.replay)state.emit(completed);
        }else if(body.command==='call'){
          state.emit({type:'response.created',response:{id:body.id}});
          state.emit({type:'response.function_call_arguments.done',response_id:body.id,call_id:body.id,name:body.name,arguments:JSON.stringify(body.arguments)});
          state.emit({type:'response.done',response:{id:body.id,status:'completed'}});
        }else if(body.command==='answer'){
          const item_id=body.id+'_audio';state.currentResponse=body.id;state.answerTexts[item_id]=body.text;
          state.emit({type:'response.created',response:{id:body.id}});
          state.emit({type:'response.output_item.added',response_id:body.id,item:{id:item_id,type:'message'}});
          const milliseconds=body.milliseconds||160,pcm=new Uint8Array(milliseconds*48);
          for(let sample=0;sample<pcm.length/2;sample++){const value=Math.round(2500*Math.sin(sample*2*Math.PI*440/24000));pcm[sample*2]=value&255;pcm[sample*2+1]=(value>>8)&255;}
          state.emit({type:'response.output_audio.delta',response_id:body.id,item_id,delta:btoa(String.fromCharCode(...pcm))});
          state.emit({type:'response.output_audio_transcript.delta',response_id:body.id,item_id,delta:body.text});
          if(!body.open)state.emit({type:'response.done',response:{id:body.id,status:'completed'}});
        }else if(body.command==='done')state.emit({type:'response.done',response:{id:body.id,status:body.status||'completed'}});
        else throw new Error('Unknown journey fixture command');
      }else return new Response(null,{status:404});
      return Response.json(this.snapshot());
    }
    if(!this.journey)return super.fetch(request);
    if(url.origin!=='https://api.x.ai'||url.pathname!=='/v1/realtime'||url.searchParams.get('model')!=='grok-voice-3.0'
      ||request.headers.get('Authorization')!=='Bearer test-key'||request.headers.get('Upgrade')!=='websocket')throw new Error('Unexpected journey provider request');
    const state=this.journey,pair=new WebSocketPair(),socket=pair[1];state.socket=socket;state.connections++;
    state.emit=event=>socket.send(JSON.stringify({event_id:'journey_'+(++state.sequence),...event}));
    socket.accept();socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);state.events.push(message.type);
      if(message.type==='session.update'){state.configurations++;state.emit({type:'session.updated',session:message.session});}
      else if(message.type==='input_audio_buffer.append'){
        const raw=atob(message.audio);state.appends++;state.audioBytes+=raw.length;
        if([...raw].every(value=>value.charCodeAt(0)===0))state.silenceFrames++;
        state.firstAudioAt??=Date.now();state.lastAudioAt=Date.now();
      }else if(message.type==='conversation.item.create'&&message.item.type==='function_call_output')state.tools.push({id:message.item.call_id,...JSON.parse(message.item.output)});
      else if(message.type==='response.create')state.responses++;
      else if(message.type==='conversation.item.truncate'){
        state.truncations.push({itemId:message.item_id,audioEndMs:message.audio_end_ms});
        state.emit({type:'conversation.item.truncated',item_id:message.item_id,content_index:message.content_index,audio_end_ms:message.audio_end_ms,
          transcript:(state.answerTexts[message.item_id]||'').split(' ')[0]});
      }
      else if(message.type==='response.cancel'&&state.currentResponse)state.emit({type:'response.done',response:{id:state.currentResponse,status:'cancelled'}});
    });
    socket.addEventListener('close',()=>{state.closes++;try{socket.close(1000);}catch{/* already closed */}});
    state.emit({type:'session.created',session:{id:'journey_provider',model:'grok-voice-3.0'}});
    state.emit({type:'conversation.created',conversation:{id:'journey_conversation'}});
    return new Response(null,{status:101,webSocket:pair[0]});
  }
  snapshot(){const state=this.journey;return state?Object.fromEntries(Object.entries(state).filter(([key])=>!['socket','emit'].includes(key))):{enabled:false};}
}
export default lifecycleProvider;
