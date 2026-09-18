import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {concatenateClips,mediaCommand,inspectClip,processingTimeout,processCanvasExports} from './canvas-full-video.mjs';

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
    const transport={baseUrl:'https://processor.invalid',limit:3,authHeaders:extra=>({Authorization:'Bearer synthetic',...extra}),
      requestJson:async(url,init={})=>{
        calls.push([url,init.method||'GET']);assert(init.signal);
        if(url===prefix+'/claim' && !init.method)return {data:{protocol:1}};
        if(url===prefix+'/claim'){assert.equal(JSON.parse(init.body).limit,1);return {data:{jobs:[{id,claim,limits:{sourceBytes:400000000,outputBytes:80000000,durationSeconds:600},sources:bytes.map((b,i)=>({url:`${prefix}/${id}/source/${i}`,size:b.length}))}]}};}
        assert.equal(url,`${prefix}/${id}/complete`);assert.equal(init.headers['X-BITBI-Canvas-Claim'],claim);
        assert.equal(init.body.get('video').type,'video/mp4');assert.deepEqual(Buffer.from(await init.body.get('video').arrayBuffer()),await readFile(pair.output));
        assert(Number(init.body.get('duration'))>=1.5);return {data:{status:'preview_pending'}};
      },fetchImpl:async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer synthetic');assert.equal(init.headers['X-BITBI-Canvas-Claim'],claim);assert.equal(init.redirect,'error');return new Response(bytes[Number(url.pathname.split('/').at(-1))]);}};
    await processCanvasExports({...transport,dryRun:true});assert.deepEqual(calls,[[prefix+'/claim','GET']]);calls.length=0;
    await processCanvasExports(transport);assert.deepEqual(calls,[[prefix+'/claim','GET'],[prefix+'/claim','POST'],[`${prefix}/${id}/complete`,'POST']]);
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
    await assert.rejects(concatenateClips(files,dir,{limits:{durationSeconds:1,outputBytes:80000000}}),/canvas_duration_limit/);
    await assert.rejects(concatenateClips(files.slice(0,1),dir),/canvas_sources_invalid/);
    assert((await readFile(full.output)).byteLength>1000);
    console.log(JSON.stringify({test:'canvas-full-video-native-ffmpeg',two:pair.mode,five:full.mode,duration:full.duration,pixelOrder:'PASS',audioAndSilence:'PASS'}));
  } finally {await rm(dir,{recursive:true,force:true});}
}
