async function runCanvasVoiceNativeBrowserJourney({page,native},expect,info){
  const {projectId}=native.identity,base=`/api/account/canvas/projects/${projectId}/agent/voice`;
  const german=info.project.name.includes('webkit'),observed=[];let socketError;
  const fetchNative=async(url,method='GET',body,headers={})=>{
    const result=await native.call('fetch',{url,method,body:body===undefined?undefined:JSON.stringify(body),headers});
    const value=JSON.parse(Buffer.from(result.body,'base64'));expect(result.status,JSON.stringify(value)).toBe(200);return value.data;
  };
  const provider=input=>native.call('provider',input);
  const invoke=async(name,args,id)=>{
    await provider({command:'call',id,name,arguments:args});
    await expect.poll(async()=>{const state=await provider();return state.tools.find(value=>value.id===id)||null;}).not.toBeNull();
    return (await provider()).tools.find(value=>value.id===id);
  };
  const context=async id=>{const result=await invoke('canvas_context',{},id);expect(result.ok,JSON.stringify(result)).toBe(true);return result.data;};
  try{
    await fetchNative(base+'/settings','POST',{expectedRevision:0,settings:{tools:{canvas:{enabled:true}},preferences:{language:german?'de':'en'}}},{'Idempotency-Key':'browser-native-settings'});
    await page.route('**/voice-native-journey',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${german?'de':'en'}"><head><link rel="stylesheet" href="/css/base/tokens.css"><link rel="stylesheet" href="/css/pages/canvas.css"><link rel="stylesheet" href="/css/pages/canvas-voice.css"></head><body style="background:#101217;color:#fff"><main id="voiceRoot"></main><button id="unlock">Start synthetic microphone source</button></body></html>`}));
    await page.route('**/api/**',async route=>{
      try{const request=route.request(),result=await native.call('fetch',{url:request.url(),method:request.method(),body:request.postData(),headers:{
        ...(request.headers()['idempotency-key']?{'Idempotency-Key':request.headers()['idempotency-key']}:{}),
        ...(request.headers()['x-bitbi-tariff-revision']?{'X-Bitbi-Tariff-Revision':request.headers()['x-bitbi-tariff-revision']}:{}),
      }});await route.fulfill({status:result.status,headers:result.headers,body:Buffer.from(result.body,'base64')});
      }catch(error){socketError=error;await route.abort();}
    });
    await page.routeWebSocket(/\/agent\/voice\/sessions\/[^/]+\/socket$/,socket=>{
      native.setSocket(data=>{observed.push(JSON.parse(data));socket.send(data);},event=>socket.close({code:event.code,reason:event.reason}));
      socket.onMessage(data=>{void native.call('send',data).catch(error=>{socketError=error;});});
      socket.onClose(()=>{void native.call('close').catch(()=>{});});
      void native.call('socket',{url:socket.url()}).catch(error=>{socketError=error;socket.close();});
    });
    await page.exposeFunction('nativeVoiceChanged',async()=>{
      const snapshot=await native.call('snapshot');return {revision:snapshot.conversation.revision,briefRevision:snapshot.conversation.brief_revision,projectRevision:0};
    });
    await page.goto('/voice-native-journey');
    await page.evaluate(async({projectId,german})=>{
      window.snapshot={revision:0,briefRevision:0,projectRevision:0};window.micCalls=0;
      const source=new AudioContext({sampleRate:german?44100:48000}),destination=source.createMediaStreamDestination(),tone=source.createOscillator(),gain=source.createGain();
      tone.frequency.value=220;gain.gain.value=.08;tone.connect(gain);gain.connect(destination);tone.start();
      window.source={context:source,tone,gain,stream:destination.stream};
      document.querySelector('#unlock').onclick=()=>source.resume();
      Object.defineProperty(MediaDevices.prototype,'getUserMedia',{configurable:true,value:async()=>{window.micCalls++;return destination.stream;}});
      const {createCanvasVoice}=await import('/js/pages/canvas/voice.js');
      window.voice=createCanvasVoice({root:document.querySelector('#voiceRoot'),german,getSnapshot:()=>window.snapshot,
        onChanged:()=>{window.refresh=window.nativeVoiceChanged().then(value=>{window.snapshot=value;});}});
      window.voice.projectChanged(projectId);window.voice.setVisible(true);
    },{projectId,german});
    await page.locator('#unlock').click();await expect.poll(()=>page.evaluate(()=>window.source.context.state)).toBe('running');
    await page.locator('[data-canvas-voice="toggle"]').click();const approval=page.getByRole('dialog');
    await approval.getByRole('spinbutton').fill('60');await approval.getByRole('button',{name:german?'Kosten prüfen':'Review cost',exact:true}).click();
    await approval.getByRole('checkbox').check();await approval.getByRole('button',{name:german?'Mikrofon freigeben und starten':'Allow microphone and start',exact:true}).click();
    await expect(page.locator('.canvas-voice__status')).toHaveText(german?'Hört zu':'Listening');
    await expect.poll(async()=>(await provider()).appends).toBeGreaterThan(2);
    const turns=german?['Hallo.','Ich möchte einen lustigen Film über eine Dackeldame.','Ungefähr 12 Sekunden, realistisch, mit Hintergrundmusik.','Korrektur: lieber Cartoon.','Querformat 16:9, die übrigen kreativen Entscheidungen überlasse ich dir.','Noch nicht starten.','Maximal dreitausend Credits.','Ja, starte jetzt.']:
      ['Hello.','I want a funny film about a female dachshund.','Approximately 12 seconds, realistic, with background music.','Correction: cartoon instead.','Landscape 16:9. You may choose the remaining creative details.','Do not start yet.','At most three thousand credits.','Yes, start now.'];
    const replies=german?['Hallo, welchen Film möchtest du erstellen?','Welche Dauer und welchen Stil möchtest du?','Realistisch mit Musik.','Cartoon ist gespeichert.','Ich bereite dein Briefing vor.','Ich starte noch nicht.']:
      ['Hello, what film would you like?','What duration and style would you like?','Realistic with music.','Cartoon is saved.','I am preparing your brief.','I am not starting yet.'];
    let interruptedPosition;
    const startedAt=Date.now();
    for(let index=0;index<turns.length;index++){
      const at=startedAt+(index===3?2*3800+300:index*3800);if(at>Date.now())await page.waitForTimeout(at-Date.now());
      await provider({command:'turn',id:'browser_turn_'+index,text:turns[index],replay:index===1});
      await expect.poll(async()=>(await native.call('snapshot')).turns.filter(value=>value.user_text).length).toBe(index+1);
      if(index===1||index===2||index===3||index===4){
        const current=await context('context_'+index);
        const updates=index===1?[{field:'story',value:german?'Eine lustige Dackeldame am Pool.':'A funny female dachshund at the pool.',provenance:'user_stated'}]:index===2?[
          {field:'style',value:german?'realistisch':'realistic',provenance:'user_stated'},{field:'audio',value:german?'Hintergrundmusik':'background music',provenance:'user_stated'},
        ]:index===3?[{field:'style',value:'Cartoon',provenance:'corrected'}]:[];
        const result=await invoke('canvas_update_brief',{expectedConversationRevision:current.conversationRevision,expectedBriefRevision:current.briefRevision,expectedProjectRevision:current.projectRevision,
          updates,questions:[],format:index===4?{aspectRatio:'16:9',resolution:null,provenance:'user_stated'}:null,duration:index===2?{choice:'explicit',targetDurationSeconds:12}:null},'brief_'+index);
        expect(result.ok,JSON.stringify(result)).toBe(true);
      }
      if(index<6){
        const next=index===5?await invoke('canvas_prepare_next_step',{},'prepare_budget'):null;
        if(next)expect(next.ok,JSON.stringify(next)).toBe(true);
        await provider({command:'answer',id:'answer_'+index,text:next?.data.spokenPrompt||replies[index],milliseconds:index===2?800:index===5?1000:160,open:index===2});
        if(index===2)await expect(page.locator('.canvas-voice__status')).toHaveText(german?'Spricht':'Speaking');
        if(index===3){
          await expect.poll(async()=>(await native.call('snapshot')).voiceTurns.find(turn=>turn.provider_response_id==='answer_2')?.interrupted).toBe(1);
          const interrupted=(await native.call('snapshot')).voiceTurns.find(turn=>turn.provider_response_id==='answer_2');
          expect(interrupted.retained_text).toBe(german?'Realistisch':'Realistic');expect(interrupted.heard_audio_ms).toBeGreaterThan(0);expect(interrupted.heard_audio_ms).toBeLessThan(800);interruptedPosition=interrupted.heard_audio_ms;
        }
        if(index===4){await page.evaluate(()=>{window.source.gain.gain.value=0;});await page.waitForTimeout(650);await page.evaluate(()=>{window.source.gain.gain.value=.08;});}
      }else{
        const result=await invoke('canvas_decision',{},'decision_'+index);expect(result.ok,JSON.stringify(result)).toBe(true);
        if(index===6){expect(result.data.spokenPrompt).toContain('3000');await provider({command:'answer',id:'budget_prompt',text:result.data.spokenPrompt,milliseconds:1000});}
      }
      expect(socketError).toBeUndefined();expect(observed.filter(value=>value.type==='voice.ended')).toEqual([]);
    }
    const stored=await native.call('snapshot');expect(stored.runs).toHaveLength(1);expect(stored.runs[0]).toMatchObject({budget_credits:3000});
    const brief=JSON.parse(stored.conversation.brief_json);expect(brief.fields.style.value).toBe('Cartoon');expect(brief.fields.audio.value).toBe(german?'Hintergrundmusik':'background music');expect(brief.duration.targetDurationSeconds).toBe(12);
    expect(stored.voiceTurns.find(turn=>turn.provider_response_id==='answer_2').heard_audio_ms).toBe(interruptedPosition);
    const replay=await invoke('canvas_decision',{},'decision_replay');expect(replay.ok).toBe(true);
    const replayRunCount=(await native.call('snapshot')).runs.length;expect(replayRunCount).toBe(1);
    const state=await provider();expect(state.connections).toBe(1);expect(state.lastAudioAt-state.firstAudioAt).toBeGreaterThan(25000);expect(state.appends).toBeGreaterThan(200);
    expect(state.silenceFrames).toBeGreaterThan(0);expect(state.truncations.filter(value=>value.itemId==='answer_2_audio')).toHaveLength(1);
    expect(await page.evaluate(()=>window.micCalls)).toBe(1);
    await page.locator('[data-canvas-voice="toggle"]').click();
    await expect.poll(async()=>(await native.call('snapshot')).sessions[0].state).toBe('completed');
    const afterStop=await native.call('snapshot');expect(afterStop.runs).toHaveLength(1);expect(['queued','planning','running','exporting']).toContain(afterStop.runs[0].status);
    await expect.poll(()=>page.evaluate(()=>window.source.stream.getTracks().every(track=>track.readyState==='ended'))).toBe(true);
    const acceptance={turns:turns.length,captureDurationMs:state.lastAudioAt-state.firstAudioAt,connections:state.connections,appends:state.appends,
      productionRun:stored.runs[0].id,runCount:stored.runs.length,replayRunCount,savedBrief:JSON.parse(stored.conversation.brief_json),
      microphoneCalls:await page.evaluate(()=>window.micCalls),captureSampleRate:await page.evaluate(()=>window.source.context.sampleRate),
      sessionCompleted:true,productionSurvivesVoiceStop:true,bargeInVerified:true,retainedInterruptionMs:interruptedPosition,silenceFrames:state.silenceFrames,
      syntheticMicrophone:true,syntheticProvider:true};
    await info.attach('native-multiturn-evidence',{body:JSON.stringify({...acceptance,runtimeArtifacts:native.artifacts}),contentType:'application/json'});
    return acceptance;
  }catch(error){
    const state=await provider().catch(()=>null);
    await info.attach('failed-journey',{body:JSON.stringify({message:error.message,stack:error.stack,socketError:socketError?.message,
      observed:observed.map(({type,state,code,stage})=>({type,state,code,stage})),
      provider:state&&{connections:state.connections,appends:state.appends,turns:state.turns,tools:state.tools.map(({id,ok,code,data})=>({id,ok,code,applied:data?.applied,executed:data?.executed}))},
      persisted:await native.call('snapshot').catch(()=>null)}),contentType:'application/json'});throw error;
  }finally{await page.evaluate(()=>{window.voice?.destroy();window.source?.tone.stop();return window.source?.context.close();}).catch(()=>{});}
}
module.exports={runCanvasVoiceNativeBrowserJourney};
