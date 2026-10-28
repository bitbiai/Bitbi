// Native workerd WebSocket provider double. Only the isolated canvas-voice
// runtime binds outbound traffic here; no provider key or public network.
const initial = () => ({ connections: 0, appends: 0, bytes: 0, textItems: 0, responses: 0, closes: 0, toolOutputs: [], configuration: null, truncations: 0 });
let state = initial(), fault = null;
export default {
 async fetch(request) {
  const url = new URL(request.url);
  if(url.origin==='https://voice-fixture.invalid' && url.pathname==='/state') return Response.json(state);
  if(url.origin==='https://voice-fixture.invalid' && url.pathname==='/control' && request.method==='POST') {
   const input=await request.json();
   if(![null,'item','time','control'].includes(input.fault)||state.connections!==state.closes)return new Response(null,{status:409});
   state=initial();fault=input.fault;return Response.json(state);
  }
  if(url.href!=='https://api.x.ai/v1/realtime?model=grok-voice-3.0' || request.method!=='GET'
    ||request.headers.get('Upgrade')!=='websocket'||request.headers.get('Authorization')!=='Bearer test-key') throw new Error('Native Voice unexpected outbound request');
  const pair=new WebSocketPair(),socket=pair[1]; socket.accept(); state.connections++;
  let sequence=0,context=null,commits=0;
  const emit=value=>socket.send(JSON.stringify({event_id:'synthetic_'+(++sequence),...value}));
  const call=(name,args,number)=>{
   const responseId='response_'+number;
   emit({type:'response.created',response:{id:responseId}});
   emit({type:'response.function_call_arguments.done',response_id:responseId,call_id:'call_'+number,name,arguments:JSON.stringify(args)});
   emit({type:'response.done',response:{id:responseId,status:'completed'}});
  };
  socket.addEventListener('close',event=>{state.closes++;try{socket.close(event.code===1000?1000:1001);}catch{}});
  socket.addEventListener('message',event=>{
   const item=JSON.parse(event.data);
   if(item.type==='session.update'){
    state.configuration={model:item.session.model,hasCanvasRole:item.session.instructions.includes('Canvas'),voice:item.session.voice,
      tools:item.session.tools.map(tool=>tool.name),hasSyntheticPrivateContext:item.session.instructions.includes('Voice native fixture')};
    emit({type:'session.updated',session:item.session});
   }else if(item.type==='input_audio_buffer.append'){state.appends++;state.bytes+=atob(item.audio).length;}
   else if(item.type==='input_audio_buffer.commit'){
    const item_id=++commits===1?'spoken_cat':'spoken_followup';
    if(commits>2)throw new Error('Unexpected extra user turn');
    if(commits===2)emit({type:'input_audio_buffer.speech_started',item_id});
    emit({type:'input_audio_buffer.committed',item_id});
    emit({type:'conversation.item.input_audio_transcription.updated',item_id,transcript:'Ein Katzenvideo'});
    emit({type:'conversation.item.input_audio_transcription.completed',item_id,transcript:commits===1?'Ein Katzenvideo, 45 Sekunden lang, im Cartoon-Stil und 16:9.':'Welche Auflösung ist möglich?'});
   }else if(item.type==='conversation.item.truncate'){
    if(item.item_id!=='answer_item'||item.content_index!==0||item.audio_end_ms!==50)throw new Error('Unexpected truncation request');
    state.truncations++;
    const transcript=fault==='control'?'Welche\u0000':state.truncations===1?'Welche  Auflösung':state.truncations===2?'Welche Auflösung':state.truncations===4?'':undefined;
    emit({type:'conversation.item.truncated',item_id:fault==='item'?'foreign_item':item.item_id,content_index:0,
      audio_end_ms:fault==='time'?51:item.audio_end_ms,...(transcript===undefined?{}:{transcript})});
    // Existing protocol completion gives an observable, content-free queue fence.
    emit({type:'response.done',response:{id:'truncation_barrier_'+state.truncations,status:'completed'}});
   }else if(item.type==='conversation.item.create'){
    if(item.item.type==='function_call_output'){
     const output=JSON.parse(item.item.output);state.toolOutputs.push({callId:item.item.call_id,ok:output.ok,code:output.code,applied:output.data?.applied});
     if(item.item.call_id==='call_1')context=output.data;
    }else state.textItems++;
   }else if(item.type==='response.create'){
    state.responses++;
    if(state.responses===1)call('canvas_context',{},1);
    else if(state.responses===2){
     if(!context)throw new Error('Missing authoritative context');
     call('canvas_update_brief',{expectedConversationRevision:context.conversationRevision,expectedBriefRevision:context.briefRevision,expectedProjectRevision:context.projectRevision,
      updates:[{field:'story',value:'Eine Katze erkundet den Garten.',provenance:'user_stated'},{field:'style',value:'Cartoon',provenance:'user_stated'}],questions:['Welche Auflösung?'],
      format:{aspectRatio:'16:9',resolution:null,provenance:'user_stated'},duration:{choice:'explicit',targetDurationSeconds:45}},2);
    }else if(state.responses===3){
     emit({type:'response.created',response:{id:'answer_3'}});
     emit({type:'response.output_item.added',response_id:'answer_3',item:{id:'answer_item',type:'message'}});
     emit({type:'response.output_audio.delta',response_id:'answer_3',item_id:'answer_item',delta:btoa('\0'.repeat(4800))});
     emit({type:'response.output_audio_transcript.delta',response_id:'answer_3',item_id:'answer_item',delta:'Welche Auflösung möchtest du für dein Katzenvideo?'});
     emit({type:'response.done',response:{id:'answer_3',status:'completed'}});
    }else if(state.responses===4&&commits===2){
     emit({type:'response.created',response:{id:'answer_4'}});
     emit({type:'response.output_item.added',response_id:'answer_4',item:{id:'followup_item',type:'message'}});
     emit({type:'response.output_audio.delta',response_id:'answer_4',item_id:'followup_item',delta:btoa('\0'.repeat(4800))});
     emit({type:'response.output_audio_transcript.delta',response_id:'answer_4',item_id:'followup_item',delta:'Wir können die passende Auflösung gemeinsam auswählen.'});
     emit({type:'response.done',response:{id:'answer_4',status:'completed'}});
    }else throw new Error('Unexpected repeated inference');
   }else throw new Error('Unexpected Voice provider command');
  });
  emit({type:'session.created',session:{id:'native_provider_session',model:'grok-voice-3.0'}});
  emit({type:'conversation.created',conversation:{id:'native_provider_conversation'}});
  return new Response(null,{status:101,webSocket:pair[0]});
 }
};
