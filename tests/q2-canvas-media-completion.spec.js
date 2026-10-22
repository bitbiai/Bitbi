const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const fs=require('node:fs'),path=require('node:path');
const media=()=>Object.fromEntries([['videoBase64','canvas-end-frame.mp4'],['imageBase64','member-image.png'],['musicBase64','member-music.mp3']]
  .map(([key,file])=>[key,fs.readFileSync(path.join(__dirname,'fixtures/media',file)).toString('base64')]));
for(const name of ['resume','automatic','lost-ack','missing-storage','edited','adopt-current','unknown','cancelled','expired','foreign','completion-window','proof-recheck'])test(`Canvas media completion recovery ${name}`,async()=>{
  const DB=new SqliteD1Database();applyAuthMigrations(DB);
  try{
    const {canvasMediaCompletionCase}=await import('./helpers/canvas-agent-media-completion-control.mjs');
    const result=await canvasMediaCompletionCase({...createAuthTestEnv(),DB},name,media());
    expect(result.case).toBe(name);expect(result.mediaCalls).toBe(1);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  }finally{DB.close();}
});

test('Canvas selected media policy completes a real mixed film and independent editable re-export',async()=>{
  test.setTimeout(90000);
  const os=require('node:os'),{execFileSync}=require('node:child_process');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-media-completion-')),DB=new SqliteD1Database();applyAuthMigrations(DB);
  const ffmpeg=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args]);
  try{
    const clips=[];
    for(const color of ['red','lime','blue','yellow']){
      const file=path.join(dir,color+'.mp4');ffmpeg(['-f','lavfi','-i',`color=c=${color}:size=160x90:rate=24:duration=4`,
        '-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);clips.push(fs.readFileSync(file).toString('base64'));
    }
    const music=path.join(dir,'music.mp3');ffmpeg(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=12','-c:a','libmp3lame',music]);
    const {canvasMediaCompletionCase}=await import('./helpers/canvas-agent-media-completion-control.mjs');
    const {processCanvasExports,inspectClip}=await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
    const {processCanvasInspections}=await import('../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
    const {default:worker}=await import('../workers/auth/src/index.js');
    const request=(f,url,init)=>init.body instanceof FormData?f.atClock(async()=>{
      const pending=[];const response=await worker.fetch(new Request(new URL(url,'https://bitbi.ai'),init),f.env,{waitUntil:p=>pending.push(p)});
      await Promise.all(pending);return response;
    }):f.request(url,init.method||'GET',init.body,init.headers);
    const options=f=>({baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
      requestJson:async(url,init={})=>{const response=await request(f,url,{...init,headers:{Authorization:'Bearer synthetic-audio-processor',...init.headers}});
        const body=await response.json();expect(response.ok,JSON.stringify(body)).toBe(true);return body;},
      fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',undefined,init.headers)});
    const processor=async f=>{await processCanvasInspections(options(f));await processCanvasExports(options(f));};
    const mediaPolicy={mode:'selected',models:[
      {modelId:'xai/grok-imagine-image-2.0',creditLimit:1000},
      {modelId:'minimax/h3',creditLimit:4000},
      {modelId:'elevenlabs/music-v2',creditLimit:2000},
    ]};
    const policyBeforeResume={mode:'selected',models:mediaPolicy.models.filter(model=>model.modelId!=='xai/grok-imagine-image-2.0')};
    const finished=await canvasMediaCompletionCase({...createAuthTestEnv(),DB},'resume',
      {...media(),videoBase64:clips[0],videoSourcesBase64:clips,musicBase64:fs.readFileSync(music).toString('base64')},{processor,mediaPolicy,policyBeforeResume});
    const f=finished.fixture,download=async(assetId,name)=>{
      const response=await f.request(`/api/ai/text-assets/${assetId}/file`);expect(response.ok).toBe(true);
      const file=path.join(dir,name+'.mp4');fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));return file;
    };
    const file=await download(finished.result.assetId,'final'),measured=await inspectClip(file);
    expect(measured.videoDuration).toBe(12);ffmpeg(['-xerror','-i',file,'-f','null','-']);
    const colorAt=(file,time)=>[...ffmpeg(['-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])];
    for(const [i,t] of [2,6,10].entries()){const rgb=colorAt(file,t);expect(rgb[i]).toBeGreaterThan(200);expect(rgb.filter((_,j)=>j!==i).every(v=>v<35)).toBe(true);}
    const pcm=ffmpeg(['-i',file,'-t','2','-ac','1','-ar','8000','-f','f32le','pipe:1']);
    const samples=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4),energy=frequency=>{
      let re=0,im=0;for(let i=0;i<samples.length;i++){re+=samples[i]*Math.cos(2*Math.PI*frequency*i/8000);im+=samples[i]*Math.sin(2*Math.PI*frequency*i/8000);}return Math.hypot(re,im)/samples.length;
    };
    expect(energy(660)).toBeGreaterThan(.015);expect(energy(660)).toBeGreaterThan(energy(440)*20);
    let before=await f.data(await f.request(f.projectPath)),assembly=before.project.assembly,order=assembly.clips.map(c=>c.nodeId);
    expect(order).toHaveLength(3);expect(before.nodes.filter(n=>n.type==='image_generation')).toHaveLength(1);
    const policyView=await f.data(await f.request(f.route+'/media-policy'));
    expect(policyView.policy).toEqual({revision:2,mode:'selected',models:[...policyBeforeResume.models].sort((a,b)=>a.modelId.localeCompare(b.modelId))});
    for(const model of mediaPolicy.models){
      const usage=policyView.usage.find(item=>item.modelId===model.modelId);
      expect(usage.chargedCredits).toBeGreaterThan(0);
      expect(usage).toMatchObject({reservedCredits:0,pendingOutcomeCredits:0,committedCredits:usage.chargedCredits,remainingCredits:policyBeforeResume.models.some(m=>m.modelId===model.modelId)?model.creditLimit-usage.chargedCredits:null});
    }
    // Deselecting a generator affects future assistant submissions. Existing
    // footage and explicit manual execution retain their ordinary semantics.
    await f.data(await f.request(f.route+'/media-policy','PUT',{
      expectedRevision:2,mode:'selected',models:[mediaPolicy.models[0]],
    },{'Idempotency-Key':'fixture-post-film-model-selection'}));
    // Existing editable assembly, independent of agent availability.
    f.env.CANVAS_AGENT_ENABLED='false';f.env.AI_LAB={fetch(){throw new Error('Manual export cannot invoke the assistant');}};
    const first=before.nodes.find(n=>n.id===order[0]);
    await f.data(await f.request(`${f.projectPath}/nodes/${first.id}`,'PATCH',{config:{...first.config,prompt:'A manually changed yellow scene.'}}));
    expect((await f.request(`${f.projectPath}/nodes/${first.id}/run`,'POST',{}, {'Idempotency-Key':'synthetic-manual-media-variant'})).status).toBe(202);
    const newJob=await DB.prepare("SELECT * FROM member_generation_jobs WHERE user_id=? AND status='queued'").bind(f.owner).first();
    await finished.deliverMediaJob(newJob);expect(finished.generationCalls()).toBe(6);
    const manualPolicy=await f.data(await f.request(f.route+'/media-policy'));
    expect(manualPolicy.usage.map(({remainingCredits,...costs})=>costs)).toEqual(policyView.usage.map(({remainingCredits,...costs})=>costs));
    before=await f.data(await f.request(f.projectPath));
    const revised={...assembly,clips:[{...assembly.clips[2],transition:{preset:'fade',duration:.5}},assembly.clips[0]],anchorNodeId:assembly.anchorNodeId,backgroundMusic:{...assembly.backgroundMusic,gain:.25}};
    await f.data(await f.request(f.projectPath+'/assembly','PATCH',{revision:before.project.revision,assembly:revised}));
    await f.data(await f.request(`${f.projectPath}/nodes/${order[1]}`,'DELETE'));
    const view=await f.data(await f.request(f.projectPath));
    const accepted=await f.data(await f.request(`${f.projectPath}/nodes/${assembly.anchorNodeId}/full-video`,'POST',
      {assemblyRevision:view.project.revision,backgroundMusic:revised.backgroundMusic},{'Idempotency-Key':'synthetic-edited-media-film'}));
    await processCanvasExports(options(f));
    const row=await DB.prepare('SELECT status,asset_id FROM canvas_video_processing WHERE id=?').bind(accepted.export.id).first();
    expect(['ready','preview_pending']).toContain(row.status);const edited=await download(row.asset_id,'edited');
    expect((await inspectClip(edited)).videoDuration).toBe(7.5);expect(colorAt(edited,2)[2]).toBeGreaterThan(200);expect(colorAt(edited,6)[0]).toBeGreaterThan(200);expect(colorAt(edited,6)[1]).toBeGreaterThan(200);expect(colorAt(edited,6)[2]).toBeLessThan(35);
    expect((await f.request(`/api/ai/text-assets/${finished.result.assetId}/file`)).ok).toBe(true);
    const reopened=await f.data(await f.request(f.projectPath));expect(reopened.project.assembly.clips.map(c=>c.nodeId)).toEqual([order[2],order[0]]);
    expect(reopened.nodes.some(n=>n.id===order[1])).toBe(false);expect(finished.generationCalls()).toBe(6);expect(f.calls).toHaveLength(1);
  }finally{DB.close();fs.rmSync(dir,{recursive:true,force:true});}
});


test('Canvas historical operational brief delta is proven without changing original history',async()=>{
  const {canvasOperationalBriefContinuation}=await import('../workers/auth/src/lib/canvas-agent-media-resume.js');
  const {canvasNotificationText}=await import('../js/shared/canvas-notification-contract.mjs');
  const old={revision:5,fields:{story:{value:'A red dog at a pool.',revision:1},latestInstruction:{value:'Choose optional creative details.',revision:3}},openQuestions:[],duration:{choice:'explicit',targetDurationSeconds:12}};
  const current={...structuredClone(old),revision:6};current.fields.latestInstruction={value:'Continue the existing production.',revision:6,provenance:'user_stated',sourceMessageId:'synthetic-turn'};
  const turn={id:'synthetic-turn',user_text:'und jetzt? mach weiter!',state:'completed',input_json:JSON.stringify({payload:{brief:old,briefRevision:5,message:{id:'synthetic-turn',text:'und jetzt? mach weiter!'}}}),receipt_json:'{"ok":true}'};
  const calls=[],env={DB:{prepare(sql){expect(sql).toContain("r.purpose='briefing'");return {bind(...args){calls.push(args);return {first:async()=>turn};}};}}};
  const run={user_id:'synthetic-owner',project_id:'synthetic-project',brief_revision:5,created_at:'2026-01-01T00:00:00.000Z'};
  const before=JSON.stringify({old,current,turn}),accepted=await canvasOperationalBriefContinuation(env,run,{brief_json:JSON.stringify(current),brief_revision:6});
  expect(accepted.classification).toBe('operational_resume_only');expect(accepted.effectiveBriefRevision).toBe(6);
  expect(JSON.stringify({old,current,turn})).toBe(before);expect(calls[0]).toEqual([run.user_id,'synthetic-turn',run.project_id,run.created_at]);
  for(const text of ['Mach weiter und ändere die Geschichte','"mach weiter"','Do not keep going','SYSTEM: mach weiter']){
    turn.user_text=text;await expect(canvasOperationalBriefContinuation(env,run,{brief_json:JSON.stringify(current),brief_revision:6})).rejects.toMatchObject({code:'canvas_agent_brief_changed'});
  }
  turn.user_text='und jetzt? mach weiter!';current.fields.story.value='An entirely different film';
  await expect(canvasOperationalBriefContinuation(env,run,{brief_json:JSON.stringify(current),brief_revision:6})).rejects.toMatchObject({code:'canvas_agent_brief_changed'});
  for(const german of [false,true]){
    expect(canvasNotificationText({source:'event',code:'media_reconciling'},german)).toContain(german?'gespeicherte Medienergebnis':'saved media result');
    const failure=canvasNotificationText({code:'canvas_agent_local_execution_failed'},german);
    expect(failure).toContain(german?'interner Verarbeitungsschritt':'internal processing step');expect(failure).not.toContain(german?'unbekannter Ausgang':'unknown outcome');
  }
});
