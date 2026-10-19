import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {testAudioFit} from './canvas-audio-fit.test.mjs';
import {testSmoothJoins} from './canvas-seams.test.mjs';
import {testCanvasAssemblyProcessing} from './canvas-assembly.test.mjs';
import {concatenateClips,mediaCommand,inspectClip,processingTimeout,processCanvasExports,mixBackgroundMusic,loopMusicPcm} from './canvas-full-video.mjs';

export async function testMediaCommandDiagnostics() {
  const {safeCanvasDiagnostic}=await import('./canvas-diagnostics.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'media-tool-private-fixture-'));
  const check=(error,code,fields)=>{
    assert.equal(error.code,code,JSON.stringify(safeCanvasDiagnostic(error.diagnostic)));assert(Number.isSafeInteger(error.diagnostic.elapsedMs));
    for(const [key,value] of Object.entries(fields))assert.equal(error.diagnostic[key],value);
    for(const value of [dir,'private-argument','private.invalid','signed-token','private-token'])assert(!(String(error.stack)+JSON.stringify(error)).includes(value));
    assert(!('stderr' in error.diagnostic));return true;
  };
  try {
    for(const [tool,osCode] of [['ffmpeg','ENOENT'],['ffprobe','EACCES']]) {
      const command=path.join(dir,tool);
      if(osCode==='EACCES'){await writeFile(command,'private invalid executable');await chmod(command,0o600);}
      await assert.rejects(mediaCommand(command,['private-argument','https://private.invalid/signed-token']),error=>check(error,'canvas_media_configuration',{tool,osCode,errorClass:'configuration'}));
    }
    // Emit fixed synthetic diagnostics synchronously, without starting another
    // Node runtime. Pass untrusted-looking text as argv, never as shell source.
    for(const [message,code,reason] of [
      ['Invalid data found','canvas_media_invalid','invalid_media'],
      ['First input link main timebase (1/1000000) do not match the corresponding second input link xfade timebase (1/24)','canvas_media_filter_invalid','timebase_mismatch'],
      ['No space left on device; Error reinitializing filters','canvas_media_resource_limit','resource_limit'],
      ['Unrecognized fixture failure','canvas_media_tool_failed','unknown'],
    ])await assert.rejects(mediaCommand('/bin/sh',['-c','printf "%s\\n" "$1" >&2; exit 7','fixture','private-token https://private.invalid/secret '+message]),error=>check(error,code,{exit:7,signal:null,reason}));
    await assert.rejects(mediaCommand('/bin/sh',['-c','exit 7']),error=>check(error,'canvas_media_tool_failed',{exit:7,signal:null,reason:'unknown'}));
    await assert.rejects(mediaCommand('/bin/sh',['-c','exec sleep 10'],{timeout:50}),error=>check(error,'canvas_processing_deadline',{exit:null,signal:'SIGKILL',reason:'deadline'}));
    for(const signal of ['SIGKILL','SIGSEGV'])await assert.rejects(mediaCommand('/bin/sh',['-c',`ulimit -c 0; kill -${signal.slice(3)} $$`]),error=>check(error,'canvas_media_tool_failed',{exit:null,signal,reason:'unknown'}));
    console.log('Media diagnostics: missing/denied tools, timebase/media/resource classes, private-data redaction and deadline versus external signal passed.');
  } finally {await rm(dir,{recursive:true,force:true});}
}

export async function testCanvasConcatenation() {
  await testCanvasConcatenationCore();
  await (await import('./canvas-transitions.test.mjs')).testCanvasTransitions();
}

// The image runner executes these complete groups in separate bounded processes.
// The ordinary public caller above always executes both; there is no skip option.
export async function testCanvasConcatenationCore() {
  await testCanvasAssemblyProcessing();
  await testMediaCommandDiagnostics();
  await testCanvasProcessorStorageRecovery();
  assert.equal(processingTimeout(720000,0),120000);
  assert.equal(processingTimeout(720000,719000),1000);
  assert.throws(()=>processingTimeout(720000,720000),/canvas_processing_deadline/);
  for(const advertised of [undefined,4,5,6]) {
    let claims=0;
    await processCanvasExports({baseUrl:'https://processor.invalid',limit:1,authHeaders:()=>({}),
      requestJson:async(url,init={})=>{
        if(!init.method)return {data:{protocol:1,...(advertised===undefined?{}:{recipeProtocol:advertised})}};
        assert.equal(JSON.parse(init.body).recipeProtocol,advertised??4,'New media also serves the previous Auth during ordered rollout');
        claims++;return {data:{jobs:[]}};
      }});
    assert.equal(claims,1);
  }
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
        if(url===prefix+'/claim' && !init.method)return {data:{protocol:1,recipeProtocol:5,previewBase:1}};
        if(url===prefix+'/claim'){assert.equal(JSON.parse(init.body).limit,1);assert.equal(JSON.parse(init.body).recipeProtocol,5);return {data:{jobs:[{id,claim,limits:{sourceBytes:400000000,outputBytes:80000000,durationSeconds:600},backgroundMusic:musicRecipe?{enabled:true,gain:0.5}:undefined,sources:bytes.map((b,i)=>({url:`${prefix}/${id}/source/${i}`,size:b.length,kind:i===2?'music':'video'}))}]}};}
        if(url===`${prefix}/${id}/complete?part=preview-base`) {
          assert.equal(init.headers['X-BITBI-Canvas-Claim'],claim);
          assert.deepEqual(Buffer.from(await init.body.get('video').arrayBuffer()),await readFile(pair.output),'Preserve the byte-identical clean concatenation before mixing');
          return {data:{base_stored:true}};
        }
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
    assert.deepEqual(calls,[[prefix+'/claim','GET'],[prefix+'/claim','POST'],[`${prefix}/${id}/complete?part=preview-base`,'POST'],[`${prefix}/${id}/complete`,'POST']], 'One explicit job retains its clean base and uploads the mixed result once');
    const full=await concatenateClips(files,dir);assert.equal(full.mode,'normalized');
    assert(full.duration>=3.75 && full.duration<4.0);assert.equal(full.width,320);assert.equal(full.height,180);
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
    await testCenterCrop();
    await testCanvasAudioControls();
    await testSmoothJoins();
  await testAudioFit();
    await assert.rejects(concatenateClips(files,dir,{limits:{durationSeconds:1,outputBytes:80000000}}),/canvas_duration_limit/);
    await assert.rejects(concatenateClips(files.slice(0,1),dir),/canvas_sources_invalid/);
    assert((await readFile(full.output)).byteLength>1000);
    console.log(JSON.stringify({test:'canvas-full-video-native-ffmpeg',two:pair.mode,five:full.mode,duration:full.duration,pixelOrder:'PASS',audioAndSilence:'PASS'}));
  } finally {await rm(dir,{recursive:true,force:true});}
}

// Actual processor entrypoint -> authenticated HTTP -> private runner -> claim,
// downloads, clean-base and final completion. The backend is synthetic; FFmpeg,
// requestJson, error classification and uploaded MP4s are the production code.
export async function testCanvasProcessorStorageRecovery() {
  const {createServer}=await import('node:http'),{spawn}=await import('node:child_process');
  const {once}=await import('node:events');
  const {AUDIO_FIT_POLICY}=await import('./canvas-audio-fit.mjs');
  const {SEAM_POLICY}=await import('./canvas-seams.mjs');
  const {TRANSITION_POLICY}=await import('./canvas-transition-contract.mjs');
  const {canvasProcessingFailure}=await import('./canvas-diagnostics.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'canvas-processor-storage-'));
  const base='/api/internal/homepage/hero-videos',exports=base+'/canvas-exports/jobs',token='1'.repeat(32),claim='2'.repeat(32);
  let current,serverError=null,children=new Set();
  const server=createServer(async(req,res)=>{
    try {
      assert.equal(req.headers.authorization,'Bearer synthetic-storage-only');
      const url=new URL(req.url,'http://synthetic.invalid'),chunks=[];for await(const chunk of req)chunks.push(chunk);
      const bytes=Buffer.concat(chunks),send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:status===200,...(status===200?{data}:data)}));};
      const json=()=>JSON.parse(bytes.toString()||'{}');
      current.routes.push(`${req.method} ${url.pathname}`);
      if(url.pathname===base+'/private-media/runner') {
        const body=json();assert.equal(body.token,token);assert.equal(body.runner,'storage-regression');
        assert(['acquire','heartbeat','finish'].includes(body.action));
        if(body.action==='acquire')current.acquires++;
        if(body.action==='finish')current.finishes++;
        return send(200,{pending:0,previews:{hero:false,stream:false}});
      }
      if(url.pathname===base+'/reference-videos/jobs/claim')return send(200,{jobs:[]});
      if(url.pathname===exports+'/claim') {
        if(req.method==='GET')return send(200,{protocol:1,recipeProtocol:9,previewBase:1});
        assert.equal(json().recipeProtocol,9);
        const eligible=!current.saved&&!current.terminal;
        if(eligible)current.claims++;
        return send(200,{jobs:eligible?[{...current.job,attempt:current.claims}]:[]});
      }
      if(url.pathname===base+'/source-posters/jobs/claim') {
        if(current.posterFailure&&current.saved)return send(503,{code:'synthetic_poster_claim_unavailable'});
        return send(200,{jobs:[]});
      }
      const source=url.pathname.match(new RegExp(`^${exports}/${current.job.id}/source/(\\d+)$`));
      if(source) {
        assert.equal(req.headers['x-bitbi-canvas-claim'],claim);current.downloads++;
        const content=current.inputs[Number(source[1])];assert(content);res.writeHead(200);return res.end(content);
      }
      if(url.pathname===`${exports}/${current.job.id}/complete`) {
        assert.equal(req.headers['x-bitbi-canvas-claim'],claim);
        const form=await new Response(bytes,{headers:{'Content-Type':req.headers['content-type']}}).formData();
        const video=Buffer.from(await form.get('video').arrayBuffer());assert.equal(video.subarray(4,8).toString(),'ftyp');
        assert(Math.abs(Number(form.get('duration'))-1.5)<.001);
        const preview=url.searchParams.get('part')==='preview-base';
        current[preview?'previewCalls':'finalCalls']++;
        if(current.failure?.stage===(preview?'preview':'final')&&!current.failedOnce) {
          current.failedOnce=true;
          if(current.failure.commit){current.saved=video;current.savedCount++;res.destroy();return;}
          return send(current.failure.status,{code:current.failure.code||'private-storage-unavailable',detail:'private-token https://private.invalid/secret'});
        }
        if(preview){current.clean=video;return send(200,{base_stored:true});}
        assert(!current.saved,'An already committed video must not be uploaded again');
        current.saved=video;current.savedCount++;
        return send(200,{asset_id:current.job.id,status:'preview_pending'});
      }
      if(url.pathname===`${exports}/${current.job.id}/fail`) {
        const failure=json();current.failures.push(failure);
        assert(!bytes.toString().includes('private-token'));assert(!bytes.toString().includes('private.invalid'));
        // Mirror the existing receipt-first branch, not a fresh render after an
        // acknowledgement is lost. Native D1 tests exercise the actual writer.
        if(!current.saved)current.terminal=failure.code!=='canvas_processing_transient';
        return send(200,{recorded:true});
      }
      assert.fail(`Unexpected processor operation: ${req.method} ${url.pathname}`);
    } catch(error){serverError||=error;res.writeHead(500);res.end('{}');}
  });
  const run=async()=>{
    const child=spawn(process.execPath,[new URL('./processor.mjs',import.meta.url).pathname],{detached:true,env:{PATH:process.env.PATH,
      AUTH_WORKER_BASE_URL:`http://127.0.0.1:${server.address().port}`,MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET:'synthetic-storage-only',
      PRIVATE_MEDIA_DISPATCH:token,PRIVATE_MEDIA_RUNNER:'storage-regression',MEMBER_GENERATION_POSTERS_ONLY:'1'},stdio:['ignore','pipe','pipe']});
    children.add(child);let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-20000);});
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},120000);
    try {const [code,signal]=await once(child,'close');assert.equal(signal,null,'The actual processor must terminate within its fixture deadline');
      if(serverError)throw serverError;
      assert(!output.includes('private-token'));assert(!output.includes('private.invalid'));return {code,output};
    } finally {clearTimeout(timer);children.delete(child);}
  };
  const decode=file=>{const result=spawnSync('ffmpeg',['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','-'],{maxBuffer:5_000_000});assert.equal(result.status,0);return result.stdout;};
  const amplitude=(pcm,hz,start)=>{let re=0,im=0;const offset=Math.round(start*48000),n=4800;assert((offset+n)*4<=pcm.length);
    for(let i=0;i<n;i++){const v=pcm.readFloatLE((offset+i)*4),angle=2*Math.PI*hz*i/48000;re+=v*Math.cos(angle);im+=v*Math.sin(angle);}return 2*Math.hypot(re,im)/n;};
  try {
    const files=[];
    for(const [i,color] of ['red','blue'].entries()) {
      const file=path.join(dir,`source-${i}.mp4`);files.push(file);
      await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=160x90:r=24:d=0.75`,
        ...(i===0?['-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=0.75']:[]),'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(i===0?['-c:a','aac']:[]),file]);
    }
    const clips=await Promise.all(files.map(file=>readFile(file))),music=[];
    for(const duration of [.35,3]) {const file=path.join(dir,`music-${duration}.wav`);await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=1200:sample_rate=48000:duration=${duration}`,'-ac','2',file]);music.push(await readFile(file));}
    const original=amplitude(decode(files[0]),400,.2);assert(original>.08);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const scenarios=[
      {name:'preview-transient',failure:{stage:'preview',status:503},music:0,retry:true},
      {name:'final-rate-limit',failure:{stage:'final',status:429},music:1,retry:true},
      {name:'committed-ack-lost',failure:{stage:'final',commit:true},music:0,retry:true},
      {name:'permanent-source-change',failure:{stage:'preview',status:409,code:'canvas_music_changed'},music:0,terminal:true},
      {name:'poster-unavailable',music:1,posterFailure:true},
      {name:'music-off',music:null},
    ];
    for(const [index,scenario] of scenarios.entries()) {
      const id=(index+3).toString(16).repeat(32),inputs=[...clips,...(scenario.music===null?[]:[music[scenario.music]])];
      current={...scenario,terminal:false,inputs,routes:[],acquires:0,finishes:0,claims:0,downloads:0,previewCalls:0,finalCalls:0,savedCount:0,failures:[],saved:null,clean:null,
        job:{id,claim,recipeVersion:8,limits:{sourceBytes:400_000_000,outputBytes:80_000_000,durationSeconds:600},spatialPolicy:'center-crop-v1',
          smoothJoins:{policy:SEAM_POLICY,enabled:false},originalAudioPolicy:AUDIO_FIT_POLICY,transitionPolicy:TRANSITION_POLICY,transitions:[{preset:'none'}],
          assembly:{version:1,clips:files.map((_,i)=>({nodeId:(i+1).toString(16).repeat(32),trim:{start:0},transition:{preset:'none'}})),target:{seconds:1.5,mode:'creative'}},
          originalAudio:files.map(()=>({enabled:true,gain:.5,fadeIn:0,fadeOut:0})),backgroundMusic:{enabled:scenario.music!==null,gain:.5,fadeIn:0,fadeOut:0},
          sources:inputs.map((bytes,i)=>({url:`${exports}/${id}/source/${i}`,size:bytes.length,kind:i===2?'music':'video'}))}};
      const first=await run();assert.equal(first.code,scenario.failure||scenario.posterFailure?1:0,first.output);
      assert.equal(current.finishes,1,'The private runner releases its activation after success or failure');
      if(scenario.failure) {
        assert.equal(current.failures.length,1);
        assert.equal(current.failures[0].code,scenario.terminal?'canvas_music_changed':'canvas_processing_transient');
        assert.equal(current.failures[0].diagnostic.stage,scenario.failure.stage==='preview'?'preview_upload':'complete');
        if(scenario.failure.status)assert.equal(current.failures[0].diagnostic.httpStatus,scenario.failure.status);
        if(!scenario.failure.commit)assert.equal(current.saved,null,'A clean base or failed completion is not the requested final export');
      }
      if(scenario.retry) {
        const repeated=await run();assert.equal(repeated.code,0,repeated.output);
        assert.equal(current.claims,scenario.failure.commit?1:2,'A saved final artifact is reconciled without another render');
        assert.equal(current.savedCount,1);
        if(scenario.failure.commit)assert.equal(current.finalCalls,1);
      }
      if(scenario.terminal){assert(current.terminal);assert.equal(current.saved,null);continue;}
      assert(current.saved);assert.equal(current.savedCount,1);
      const output=path.join(dir,`${scenario.name}.mp4`);await writeFile(output,current.saved);
      const inspected=await inspectClip(output);assert.equal(inspected.videoDuration,1.5);assert.equal(Number(inspected.video.nb_frames),36);assert.equal(inspected.video.width,160);assert.equal(inspected.video.height,90);
      const pcm=decode(output);assert(Math.abs(amplitude(pcm,400,.2)/original-.5)<.06,'Requested source audio gain survives the actual upload');
      assert(amplitude(pcm,400,1)<.001,'Audio-less source does not inherit another clip audio');
      const audible=audio=>amplitude(audio,1200,.2)>.025&&amplitude(audio,1200,1.25)>.025;
      if(scenario.music!==null){assert(audible(pcm),'The uploaded MP4 contains audible selected music across both clips');
        const clean=path.join(dir,'clean.mp4');await writeFile(clean,current.clean);assert(!audible(decode(clean)),'The same oracle rejects the unscored preview base');}
      else assert(!audible(pcm),'Music-off never invents a background soundtrack');
      for(const [at,channel] of [[.2,0],[1,2]]) {const pixel=spawnSync('ffmpeg',['-v','error','-ss',String(at),'-i',output,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:100000});assert.equal(pixel.status,0);assert(pixel.stdout[channel]>200);assert(pixel.stdout[(channel+1)%3]<50);}
      for(const [i,file] of files.entries())assert.deepEqual(await readFile(file),clips[i],'Owned original bytes stay unchanged');
    }
    for(const status of [400,401,403,404,409,422])assert.notEqual(canvasProcessingFailure({status,body:{code:'untrusted-code',detail:'private-token'}}).code,'canvas_processing_transient','Permanent admission/ownership failures must not become retries');
    assert.equal(canvasProcessingFailure({status:503,body:{code:'private-token'}}).code,'canvas_processing_transient');
    console.log('Canvas processor HTTP storage: preview 503/final 429 bounded recovery, committed final lost acknowledgement, permanent 409, poster outage after saved video, actual uploaded source/music tone gains and order, short/long/music-off and clean-base broken control passed.');
  } finally {
    for(const child of children)try{process.kill(-child.pid,'SIGKILL');}catch{}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
  }
}

export async function testCenterCrop() {
  const dir=await mkdtemp(path.join(tmpdir(),'canvas-center-crop-'));
  const decode=(file,time=0)=>{
    const r=spawnSync('ffmpeg',['-v','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:20_000_000});assert.equal(r.status,0);return r.stdout;
  };
  const marker=async(name,width,height)=>{
    const rgb=Buffer.alloc(width*height*3);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*3;
      const level=35+((Math.floor(x/17)+2*Math.floor(y/19))%5)*45;
      rgb[i]=rgb[i+1]=rgb[i+2]=level;
    }
    const ppm=path.join(dir,name+'.ppm'),file=path.join(dir,name+'.mp4');
    await writeFile(ppm,Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
    await mediaCommand('ffmpeg',['-v','error','-y','-loop','1','-i',ppm,'-t','0.5','-r','24','-c:v','libx264','-crf','0','-pix_fmt','yuv444p','-threads','1',file]);return file;
  };
  // Independent pixel-coordinate oracle: compare decoded originals at the
  // explicitly expected integer offsets, never derive expectations from filters.
  const error=(actual,original,w,h,sourceW,left,top)=>{
    let sum=0,count=0;
    for(const y of [2,17,Math.floor(h/2),h-19,h-3])for(const x of [2,21,57,Math.floor(w/2),w-37,w-3])for(let c=0;c<3;c++){
      sum+=Math.abs(actual[(y*w+x)*3+c]-original[((y+top)*sourceW+x+left)*3+c]);count++;
    }
    return sum/count;
  };
  try {
    const large=await marker('large',1343,768),small=await marker('small',1280,720),third=await marker('third',1300,740);
    const odd=await marker('odd',321,181),oddLarge=await marker('odd-large',333,193);
    const originals=new Map(await Promise.all([large,small,third,odd,oddLarge].map(async f=>[f,await readFile(f)])));
    for(const [files,w,h,positions] of [
      [[large,small],1280,720,[[1343,31,24],[1280,0,0]]],
      [[small,large],1280,720,[[1280,0,0],[1343,31,24]]],
      [[large,small,third],1280,720,[[1343,31,24],[1280,0,0],[1300,10,10]]],
      [[small,small],1280,720,[[1280,0,0],[1280,0,0]]],
      [[odd,oddLarge],320,180,[[321,0,0],[333,6,6]]],
    ]){
      const result=await concatenateClips(files,dir);assert.equal(result.width,w);assert.equal(result.height,h);
      for(let i=0;i<files.length;i++){const measured=error(decode(result.output,i*0.5+0.2),decode(files[i]),w,h,...positions[i]);assert(measured<13,`Decoded spatial markers: ${path.basename(files[i])}, segment ${i}, mean error ${measured}`);}
    }
    const broken=path.join(dir,'broken.mp4');
    for(const filter of ['scale=1280:720','crop=1280:720:0:0']){
      await mediaCommand('ffmpeg',['-v','error','-y','-i',large,'-vf',filter,'-c:v','libx264','-pix_fmt','yuv420p','-threads','1',broken]);
      assert(error(decode(broken),decode(large),1280,720,1343,31,24)>25,'Pixel oracle rejects stretching and corner cropping');
    }
    const rotated=path.join(dir,'rotated.mp4'),portrait=await marker('portrait',720,1280);
    // Write the standard MP4 track display matrix directly: FFmpeg 5 and 8
    // differ in whether metadata:s rotate still creates it. No image transform.
    const rotatedBytes=Buffer.from(await readFile(portrait)),track=rotatedBytes.indexOf(Buffer.from('tkhd'));
    assert(track>0);const matrix=track+44+(rotatedBytes[track+4]===1?12:0);
    [0,-65536,0,65536,0,0,0,0,1073741824].forEach((n,i)=>rotatedBytes.writeInt32BE(n,matrix+i*4));await writeFile(rotated,rotatedBytes);
    assert.equal(Math.abs((await inspectClip(rotated)).video.side_data_list.find(s=>s.rotation!==undefined).rotation),90);
    const rotatedResult=await concatenateClips([large,rotated],dir);assert.equal(rotatedResult.width,1280);assert.equal(rotatedResult.height,720);
    assert(error(decode(rotatedResult.output,0.7),decode(rotated),1280,720,1280,0,0)<13,'Display rotation precedes centered crop');
    const wide=path.join(dir,'wide.mp4');
    await mediaCommand('ffmpeg',['-v','error','-y','-i',small,'-vf','setsar=2','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',wide]);
    const sar=await concatenateClips([wide,wide],dir);assert.equal((await inspectClip(sar.output)).video.sample_aspect_ratio,'2:1');
    await assert.rejects(concatenateClips([small,wide],dir),/canvas_sample_aspect_ratio_unsupported/);
    await assert.rejects(concatenateClips([small,large],dir,{spatialPolicy:'unknown'}),/canvas_spatial_policy_unsupported/);
    const legacy=await concatenateClips([small,third],dir,{spatialPolicy:'legacy-pad-v1'});assert.equal(legacy.width,1300);assert.equal(legacy.height,740,'Previously queued recipe keeps old raster');
    for(const [file,bytes]of originals)assert.deepEqual(await readFile(file),bytes,'Original bytes never change');
    console.log('Canvas center crop: decoded exact/odd/reversed/middle/same-size/orientation/SAR, broken framing controls and legacy compatibility passed.');
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

// Focused decoded acceptance for the new per-clip envelopes. Separate entrypoint
// permits reuse of unchanged crop/lifecycle evidence during local development.
export async function testCanvasAudioControls() {
  const {applyOriginalAudio}=await import('./canvas-full-video.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'canvas-audio-test-'));
  try {
    const files=[];
    for(let i=0;i<3;i++) {
      const file=path.join(dir,`audio-${i}.mp4`);files.push(file);
      await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${['red','green','blue'][i]}:s=${i===1?'352x240':'320x180'}:r=24:d=2`,
        ...(i===2?[]:['-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=2']),'-c:v','libx264','-pix_fmt','yuv420p','-threads','1',...(i===2?[]:['-c:a','aac']),file]);
    }
    const raw=await concatenateClips(files,dir);
    const settings=[{enabled:true,gain:.5,fadeIn:.5,fadeOut:.5},{enabled:false,gain:.8,fadeIn:1,fadeOut:1},{enabled:true,gain:1,fadeIn:6,fadeOut:6}];
    const adjusted=await applyOriginalAudio(raw,settings,dir);
    const decode=async file=>Buffer.from(await new Promise((resolve,reject)=>{
      const p=spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-'],{maxBuffer:20_000_000});p.status?reject(new Error(String(p.stderr))):resolve(p.stdout);
    }));
    const amplitude=(pcm,hz,start,span=.08)=>{const offset=Math.round(start*48000),n=Math.round(span*48000);let re=0,im=0,w=0;
      for(let i=0;i<n;i++){const weight=.5-.5*Math.cos(2*Math.PI*i/(n-1)),v=pcm.readFloatLE((offset+i)*4);re+=v*weight*Math.cos(2*Math.PI*hz*i/48000);im+=v*weight*Math.sin(2*Math.PI*hz*i/48000);w+=weight;}return 2*Math.hypot(re,im)/w;};
    const original=await decode(raw.output),audio=await decode(adjusted.output);
    const source=amplitude(original,1000,.9);assert(source>.08);
    for(const [t,ratio] of [[.06,.1],[.9,.5],[1.75,.21]])assert(Math.abs(amplitude(audio,1000,t)/source-ratio)<.055,`Local clip envelope at ${t}`);
    assert(amplitude(audio,1000,2.9)<.001,'Only second original is muted');
    assert(amplitude(audio,1000,4.8)<.001,'Silent clip stays silent');
    const music=path.join(dir,'music.wav');await mediaCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-ac','2',music]);
    const mixed=await mixBackgroundMusic(adjusted,music,.5,dir,{fadeIn:1,fadeOut:1});const both=await decode(mixed.output);
    assert(Math.abs(amplitude(both,1000,.9)/source-.5)<.04,'Music does not reapply original gain');
    assert(amplitude(both,440,2.9)>.04,'Music audible while clip original muted');
    assert(amplitude(both,440,4.8)>.04,'Music spans silent endpoint as well as chain');
    const musicMid=amplitude(both,440,2.9);assert(amplitude(both,440,.06)/musicMid<.16);assert(amplitude(both,440,5.85)/musicMid<.3);
    // Real broken-signal controls: the oracle rejects unprocessed/missing/mixed
    // originals and zero-gain music, not merely matching settings JSON.
    const validMuted=pcm=>amplitude(pcm,1000,2.9)<.001;
    assert(!validMuted(original));assert(validMuted(audio));
    assert(amplitude(audio,440,2.9)<.001,'No invented music in music-off output');
    const off=await mixBackgroundMusic(adjusted,music,0,dir,{fadeIn:1,fadeOut:1});assert.equal(off.output,adjusted.output);
    assert.equal(mixed.width,320);assert.equal(mixed.height,180);assert(Math.abs(mixed.duration-raw.duration)<.06);
    console.log('Canvas audio decoded: independent mute/gain, fractional local fades, music across the full chain, silence, no double gain and broken-signal controls passed.');
  } finally {await rm(dir,{recursive:true,force:true});}
}
