import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {concatenateClips,mediaCommand,inspectClip,processingTimeout,processCanvasExports,mixBackgroundMusic,loopMusicPcm} from './canvas-full-video.mjs';

export async function testCanvasConcatenation() {
  assert.equal(processingTimeout(720000,0),120000);
  assert.equal(processingTimeout(720000,719000),1000);
  assert.throws(()=>processingTimeout(720000,720000),/canvas_processing_deadline/);
  const dir=await mkdtemp(path.join(tmpdir(),'canvas-concat-test-'));
  try {
    const files=[],colors=['red','green','blue','yellow','magenta'];
    for(let i=0;i<5;i++) {
      const file=path.join(dir,`clip-${i}.mp4`);files.push(file);
      await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${colors[i]}:s=${i===3?'480x270':'320x180'}:r=24:d=0.75`,
        ...(i===2?[]:['-f','lavfi','-i',`sine=frequency=${400+i*100}:sample_rate=48000:duration=0.75`]),'-c:v','libx264','-pix_fmt','yuv420p','-threads','1',...(i===2?[]:['-c:a','aac']),file]);
    }
    const pair=await concatenateClips(files.slice(0,2),dir);
    assert.equal(pair.mode,'copy');assert(pair.duration>=1.5 && pair.duration<1.7);
    const prefix='/api/internal/homepage/hero-videos/canvas-exports/jobs',id='a'.repeat(32),claim='b'.repeat(32);
    const bytes=await Promise.all(files.slice(0,2).map(file=>readFile(file))),calls=[];
    let musicRecipe=false,expectedOutput=pair.output;
    const transport={baseUrl:'https://processor.invalid',limit:3,authHeaders:extra=>({Authorization:'Bearer synthetic',...extra}),
      requestJson:async(url,init={})=>{
        calls.push([url,init.method||'GET']);assert(init.signal);
        if(url===prefix+'/claim' && !init.method)return {data:{protocol:1}};
        if(url===prefix+'/claim'){assert.equal(JSON.parse(init.body).limit,1);assert.equal(JSON.parse(init.body).recipeProtocol,2);return {data:{jobs:[{id,claim,limits:{sourceBytes:400000000,outputBytes:80000000,durationSeconds:600},backgroundMusic:musicRecipe?{enabled:true,gain:0.5}:undefined,sources:bytes.map((b,i)=>({url:`${prefix}/${id}/source/${i}`,size:b.length,kind:i===2?'music':'video'}))}]}};}
        assert.equal(url,`${prefix}/${id}/complete`);assert.equal(init.headers['X-BITBI-Canvas-Claim'],claim);
        assert.equal(init.body.get('video').type,'video/mp4');assert.deepEqual(Buffer.from(await init.body.get('video').arrayBuffer()),await readFile(expectedOutput));
        assert(Number(init.body.get('duration'))>=1.5);return {data:{status:'preview_pending'}};
      },fetchImpl:async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer synthetic');assert.equal(init.headers['X-BITBI-Canvas-Claim'],claim);assert.equal(init.redirect,'error');return new Response(bytes[Number(url.pathname.split('/').at(-1))]);}};
    await processCanvasExports({...transport,dryRun:true});assert.deepEqual(calls,[[prefix+'/claim','GET']]);calls.length=0;
    await processCanvasExports(transport);assert.deepEqual(calls,[[prefix+'/claim','GET'],[prefix+'/claim','POST'],[`${prefix}/${id}/complete`,'POST']]);
    const callerMusic=path.join(dir,'caller-music.wav');
    await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=1200:sample_rate=48000:duration=0.4','-ac','2',callerMusic]);
    expectedOutput=(await mixBackgroundMusic(pair,callerMusic,0.5,dir)).output;
    bytes.push(await readFile(callerMusic));musicRecipe=true;calls.length=0;
    await processCanvasExports(transport);
    assert.deepEqual(calls,[[prefix+'/claim','GET'],[prefix+'/claim','POST'],[`${prefix}/${id}/complete`,'POST']], 'Actual protected-source caller uploads the mixed result once');
    const full=await concatenateClips(files,dir);assert.equal(full.mode,'normalized');
    assert(full.duration>=3.75 && full.duration<4.0);assert.equal(full.width,480);assert.equal(full.height,270);
    assert((await inspectClip(full.output)).audio,'Audio retained across silent input');
    // Decode representative output pixels: actual order, not merely command text.
    const pixel=t=>{
      const r=spawnSync('ffmpeg',['-v','error','-ss',String(t),'-i',full.output,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:100000});assert.equal(r.status,0);return [...r.stdout];
    };
    const samples=[0.3,1.05,1.8,2.55,3.3].map(pixel);
    assert(samples[0][0]>samples[0][1]+100);assert(samples[1][1]>samples[1][0]+50);assert(samples[2][2]>samples[2][0]+100);
    assert(samples[3][0]>100 && samples[3][1]>100 && samples[3][2]<50);assert(samples[4][0]>100 && samples[4][2]>100);
    const audio=t=>{const r=spawnSync('ffmpeg',['-v','error','-ss',String(t),'-i',full.output,'-t','0.2','-vn','-f','s16le','-ac','1','-'],{maxBuffer:100000});assert.equal(r.status,0);let total=0;for(let i=0;i+1<r.stdout.length;i+=2)total+=Math.abs(r.stdout.readInt16LE(i));return total/(r.stdout.length/2);};
    assert(audio(0.2)>100,'First audio retained');assert(audio(1.8)<20,'Silent segment retained');assert(audio(3.3)>100,'Final audio retained');
    await testBackgroundMusic(full,dir);
    await assert.rejects(concatenateClips(files,dir,{limits:{durationSeconds:1,outputBytes:80000000}}),/canvas_duration_limit/);
    await assert.rejects(concatenateClips(files.slice(0,1),dir),/canvas_sources_invalid/);
    assert((await readFile(full.output)).byteLength>1000);
    console.log(JSON.stringify({test:'canvas-full-video-native-ffmpeg',two:pair.mode,five:full.mode,duration:full.duration,pixelOrder:'PASS',audioAndSilence:'PASS'}));
  } finally {await rm(dir,{recursive:true,force:true});}
}

async function testBackgroundMusic(base,dir) {
  const music=path.join(dir,'synthetic-music.wav');
  await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=1200:sample_rate=48000:duration=0.4','-ac','2',music]);
  const decode=(file,channels=1)=>{
    const r=spawnSync('ffmpeg',['-v','error','-i',file,'-vn','-ac',String(channels),'-ar','48000','-f','f32le','-'],{maxBuffer:5000000});assert.equal(r.status,0);
    return Array.from({length:r.stdout.length/4},(_,i)=>r.stdout.readFloatLE(i*4));
  };
  const magnitude=(samples,hz,t)=>{
    const start=Math.round(t*48000),length=4800;let real=0,imaginary=0;
    for(let i=0;i<length;i++){const angle=2*Math.PI*hz*i/48000;real+=samples[start+i]*Math.cos(angle);imaginary+=samples[start+i]*Math.sin(angle);}
    return 2*Math.hypot(real,imaginary)/length;
  };
  const baseline=decode(base.output),levels=[];
  for(const gain of [0,0.5,1]) {
    const result=await mixBackgroundMusic(base,music,gain,dir),samples=decode(result.output);
    if(gain===0)assert.deepEqual(await readFile(result.output),await readFile(base.output),'Zero gain preserves original bytes');
    const original=magnitude(samples,400,0.2),added=magnitude(samples,1200,0.2);
    assert(Math.abs(original/magnitude(baseline,400,0.2)-1)<0.06,'Original audio stays unity; no amix normalization');
    levels.push(added);
    if(gain) {
      assert(added>0.02,'Music begins in first clip');
      assert(magnitude(samples,1200,1.8)>added*0.85,'Music covers silent video segments after repeated loops');
      assert(magnitude(samples,1200,3.5)>added*0.85,'Short music repeats through final clip');
      assert.equal((await inspectClip(result.output)).video.duration,(await inspectClip(base.output)).video.duration,'Video timing unchanged');
      const first=await readFile(result.output);
      await mixBackgroundMusic(base,music,gain,dir);
      assert.deepEqual(await readFile(result.output),first,'Rerenders start from unmixed base, not cumulative output');
    }
  }
  assert(levels[0]<0.001);assert(Math.abs(levels[1]/levels[2]-0.5)<0.04,'Intermediate gain measured in decoded output');
  const loud=path.join(dir,'loud.wav');
  await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','aevalsrc=0.99*sin(2*PI*400*t)|0.99*sin(2*PI*400*t):s=48000:d=6','-ac','2',loud]);
  const limited=await mixBackgroundMusic(base,loud,1,dir),peak=decode(limited.output,2).reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
  assert(peak<=1.02 && peak>0.9,`Peak-only protection without makeup (AAC reconstruction tolerance): ${peak}`);
  assert(Math.abs(limited.duration-Number((await inspectClip(base.output)).video.duration))<0.05,'Overlong music trimmed at video end');
  const discontinuous=Buffer.alloc(4800*8);
  for(let i=0;i<4800;i++)for(let c=0;c<2;c++)discontinuous.writeFloatLE(i/4800,(i*2+c)*4);
  const loop=loopMusicPcm(discontinuous,15000);let jump=0;
  for(let i=1;i<15000;i++)jump=Math.max(jump,Math.abs(loop.readFloatLE(i*8)-loop.readFloatLE((i-1)*8)));
  assert(jump<0.003,'Loop boundary crossfade removes discontinuity, without silence insertion');
  console.log(JSON.stringify({test:'canvas-background-music-decoded',gain:'PASS',originalUnity:'PASS',loopAndTrim:'PASS',peak:'PASS',nonCumulative:'PASS'}));
}
