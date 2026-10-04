import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {concatenateClips,mediaCommand,inspectClip,applyOriginalAudio,mixBackgroundMusic} from './canvas-full-video.mjs';
import {pictureTiming,cutSafeSettings} from './canvas-audio-fit.mjs';
import {smoothVideoSeams} from './canvas-seams.mjs';
import {seamFixture} from './canvas-seams.test.mjs';
const command=(bin,args)=>{const r=spawnSync(bin,args,{maxBuffer:16_000_000});assert.equal(r.status,0,String(r.stderr));return r.stdout;};
const ff=args=>command('ffmpeg',['-y','-v','error','-nostdin',...args]);
const pcm=file=>ff(['-i',file,'-map','0:a:0','-ar','48000','-ac','1','-f','f32le','-']);
const rms=(bytes,start,end)=>{let sum=0,count=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){const value=bytes.readFloatLE(i*4);assert(Number.isFinite(value));sum+=value*value;count++;}return Math.sqrt(sum/count);};
const tone=(bytes,start,end,hz)=>{let re=0,im=0,count=0;for(let i=Math.round(start*48000);i<Math.round(end*48000);i++){const value=bytes.readFloatLE(i*4),phase=2*Math.PI*hz*i/48000;re+=value*Math.cos(phase);im+=value*Math.sin(phase);count++;}return 2*Math.hypot(re,im)/count;};
export async function fitFixture(dir) {
  // Audible tail, delayed short audio, short silent clip, early audio plus
  // non-zero first video PTS. No paid/generated provider content.
  await mkdir(dir,{recursive:true});const files=[];
  for(const [i,fps,duration,audioDuration,videoOffset,audioOffset] of [[0,24,1,1.2,0,0],[1,30,1,.5,0,.2],[2,30,.2,0,0,0],[3,24,1,1.5,.25,0]]) {
    const file=path.join(dir,`clip-${i}.mp4`);files.push(file);
    ff([...(videoOffset?['-itsoffset',String(videoOffset)]:[]),'-f','lavfi','-i',`testsrc2=size=320x180:rate=${fps}:duration=${duration}`,
      ...(audioDuration?[...(audioOffset?['-itsoffset',String(audioOffset)]:[]),'-f','lavfi','-i',`sine=frequency=${440+i*220}:sample_rate=48000:duration=${audioDuration}`]:[]),
      '-map','0:v:0',...(audioDuration?['-map','1:a:0']:[]),'-fps_mode','passthrough','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(audioDuration?['-c:a','aac']:[]),file]);
  }return files;
}
export async function testAudioFit() {
  const root=await mkdtemp(path.join(tmpdir(),'canvas-audio-fit-')),started=Date.now();
  try {
    const dir=path.join(root,'fit'),files=await fitFixture(dir),originals=await Promise.all(files.map(f=>readFile(f)));
    const offsets=await inspectClip(files[3]);assert.equal(Number(offsets.video.start_time),.25,'Fixture retains non-zero picture PTS');
    await assert.rejects(concatenateClips(files,dir,{videoClock:true}),/canvas_audio_tail_exceeds_video/,'Legacy v4 accepted jobs retain their pinned rejection policy');
    const base=await concatenateClips(files,dir,{videoClock:true,fitAudio:true});
    assert.equal(base.duration,3.2);assert.equal(base.timeline.length,4);assert.deepEqual(base.timeline.map(c=>c.duration),[1,1,.2,1]);
    const decoded=pcm(base.output);assert(Math.abs(decoded.length/4/48000-3.2)<.025);
    assert(tone(decoded,.1,.8,440)>.07,'First clip has its original in-window sound');
    assert(rms(decoded,1.01,1.15)<.002,'Delayed source does not move to the beginning');
    assert(tone(decoded,1.3,1.6,660)>.07,'Delayed source retains the actual in-window offset');
    assert(rms(decoded,1.8,2.19)<.002,'Short/missing audio is silent, no prior tail spill');
    assert(tone(decoded,2.3,3.05,1100)>.07,'Early audio is trimmed relative to first picture, not shifted');
    assert(base.timeline[0].originalAudioFit.trimEnd>.19);
    assert(base.timeline[3].originalAudioFit.trimStart>.24&&base.timeline[3].originalAudioFit.trimEnd>.24);
    const probe=JSON.parse(command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',base.output]));
    const pts=probe.frames.map(f=>Number(f.best_effort_timestamp_time));assert.equal(pts.length,96);
    pts.forEach((t,i)=>assert(Math.abs(t-i/30)<.00001,'No cumulative A/V timestamp drift'));
    const settings=[{enabled:true,gain:.5,fadeIn:.2,fadeOut:.1},{enabled:false,gain:.7,fadeIn:0,fadeOut:0},{enabled:true,gain:1,fadeIn:0,fadeOut:0},{enabled:true,gain:.25,fadeIn:0,fadeOut:0}];
    const edited=await applyOriginalAudio(base,settings,dir),sound=pcm(edited.output);
    assert(Math.abs(tone(sound,.3,.6,440)/tone(decoded,.3,.6,440)-.5)<.025,'Gain applied exactly once');
    assert(rms(sound,1.3,1.6)<.002,'Per-node mute survives fitting');
    assert(Math.abs(tone(sound,2.4,2.8,1100)/tone(decoded,2.4,2.8,1100)-.25)<.025);
    const fit=base.timeline[3].originalAudioFit;
    assert.equal(cutSafeSettings(settings[0],fit).fadeOut,.1,'Configured fade is not multiplied');
    assert.equal(cutSafeSettings(settings[3],fit).fadeOut,.005,'Only a new cut receives a brief ramp');
    assert(rms(sound,3.199,3.2)<rms(sound,3.18,3.19)*.6,'Cut ramp acts on actual decoded samples');
    for(const video of [{start_time:'N/A',duration:1},{start_time:0,duration:-1}])assert.throws(()=>pictureTiming({video},30),/canvas_media_timing_invalid/);
    // Real decode error still fails; no catch-all silence fallback.
    await assert.rejects(concatenateClips(files,dir,{videoClock:true,fitAudio:true,run:(bin,args,opts)=>args.includes('-copyts')?Promise.reject(Object.assign(new Error('decode fixture'),{code:'canvas_media_tool_failed'})):mediaCommand(bin,args,opts)}),/decode fixture/);
    // The selected comparison is independent of the unrelated last clip's tail.
    const previewDir=path.join(root,'preview');await mkdir(previewDir);const copies=[];
    for(let i=0;i<files.length;i++){const target=path.join(previewDir,`clip-${i}.mp4`);await copyFile(files[i],target);copies.push(target);}
    const preview=await concatenateClips(copies,previewDir,{videoClock:true,fitAudio:true,previewSeam:0});assert.equal(preview.duration,2);
    assert.deepEqual(preview.timeline,base.timeline.slice(0,2));
    // Smoothing changes only pictures; audio fit/control/music policy is shared.
    const seamDir=path.join(root,'smooth'),seams=await seamFixture(seamDir);
    const over=path.join(seamDir,'over.mp4');ff(['-i',seams[0],'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.7','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',over]);await copyFile(over,seams[0]);
    const clean=await concatenateClips(seams,seamDir,{videoClock:true,fitAudio:true,smooth:true});
    const smooth=await smoothVideoSeams(clean,seamDir,{run:mediaCommand,ffmpeg:'ffmpeg'});assert.equal(smooth.seams.improved,1);
    assert.deepEqual(pcm(smooth.output),pcm(clean.output),'Smoothing does not duplicate/change fitted audio');
    const controls=[{enabled:true,gain:.5,fadeIn:.2,fadeOut:.1},{enabled:true,gain:.4,fadeIn:.1,fadeOut:.2}];
    const music=path.join(seamDir,'music.wav');ff(['-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=0.8',music]);
    const final=await mixBackgroundMusic(await applyOriginalAudio(smooth,controls,seamDir),music,.2,seamDir,{fadeIn:.2,fadeOut:.3});
    const finalPcm=pcm(final.output);assert(tone(finalPcm,.4,.8,1000)>.015,'Music remains audible independently');
    const compDir=path.join(root,'comparison');await mkdir(compDir);const comp=[];
    for(let i=0;i<seams.length;i++){const file=path.join(compDir,`clip-${i}.mp4`);await copyFile(seams[i],file);comp.push(file);}
    const compare=await concatenateClips(comp,compDir,{videoClock:true,fitAudio:true,smooth:true,previewSeam:0});
    const improved=await smoothVideoSeams(compare,compDir,{run:mediaCommand,ffmpeg:'ffmpeg'});
    const compared=await mixBackgroundMusic(await applyOriginalAudio(improved,controls,compDir),music,.2,compDir,{fadeIn:.2,fadeOut:.3});
    assert.deepEqual(pcm(compared.output),finalPcm,'Preview/export use identical fit and once-applied envelopes');
    for(let i=0;i<files.length;i++)assert.deepEqual(await readFile(files[i]),originals[i],'Original source bytes unchanged');
    const result={test:'canvas-audio-fit-decoded',policy:'fit-picture-v1',duration:base.duration,frames:pts.length,offsetsPreserved:true,trimmed:base.timeline.map(c=>c.originalAudioFit),smoothing:true,previewPcmIdentical:true,elapsedMs:Date.now()-started};console.log(JSON.stringify(result));return result;
  }finally{await rm(root,{recursive:true,force:true});}
}
