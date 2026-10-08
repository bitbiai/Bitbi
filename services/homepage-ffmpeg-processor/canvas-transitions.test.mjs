import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,copyFile} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {concatenateClips,inspectClip,mediaCommand,applyOriginalAudio,mixBackgroundMusic} from './canvas-full-video.mjs';
import {applyVideoTransitions} from './canvas-transitions.mjs';
import {TRANSITIONS,transitionTimeline} from './canvas-transition-contract.mjs';
import {smoothVideoSeams} from './canvas-seams.mjs';
const cmd=(bin,args)=>{const r=spawnSync(bin,args,{maxBuffer:32e6});assert.equal(r.status,0,String(r.stderr));return r.stdout;};
const ff=args=>cmd('ffmpeg',['-y','-v','error','-nostdin',...args]);
const limits={outputBytes:80e6,durationSeconds:600},options={run:mediaCommand,inspect:inspectClip,limits};
const tone=(pcm,start,end,hz)=>{let re=0,im=0,n=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){const v=pcm.readFloatLE(i*4);assert(Number.isFinite(v));re+=v*Math.cos(2*Math.PI*hz*i/48000);im+=v*Math.sin(2*Math.PI*hz*i/48000);n++;}return 2*Math.hypot(re,im)/n;};
const audio=file=>ff(['-i',file,'-vn','-ar','48000','-ac','1','-f','f32le','-']);
const frame=(file,t)=>ff(['-ss',String(t),'-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-']);
const diff=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
export async function transitionFixture(dir,{width=320,height=180}={}) {
  await mkdir(dir,{recursive:true});const files=[];
  for(let i=0;i<2;i++){
    const file=path.join(dir,`clip-${i}.mp4`);files.push(file);
    ff(['-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=24:duration=1.5`,'-f','lavfi','-i',`sine=frequency=${440+i*440}:sample_rate=48000:duration=${i===0?1.8:1.5}`,
      '-vf',i?'hflip,hue=h=90':'null','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',file]);
  }return files;
}
export async function testCanvasTransitions() {
  const root=process.env.CANVAS_TRANSITION_EVIDENCE_DIR||await mkdtemp(path.join(tmpdir(),'canvas-transitions-'));
  await mkdir(root,{recursive:true});const started=Date.now(),results=[];
  try{
    await (await import('./canvas-full-video.test.mjs')).testMediaCommandDiagnostics();
    const dir=path.join(root,'sources'),files=await transitionFixture(dir),originals=await Promise.all(files.map(f=>readFile(f)));
    const normal=await concatenateClips(files,dir,{videoClock:true,fitAudio:true});assert.equal(normal.duration,3);
    const controls=[{enabled:true,gain:.5,fadeIn:.1,fadeOut:.1},{enabled:true,gain:.25,fadeIn:0,fadeOut:.1}];
    const edited=await applyOriginalAudio(normal,controls,dir);
    const normals=audio(edited.output);assert(tone(normals,.4,.8,440)>.055&&tone(normals,.4,.8,440)<.07,'Once-applied .5 gain');
    let fadeFrame;
    for(const preset of TRANSITIONS.filter(p=>p.id!=='none')){
      const out=path.join(root,preset.id);await mkdir(out,{recursive:true});
      const settings={preset:preset.id,duration:.5};const begin=Date.now();
      const result=await applyVideoTransitions(edited,[settings],out,options);
      assert.equal(result.duration,2.5);assert.deepEqual(result.timeline.map(c=>c.start),[0,1]);
      assert(result.timeline[0].originalAudioFit.trimEnd>.29,'Recipe 6 retains audible-tail fit');
      const info=await inspectClip(result.output);assert.equal(Number(info.video.nb_frames),60);assert.equal(info.video.width,320);assert.equal(info.video.height,180);
      const probe=JSON.parse(cmd('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',result.output]));
      probe.frames.forEach((f,i)=>assert(Math.abs(Number(f.best_effort_timestamp_time)-i/24)<.00001,'Continuous picture clock'));
      const pcm=audio(result.output);assert(Math.abs(tone(pcm,.4,.8,440)/tone(normals,.4,.8,440)-1)<.04,'Audio gain not applied twice');
      assert(tone(pcm,1.15,1.35,440)>.02&&tone(pcm,1.15,1.35,880)>.01,'Complementary source audio overlap');
      assert(diff(frame(result.output,.5),frame(edited.output,.5))<3,'Effect does not modify early picture content');
      const pixels=frame(result.output,1.25);if(preset.id==='fade')fadeFrame=pixels;
      else assert(diff(pixels,fadeFrame)>.1,`${preset.id} actually differs from ordinary fade`);
      if(preset.id==='bloom')assert(pixels.reduce((s,v)=>s+v,0)>fadeFrame.reduce((s,v)=>s+v,0),'Bloom adds light, never integer-wrap inversion');
      ff(['-ss','1.25','-i',result.output,'-frames:v','1',path.join(out,'boundary.png')]);
      results.push({preset:preset.id,duration:result.duration,elapsedMs:Date.now()-begin,frames:60,decoded:true});
    }
    // Same pair preview policy, picture clock and envelopes as the full export.
    const previewDir=path.join(root,'preview');await mkdir(previewDir);const pair=[];
    for(let i=0;i<2;i++){const f=path.join(previewDir,`clip-${i}.mp4`);await copyFile(files[i],f);pair.push(f);}
    const transitions=[{preset:'fade',duration:.5}];
    const p=await concatenateClips(pair,previewDir,{videoClock:true,fitAudio:true,previewSeam:0,transitions});
    const preview=await applyVideoTransitions(await applyOriginalAudio(p,controls,previewDir),transitions,previewDir,options);
    assert.deepEqual(audio(preview.output),audio(path.join(root,'fade/full-video-transitions.mp4')),'Preview/export identical source audio');
    assert(diff(frame(preview.output,1.25),fadeFrame)===0,'Preview/export identical decoded boundary');
    assert.strictEqual(await applyVideoTransitions(normal,[{preset:'none'}],dir,options),normal,'None leaves existing pipeline unchanged');
    assert.throws(()=>transitionTimeline([1,.3,1],[{preset:'fade',duration:.2},{preset:'fade',duration:.2}],24),/canvas_transition_too_long/);
    // Representative three clips: mixed cadence, silent middle, mute/fades,
    // one explicit transition, smoothing only at the independent hard cut.
    const three=path.join(root,'three');await mkdir(three);const set=[];
    for(let i=0;i<3;i++){const f=path.join(three,`clip-${i}.mp4`);set.push(f);if(i===1)ff(['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=0.8','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',f]);else await copyFile(files[i===0?0:1],f);}
    const t=[{preset:'zoom-blur',duration:.2},{preset:'none'}];
    const base=await concatenateClips(set,three,{videoClock:true,fitAudio:true,transitions:t,smooth:true});
    const fitted=await applyOriginalAudio(base,[controls[0],controls[1],{enabled:false,gain:1,fadeIn:0,fadeOut:0}],three);
    const smoothed=await smoothVideoSeams(fitted,three,{run:mediaCommand,ffmpeg:'ffmpeg',skipSeams:new Set([0])});
    assert.equal(smoothed.seams.seams[0].reason,'explicit_transition');assert.equal(smoothed.seams.seams.length,2);
    const transitioned=await applyVideoTransitions(smoothed,t,three,options);assert.equal(transitioned.duration,3.6);
    const music=path.join(three,'music.wav');ff(['-f','lavfi','-i','sine=frequency=1200:sample_rate=48000:duration=0.7',music]);
    const final=await mixBackgroundMusic(transitioned,music,.2,three,{fadeIn:.2,fadeOut:.3});
    const pcm=audio(final.output);assert(tone(pcm,2.7,3.1,880)<.001,'Muted source remains muted');assert(tone(pcm,2.7,3.1,1200)>.015,'Music loops on final shorter clock');
    assert(tone(pcm,3.5,3.58,1200)<tone(pcm,2.7,3.1,1200)*.5,'Music fades at final output end');
    // Composition countercontrols: the real pinned image used to reject a
    // hard cut followed by xfade, and zoompan followed by a fresh xfade input.
    const cases=[['flash','none'],['none','flash'],['none','flash','none','fade'],['zoom-blur','flash'],[...Array(6).fill('none'),'flash','none']];
    for(const [index,presets] of cases.entries()){
      const folder=path.join(root,'mixed-'+index);await mkdir(folder);const inputs=[];
      for(let i=0;i<=presets.length;i++){const file=path.join(folder,`clip-${i}.mp4`);await copyFile(files[i%2],file);inputs.push(file);}
      const boundaries=presets.map(preset=>preset==='none'?{preset}:{preset,duration:.5,...(preset==='flash'?{strength:.7}:{})});
      const started=Date.now(),base=await concatenateClips(inputs,folder,{videoClock:true,fitAudio:true,transitions:boundaries});
      const envelopes=inputs.map((_,i)=>({enabled:i!==3,gain:.5,fadeIn:.1,fadeOut:.1}));
      const fitted=await applyOriginalAudio(base,envelopes,folder);
      const result=await applyVideoTransitions(fitted,boundaries,folder,options),info=await inspectClip(result.output);
      const expected=inputs.length*1.5-presets.filter(p=>p!=='none').length*.5;
      assert.equal(result.duration,expected);assert.equal(Number(info.video.nb_frames),Math.round(expected*24));
      const times=JSON.parse(cmd('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',result.output])).frames;
      times.forEach((f,i)=>assert(Math.abs(Number(f.best_effort_timestamp_time)-i/24)<.00001,'Mixed chain has one continuous frame clock'));
      for(let i=0;i<inputs.length;i++)assert(diff(frame(result.output,result.timeline[i].start+.65),frame(inputs[i],.65))<5,'Clip order/content unchanged outside transition');
      const flash=presets.indexOf('flash'),seam=result.timeline[flash+1].start+.25,pixels=frame(result.output,seam);
      assert(pixels.reduce((a,b)=>a+b,0)/pixels.length>170,'Requested Flash exists at its exact boundary');
      const signal=audio(result.output);assert(tone(signal,.4,.8,440)>.055&&tone(signal,.4,.8,440)<.07,'Original .5 gain applied once');
      if(inputs.length===9){
        assert(tone(signal,result.timeline[3].start+.6,result.timeline[3].start+.9,880)<.001,'Muted source stays muted in cumulative export');
        const mixed=await mixBackgroundMusic(result,music,.2,folder,{fadeIn:.2,fadeOut:.3});const withMusic=audio(mixed.output);
        assert(tone(withMusic,11,11.4,1200)>.015&&tone(signal,11,11.4,1200)<.001,'Fitted music appears only when enabled');
        assert(tone(withMusic,expected-.1,expected-.02,1200)<tone(withMusic,11,11.4,1200)*.5,'Music fades on shortened full timeline');
        assert(diff(frame(mixed.output,seam),pixels)===0,'Music preserves exact transition video');
      }
      ff(['-ss',String(seam),'-i',result.output,'-frames:v','1',path.join(folder,'flash-boundary.png')]);
      results.push({sequence:presets,clips:inputs.length,elapsedMs:Date.now()-started,duration:expected,frames:times.length,decoded:true});
    }
    // Native special effect at a representative delivery raster, bounded image.
    const hd=path.join(root,'720');const hdFiles=await transitionFixture(hd,{width:1280,height:720});
    const hdBase=await concatenateClips(hdFiles,hd,{videoClock:true,fitAudio:true});const begin=Date.now();
    const hdOut=await applyVideoTransitions(hdBase,[{preset:'radial-blur',duration:.5}],hd,options);
    assert.equal((await inspectClip(hdOut.output)).video.width,1280);results.push({preset:'radial-blur-720',elapsedMs:Date.now()-begin,duration:hdOut.duration});
    for(let i=0;i<2;i++)assert.deepEqual(await readFile(files[i]),originals[i]);
    let memoryPeak=null;try{memoryPeak=Number(await readFile('/sys/fs/cgroup/memory.peak','utf8'));}catch{}
    const report={test:'canvas-transitions-decoded',runtime:process.platform,results,elapsedMs:Date.now()-started,memoryPeak,audio:'decoded signal checks; no human listening claim',previewIdentical:true};
    await writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
  }finally{if(!process.env.CANVAS_TRANSITION_EVIDENCE_DIR)await rm(root,{recursive:true,force:true});}
}
