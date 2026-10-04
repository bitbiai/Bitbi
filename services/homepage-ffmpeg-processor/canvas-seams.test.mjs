import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mediaCommand,concatenateClips,applyOriginalAudio,mixBackgroundMusic,inspectClip} from './canvas-full-video.mjs';
import {smoothVideoSeams} from './canvas-seams.mjs';

const command=args=>{const r=spawnSync('ffmpeg',['-y','-v','error','-nostdin',...args],{maxBuffer:50_000_000});assert.equal(r.status,0,String(r.stderr));return r.stdout;};
// Independent visual oracle: a red subject moves two pixels per frame through a
// detailed translating background. Centroids and timestamps measure the result;
// neither the production motion estimator nor its thresholds supply expectations.
export async function seamFixture(dir,kind='hold',{width=320,height=180,fps=24,audio=true,clipFrames=36}={}) {
  await mkdir(dir,{recursive:true});const frames=[];
  for(let n=0;n<clipFrames*2;n++) {
    const position=kind==='hold'&&n>=clipFrames-2&&n<=clipFrames+1?clipFrames-2:kind==='pause'&&n>=clipFrames-2?(n<=clipFrames+1?clipFrames-2:n-3):kind==='jump'&&n>=clipFrames?n+3:kind==='still'?34:n;
    const frame=Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const wx=x*320/width-position*2,wy=y*180/height,at=(y*width+x)*3;
      const shade=Math.round(70+40*Math.sin(wx*.11)+22*Math.cos(wy*.17+wx*.05));
      frame[at]=frame[at+1]=frame[at+2]=shade;
      if(wx>24&&wx<64&&wy>60&&wy<110){frame[at]=220;frame[at+1]=20+shade/4;frame[at+2]=20;}
      if(kind==='cut'&&n>=clipFrames){frame[at]=10;frame[at+1]=40;frame[at+2]=160;}
    }
    frames.push(frame);
  }
  const files=[];
  for(let i=0;i<2;i++) {
    const raw=path.join(dir,`source-${i}.rgb`),file=path.join(dir,`clip-${i}.mp4`);files.push(file);
    await writeFile(raw,Buffer.concat(frames.slice(i*clipFrames,(i+1)*clipFrames)));
    command(['-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-framerate','24','-i',raw,
      ...(audio?['-f','lavfi','-i',`sine=frequency=${i?660:440}:sample_rate=48000:duration=${clipFrames/24}`]:[]),
      '-vf',`fps=${fps}`,'-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-threads','1',...(audio?['-c:a','aac']:[]),file]);
    await rm(raw);
  }
  return files;
}
function positions(file,start=1.2,length=.7) {
  const bytes=command(['-ss',String(start),'-i',file,'-t',String(length),'-vf','scale=320:180','-pix_fmt','rgb24','-f','rawvideo','-']);
  const positions=[];
  for(let off=0;off+320*180*3<=bytes.length;off+=320*180*3) {
    let count=0,sum=0;for(let y=0;y<180;y++)for(let x=0;x<320;x++) {
      const n=off+(y*320+x)*3;if(bytes[n]>150&&bytes[n]>2*bytes[n+1]&&bytes[n]>2*bytes[n+2]){sum+=x;count++;}
    } positions.push(sum/count);
  } return positions;
}
const maximumStep=xs=>Math.max(...xs.slice(1).map((x,i)=>Math.abs(x-xs[i])));
const holds=xs=>xs.slice(1).filter((x,i)=>Math.abs(x-xs[i])<.2).length;
const pcm=file=>command(['-i',file,'-map','0:a:0','-ar','48000','-ac','1','-f','f32le','-']);
export async function testSmoothJoins() {
  const root=process.env.CANVAS_SEAM_EVIDENCE||await mkdtemp(path.join(tmpdir(),'canvas-seams-'));
  await mkdir(root,{recursive:true});const started=Date.now(),measurements=[];
  try {
    for(const kind of ['hold','jump','good','still','pause','cut']) {
      const dir=path.join(root,kind),files=await seamFixture(dir,kind,{audio:kind!=='cut'});
      const originals=await Promise.all(files.map(file=>readFile(file))),base=await concatenateClips(files,dir,{videoClock:true,smooth:true});
      const before=positions(base.output),audio=kind!=='cut'?pcm(base.output):null;
      const smoothed=await smoothVideoSeams(base,dir,{run:mediaCommand,ffmpeg:'ffmpeg'}),after=positions(smoothed.output);
      const improve=['hold','jump'].includes(kind);
      assert.equal(smoothed.seams.improved,improve?1:0,JSON.stringify(smoothed.seams));
      if(improve) {
        assert(maximumStep(after)<maximumStep(before)*.7,`${kind}: actual motion jump shrinks`);
        if(kind==='hold'){assert(holds(before)>=2);assert.equal(holds(after),0,'Repeated samples are reconstructed, not moved elsewhere');}
        assert.deepEqual(pcm(smoothed.output),audio,'Duration-preserving replacement stream-copies original audio samples');
        const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',smoothed.output],{encoding:'utf8'});
        const times=JSON.parse(probe.stdout).frames.map(f=>Number(f.best_effort_timestamp_time));assert.equal(times.length,72);
        for(let i=1;i<times.length;i++)assert(Math.abs(times[i]-times[i-1]-1/24)<.00001,'No timestamp gap or relocated hold');
        const reference=positions(base.output,0,.8),untouched=positions(smoothed.output,0,.8);
        assert(Math.max(...reference.map((x,i)=>Math.abs(x-untouched[i])))<.3,'Content away from the seam remains in place');
      }else assert.equal(smoothed.output,base.output,'Unsuitable/good/still joins retain byte-identical baseline');
      for(let i=0;i<files.length;i++)assert.deepEqual(await readFile(files[i]),originals[i],'Source never changes');
      measurements.push({kind,beforeMaxStep:maximumStep(before),afterMaxStep:maximumStep(after),holdsBefore:holds(before),holdsAfter:holds(after),...smoothed.seams});
      if(kind==='hold') {
        const brokenDir=path.join(root,'broken-compositor');await mkdir(brokenDir);
        await assert.rejects(smoothVideoSeams(base,brokenDir,{ffmpeg:'ffmpeg',run:(tool,args,options)=>mediaCommand(tool,args.map(arg=>arg.includes('overlay=')?arg.replace(/between\(t,[^)]+\)/g,'between(t,999999,1000000)'):arg),options)}),
          /canvas_seam_output_mismatch/,'A missing final replacement cannot report successful smoothing');
        const settings=[{enabled:true,gain:.5,fadeIn:.25,fadeOut:.2},{enabled:false,gain:.8,fadeIn:.3,fadeOut:.5}];
        const final=await applyOriginalAudio(smoothed,settings,dir),music=path.join(dir,'music.wav');
        command(['-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=0.8','-ac','2',music]);
        const mix=await mixBackgroundMusic(final,music,.2,dir,{fadeIn:.3,fadeOut:.4});await copyFile(mix.output,path.join(dir,'export-with-sound.mp4'));
        const previewDir=path.join(root,'preview');await mkdir(previewDir);
        const previewFiles=await Promise.all(files.map(async(file,i)=>{const target=path.join(previewDir,`clip-${i}.mp4`);await copyFile(file,target);return target;}));
        const preview=await concatenateClips(previewFiles,previewDir,{videoClock:true,smooth:true,previewSeam:0});
        const previewSmooth=await smoothVideoSeams(preview,previewDir,{run:mediaCommand,ffmpeg:'ffmpeg',originalSeamIndex:0});
        assert.equal(previewSmooth.seams.improved,1);
        const previewSound=await applyOriginalAudio(previewSmooth,settings,previewDir);
        const previewMix=await mixBackgroundMusic(previewSound,music,.2,previewDir,{fadeIn:.3,fadeOut:.4});
        assert.deepEqual(positions(previewMix.output),positions(mix.output),'Same policy, selected seam and timing in preview/export');
        assert.deepEqual(pcm(previewMix.output),pcm(mix.output),'Same once-applied original/music envelopes');
      }
      console.log(JSON.stringify({case:kind,status:'PASS',...measurements.at(-1)}));
    }
    await testSmoothTiming(root);
    await testSmoothPreviewWindow(root);
    const result={test:'canvas-smooth-joins-decoded',measurements,elapsedMs:Date.now()-started,peakNodeRss:process.resourceUsage().maxRSS};
    await writeFile(path.join(root,'acceptance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{if(!process.env.CANVAS_SEAM_EVIDENCE)await rm(root,{recursive:true,force:true});}
}

export async function testSmoothPreviewWindow(root) {
  const dir=path.join(root,'long-preview'),files=await seamFixture(dir,'hold',{clipFrames:72});
  const settings=[{enabled:true,gain:.5,fadeIn:.25,fadeOut:.4},{enabled:true,gain:.3,fadeIn:.3,fadeOut:.5}];
  const options={run:mediaCommand,ffmpeg:'ffmpeg'},music=path.join(dir,'music.wav');
  command(['-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=0.8','-ac','2',music]);
  const base=await concatenateClips(files,dir,{videoClock:true,smooth:true});
  const final=await mixBackgroundMusic(await applyOriginalAudio(await smoothVideoSeams(base,dir,options),settings,dir),music,.2,dir,{fadeIn:2.5,fadeOut:2});
  const previewDir=path.join(root,'short-preview');await mkdir(previewDir);
  const inputs=await Promise.all(files.map(async(file,i)=>{const target=path.join(previewDir,`clip-${i}.mp4`);await copyFile(file,target);return target;}));
  const excerpt=await concatenateClips(inputs,previewDir,{videoClock:true,smooth:true,previewSeam:0});
  assert.equal(excerpt.duration,3);assert.equal(excerpt.previewOffset,1.5);assert.equal(base.duration,6,'Preview is not a duplicate full-length render');
  const smooth=await smoothVideoSeams(excerpt,previewDir,{...options,originalSeamIndex:0});assert.equal(smooth.seams.improved,1);
  const preview=await mixBackgroundMusic(await applyOriginalAudio(smooth,settings,previewDir),music,.2,previewDir,{fadeIn:2.5,fadeOut:2});
  const expected=positions(final.output,2.7,.6),actual=positions(preview.output,1.2,.6);
  assert.equal(actual.length,expected.length);assert(Math.max(...actual.map((x,i)=>Math.abs(x-expected[i])))<.4,'Preview places the same motion on the same absolute timeline');
  const amplitude=(file,time,hz)=>{
    const bytes=command(['-ss',String(time),'-i',file,'-t','0.2','-vn','-ac','1','-ar','48000','-f','f32le','-']);let r=0,im=0;
    for(let i=0;i<bytes.length/4;i++){const sample=bytes.readFloatLE(i*4),phase=2*Math.PI*hz*i/48000;r+=sample*Math.cos(phase);im+=sample*Math.sin(phase);}
    return 2*Math.hypot(r,im)/(bytes.length/4);
  };
  for(const [time,hz] of [[.7,440],[1.7,660],[.7,1000],[2,1000]]) {
    const before=amplitude(final.output,time+1.5,hz),after=amplitude(preview.output,time,hz);
    assert(before>.005);assert(Math.abs(after/before-1)<.06,'Original envelope, music loop and global fades agree without applying twice');
  }
  console.log(JSON.stringify({case:'bounded-preview-timeline-audio',status:'PASS',duration:3,fullDuration:6,offset:1.5}));
}

export async function testSmoothTiming(root) {
    const timing=path.join(root,'timing');await mkdir(timing);const files=[];
    for(let i=0;i<2;i++){const file=path.join(timing,`clip-${i}.mp4`);files.push(file);command(['-f','lavfi','-i',`testsrc2=s=${i?322:320}x180:r=${i?30:24}:d=1`,
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-af','afade=t=out:st=0.95:d=0.05,apad=pad_dur=0.35','-c:v','libx264','-threads','1','-c:a','aac',file]);}
    const repaired=await concatenateClips(files,timing,{videoClock:true});assert(Math.abs(repaired.duration-2)<.001,'Silent audio overhang cannot create held video');
    assert.equal((await inspectClip(repaired.output)).video.nb_frames,'60');
    command(['-f','lavfi','-i','testsrc2=s=320x180:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.35','-c:v','libx264','-threads','1','-c:a','aac',files[0]]);
    await assert.rejects(concatenateClips(files,timing,{videoClock:true}),/canvas_audio_tail_exceeds_video/,'Meaningful longer audio is never discarded');
    const short=path.join(root,'short');await mkdir(short);const small=[];
    for(let i=0;i<2;i++){const file=path.join(short,`clip-${i}.mp4`);small.push(file);command(['-f','lavfi','-i','testsrc2=s=160x90:r=24:d=0.2','-an','-c:v','libx264','-threads','1',file]);}
    const brief=await concatenateClips(small,short,{videoClock:true,smooth:true});const skipped=await smoothVideoSeams(brief,short,{run:mediaCommand,ffmpeg:'ffmpeg'});assert.equal(skipped.seams.seams[0].reason,'short_clip');
}
