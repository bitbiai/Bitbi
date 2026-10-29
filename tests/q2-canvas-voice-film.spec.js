const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');

test('Canvas Voice final spoken approval completes one editable film with real music and saved MP4',async({},info)=>{
  test.setTimeout(90000);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-spoken-film-')),DB=new SqliteD1Database();applyAuthMigrations(DB);
  const ffmpeg=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args]);
  try{
    const clips=[];for(const color of ['red','lime','blue']){
      const file=path.join(dir,color+'.mp4');ffmpeg(['-f','lavfi','-i',`color=c=${color}:size=160x90:rate=24:duration=4`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);
      clips.push(fs.readFileSync(file).toString('base64'));
    }
    const music=path.join(dir,'music.mp3');ffmpeg(['-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=12','-c:a','libmp3lame',music]);
    const {canvasMediaCompletionCase}=await import('./helpers/canvas-agent-media-completion-control.mjs');
    const {startCanvasFilmThroughVoice}=await import('./helpers/canvas-voice-production-start.mjs');
    const {processCanvasExports,inspectClip}=await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
    const {processCanvasInspections}=await import('../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
    const {default:worker}=await import('../workers/auth/src/index.js');
    const request=(f,url,init)=>init.body instanceof FormData?f.atClock(async()=>{
      const pending=[];const response=await worker.fetch(new Request(new URL(url,'https://bitbi.ai'),init),f.env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return response;
    }):f.request(url,init.method||'GET',init.body,init.headers);
    const options=f=>({baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
      requestJson:async(url,init={})=>{const response=await request(f,url,{...init,headers:{Authorization:'Bearer synthetic-audio-processor',...init.headers}}),body=await response.json();expect(response.ok,JSON.stringify(body)).toBe(true);return body;},
      fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',undefined,init.headers)});
    const finished=await canvasMediaCompletionCase({...createAuthTestEnv(),DB},'resume',{
      imageBase64:fs.readFileSync(path.join(__dirname,'fixtures/media/member-image.png')).toString('base64'),videoBase64:clips[0],videoSourcesBase64:clips,musicBase64:fs.readFileSync(music).toString('base64'),
    },{startProduction:startCanvasFilmThroughVoice,injectRecoveryFailure:false,processor:async f=>{await processCanvasInspections(options(f));await processCanvasExports(options(f));}});
    const f=finished.fixture,download=async(assetId,name)=>{
      const response=await f.request(`/api/ai/text-assets/${assetId}/file`);expect(response.ok).toBe(true);
      const file=path.join(dir,name+'.mp4');fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));return file;
    };
    const file=await download(finished.result.assetId,'spoken-final'),measured=await inspectClip(file);
    expect(measured.videoDuration).toBe(12);ffmpeg(['-xerror','-i',file,'-f','null','-']);
    for(const [channel,time] of [2,6,10].entries()){
      const rgb=[...ffmpeg(['-ss',String(time),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])];
      expect(rgb[channel]).toBeGreaterThan(200);expect(rgb.filter((_,index)=>index!==channel).every(value=>value<35)).toBe(true);
    }
    const pcm=ffmpeg(['-i',file,'-t','2','-ac','1','-ar','8000','-f','f32le','pipe:1']),samples=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4);
    const energy=frequency=>{let re=0,im=0;for(let i=0;i<samples.length;i++){re+=samples[i]*Math.cos(2*Math.PI*frequency*i/8000);im+=samples[i]*Math.sin(2*Math.PI*frequency*i/8000);}return Math.hypot(re,im)/samples.length;};
    expect(energy(660)).toBeGreaterThan(.015);expect(energy(660)).toBeGreaterThan(energy(440)*20);
    expect(finished.generationCalls()).toBe(5);expect(f.calls).toHaveLength(1);
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=? AND purpose='production'").bind(f.project).first()).n).toBe(1);
    const view=await f.data(await f.request(f.projectPath));expect(view.project.assembly.clips).toHaveLength(3);
    expect(view.nodes.filter(node=>node.type.endsWith('_generation'))).toHaveLength(5);expect(view.nodes.filter(node=>node.type==='note')).toHaveLength(1);
    const anchor=view.project.assembly.anchorNodeId;
    await f.data(await f.request(`${f.projectPath}/nodes/${anchor}`,'PATCH',{title:'My manually editable film'}));
    const edited=await f.data(await f.request(f.projectPath));expect(edited.nodes.find(node=>node.id===anchor).title).toBe('My manually editable film');
    const accepted=await f.data(await f.request(`${f.projectPath}/nodes/${anchor}/full-video`,'POST',{
      assemblyRevision:edited.project.revision,backgroundMusic:edited.project.assembly.backgroundMusic},{'Idempotency-Key':'voice-film-manual-reexport'}));
    await processCanvasExports(options(f));
    const exported=await DB.prepare('SELECT asset_id,status FROM canvas_video_processing WHERE id=?').bind(accepted.export.id).first();
    expect(['ready','preview_pending']).toContain(exported.status);expect((await inspectClip(await download(exported.asset_id,'manual-reexport'))).videoDuration).toBe(12);
    expect((await f.request(`/api/ai/text-assets/${finished.result.assetId}/file`)).ok).toBe(true);expect(finished.generationCalls()).toBe(5);
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    await info.attach('spoken-film-boundaries',{body:JSON.stringify({transcription:'synthetic final source',playback:'synthetic trusted receipt',database:'local SQLite adapter; native Owner/D1 covered separately',providers:'synthetic',ffmpeg:'real',durationSeconds:measured.videoDuration,mediaOperations:5,planningOperations:1,persistedExport:finished.result.assetId,manualReexport:exported.asset_id}),contentType:'application/json'});
  }finally{DB.close();fs.rmSync(dir,{recursive:true,force:true});}
});
