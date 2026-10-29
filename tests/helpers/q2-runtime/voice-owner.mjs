import assert from 'node:assert/strict';

export async function runCanvasVoiceOwnerTest(f){
 for(const fault of [null,'item','time','control'])await ownerInterruption(f,fault);
}
async function ownerInterruption(f,fault){
 const name=fault?'interrupt-'+fault:'normal',provider=await f.mf.getWorker('q2-voice-provider');
 const configured=await provider.fetch('https://voice-fixture.invalid/control',{method:'POST',body:JSON.stringify({fault})});
 assert.equal(configured.status,200,'Previous isolated provider connection must be closed before fixture reset');
 const seeded=await f.control('/canvas-voice-owner-seed',{name});assert.equal(seeded.status,200,await seeded.clone().text());
 const {userId,projectId,sessionId}=await seeded.json();
 const path=`https://bitbi.ai/api/account/canvas/projects/${projectId}/agent/voice`;
 const request=(suffix='',body,extra={})=>f.mf.dispatchFetch(path+suffix,{method:body===undefined?'GET':'POST',headers:{
  Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${userId}`,'Content-Type':'application/json',...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const json=async response=>{assert.equal(response.status,200,await response.clone().text());return (await response.json()).data;};
 const config=await json(await request());assert.equal(config.availability.available,true);
 const settings=await json(await request('/settings',{settings:{turn_detection:{type:null},tools:{canvas:{enabled:true}}},expectedRevision:0},{'Idempotency-Key':'native-owner-settings'}));
 assert.equal(settings.revision,1);
 const input={maxDurationSeconds:30,settingsRevision:1,expectedConversationRevision:0,expectedBriefRevision:0,expectedProjectRevision:0};
 const {quote}=await json(await request('/quote',input));assert.equal(quote.capCredits,54);
 const body={...input,requestId:sessionId,quoteId:quote.id,capCredits:quote.capCredits,consent:true};
 const first=await json(await request('/sessions',body,{'Idempotency-Key':sessionId}));assert.equal(first.session.state,'admitted');
 assert.equal((await json(await request('/sessions',body,{'Idempotency-Key':sessionId}))).replay,true);
 const endpoint=`/sessions/${sessionId}/socket`;
 assert.equal((await request(endpoint,undefined,{Upgrade:'websocket',Cookie:'__Host-bitbi_session=voice-native-other-'+name})).status,404);
 const upgraded=await request(endpoint,undefined,{Upgrade:'websocket'});assert.equal(upgraded.status,101,upgraded.status===101?'':await upgraded.text());
 const socket=upgraded.webSocket,events=[];let sequence=0;
 const message=value=>socket.send(JSON.stringify({...value,sequence:sequence++}));
 const wait=async predicate=>{
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(events.some(predicate))return;const ended=events.find(event=>event.type==='voice.ended');assert.equal(ended,undefined,JSON.stringify({ended,events}));await new Promise(resolve=>setTimeout(resolve,20));}
  const snapshot=await (await provider.fetch('https://voice-fixture.invalid/state')).json();
  const stored=await f.db.prepare('SELECT state,stop_requested FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first();
  assert.fail('Native owner event timeout: '+JSON.stringify({stored,closed:snapshot.closes,socket:socket.readyState,responses:snapshot.responses,tools:snapshot.toolOutputs,tail:events.slice(-3).map(({type,state,code})=>({type,state,code}))}));
 };
 socket.addEventListener('message',event=>events.push(JSON.parse(event.data)));socket.accept();
 try{
  await wait(event=>event.type==='voice.state'&&event.state==='listening');
  assert.equal((await request(endpoint,undefined,{Upgrade:'websocket'})).status,409,'Duplicate connection cannot dispatch another provider session');
  const audio=Buffer.alloc(960).toString('base64');
  for(let packet=0;packet<100;packet++){message({type:'audio.append',audio});await new Promise(resolve=>setTimeout(resolve,20));}
  message({type:'audio.commit'});
  await wait(event=>event.type==='voice.audio');
  await wait(event=>event.type==='voice.turn'&&event.state==='ready');
  const brief=await f.db.prepare('SELECT brief_json,brief_revision,assistant_model_id FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
  assert.equal(JSON.parse(brief.brief_json).fields.style.value,'Cartoon');assert.equal(brief.brief_revision,1);
  assert.notEqual(brief.assistant_model_id,'grok-voice-3.0','Voice does not switch the text model');
  const turns=(await f.db.prepare('SELECT user_text,assistant_text FROM canvas_agent_turns WHERE project_id=?').bind(projectId).all()).results;
  assert.equal(turns.length,1);assert.match(turns[0].user_text,/45 Sekunden/);assert.match(turns[0].assistant_text,/Auflösung/);
  const conversation=await json(await f.mf.dispatchFetch(`https://bitbi.ai/api/account/canvas/projects/${projectId}/agent/conversation`,{headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${userId}`}}));
  const reply=conversation.conversation.messages.find(message=>message.role==='assistant');
  assert.equal(reply.provenance,'model');assert.equal(reply.delivery.source,'provider');assert.equal(reply.modelId,'grok-voice-3.0');
  assert.equal(reply.channel,'voice');assert.equal(reply.playback,'not_verified');assert.equal(reply.delivery.blocking,false);
  const before=await (await provider.fetch('https://voice-fixture.invalid/state')).json();
  assert.equal(before.connections,1);assert.equal(before.appends,100);assert.equal(before.bytes,96000);assert.equal(before.textItems,0);
  assert.equal(before.configuration.model,'grok-voice-3.0');assert.equal(before.configuration.hasCanvasRole,true);assert.equal(before.configuration.hasSyntheticPrivateContext,true);
  assert.deepEqual(before.toolOutputs.map(item=>item.ok),[true,true]);assert.equal(before.toolOutputs[1].applied,true);
  const storedReply=()=>f.db.prepare(`SELECT t.assistant_text,v.interrupted,v.retained_text,v.heard_audio_ms FROM canvas_agent_turns t
    JOIN canvas_voice_turns v ON v.turn_id=t.id WHERE v.session_id=? AND v.provider_response_id='answer_3'`).bind(sessionId).first();
  const listening=()=>events.filter(event=>event.type==='voice.state'&&event.state==='listening').length;
  for(let acknowledgement=1;acknowledgement<=(fault?1:4);acknowledgement++){
   const count=listening();
   message({type:'voice.interrupt',responseId:'answer_3',itemId:'answer_item',audioEndMs:50});
   if(fault){
    const code=fault==='control'?'canvas_voice_interruption_invalid':'canvas_voice_truncation_unconfirmed';
    await wait(event=>event.type==='voice.ended'&&event.code===code);break;
   }
   // Request/ACK each refresh the actual session; its two real configuration
   // acknowledgements plus the provider completion fence prove ACK processing.
   await wait(()=>listening()>=count+3);
   const saved=await storedReply();assert.equal(saved.assistant_text,turns[0].assistant_text,'Truncation never rewrites original generated evidence');
   assert.equal(saved.interrupted,1);assert.equal(saved.heard_audio_ms,50);
   assert.equal(saved.retained_text,acknowledgement===1?null:'Welche Auflösung',
    'Unverifiable text stays unknown; later valid, missing and empty acknowledgements preserve the verified prefix');
   const view=await json(await f.mf.dispatchFetch(`https://bitbi.ai/api/account/canvas/projects/${projectId}/agent/conversation`,{headers:{Origin:'https://bitbi.ai',Cookie:`__Host-bitbi_session=${userId}`}}));
   const projected=view.conversation.messages.find(value=>value.role==='assistant');
   assert.equal(projected.provenance,acknowledgement===1?'application':'model');assert.equal(projected.playback,'not_verified');
   assert.equal((await f.db.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first()).state,'active');
  }
  if(!fault){
   const ready=events.filter(event=>event.type==='voice.turn'&&event.state==='ready').length;
   message({type:'audio.append',audio});message({type:'audio.commit'});
   await wait(()=>events.filter(event=>event.type==='voice.turn'&&event.state==='ready').length>ready);
   assert.deepEqual(events.filter(event=>event.type==='voice.speech_started'),[{type:'voice.speech_started'}],'The next speech signal never reactivates the already interrupted answer IDs');
   const following=(await f.db.prepare('SELECT user_text,assistant_text FROM canvas_agent_turns WHERE project_id=? ORDER BY rowid').bind(projectId).all()).results;
   assert.equal(following.length,2);assert.deepEqual(following[0],turns[0]);
   assert.equal(following[1].user_text,'Welche Auflösung ist möglich?');assert.equal(following[1].assistant_text,'Wir können die passende Auflösung gemeinsam auswählen.');
   assert.equal((await f.db.prepare('SELECT brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first()).brief_revision,1);
   message({type:'voice.stop'});await wait(event=>event.type==='voice.ended'&&event.code==='canvas_voice_stopped');
  }
  const deadline=Date.now()+8000;let state;
  do{state=await f.db.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first();if(state.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
  assert.equal(state.state,'completed','Observed clean provider close settles the original session');
  for(let replay=0;replay<2;replay++)await json(await request(`/sessions/${sessionId}/stop`,{},{'Idempotency-Key':sessionId}));
  const debits=(await f.db.prepare('SELECT amount FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).all()).results;
  assert.deepEqual(debits.map(row=>row.amount),[-9],'Original and follow-up audio remain within one started10s block, charged exactly once');
  const finalProvider=await (await provider.fetch('https://voice-fixture.invalid/state')).json();
  assert.equal(finalProvider.connections,1);assert.equal(finalProvider.responses,fault?3:4);assert.equal(finalProvider.appends,fault?100:101);
  const usage=await f.db.prepare("SELECT metadata_json FROM member_ai_usage_attempts_v2 WHERE json_extract(metadata_json,'$.canvas_voice.session_id')=?").bind(sessionId).first();
  const terminal=JSON.parse(usage.metadata_json).canvas_voice_terminal_diagnostic;
  assert.equal(terminal.code,fault==='control'?'canvas_voice_interruption_invalid':fault?'canvas_voice_truncation_unconfirmed':'canvas_voice_stopped');
  assert.deepEqual([terminal.stage,terminal.direction],[fault==='control'?'reply_projection':fault?'provider_frame':'stop',fault?'provider_to_server':'browser_to_server']);
  await json(await request(`/sessions/${sessionId}/stop`,{},{'Idempotency-Key':sessionId}));
  const repeated=await f.db.prepare("SELECT json_extract(metadata_json,'$.canvas_voice_terminal_diagnostic') AS terminal FROM member_ai_usage_attempts_v2 WHERE json_extract(metadata_json,'$.canvas_voice.session_id')=?").bind(sessionId).first();
  assert.deepEqual(JSON.parse(repeated.terminal),terminal,'The native owner, settlement and repeated stop retain the original content-free cause');
  const diagnostics=JSON.parse(usage.metadata_json).canvas_voice_projection_errors||[];
  assert.deepEqual(diagnostics,fault?[]:['canvas_voice_retained_text_unverified'],'Only the specific correlation-safe mismatch receives a bounded diagnostic');
  const original=await storedReply();assert.equal(original.assistant_text,turns[0].assistant_text);
  assert.equal(original.retained_text,fault?null:'Welche Auflösung');
  assert.equal(original.heard_audio_ms,50,'Following speech and response preserve the original confirmed interruption position');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n,0,'Voice cannot silently launch text or production');
 }finally{try{socket.close(1000);}catch{}}
}
