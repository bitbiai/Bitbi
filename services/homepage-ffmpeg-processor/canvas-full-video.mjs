import { spawn } from 'node:child_process';
import { writeFile, readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const failure=code=>Object.assign(new Error(code),{code});
export function processingTimeout(deadline,now=Date.now()) {
  const remaining=deadline-now;
  if(remaining<=0)throw failure('canvas_processing_deadline');
  return Math.min(120000,remaining);
}
// No shell, no source URL in diagnostics, finite subprocess and byte limits.
export function mediaCommand(command,args,{cwd,timeout=600000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
    let stdout='';child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1000000) child.kill('SIGKILL');});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(failure('canvas_media_tool_failed'));});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(stdout):reject(failure('canvas_media_tool_failed'));});
  });
}
export async function inspectClip(file,{ffprobe='ffprobe',run=mediaCommand}={}) {
  const data=JSON.parse(await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-show_data_hash','sha256','-of','json',file]));
  const videos=data.streams.filter(s=>s.codec_type==='video'),audios=data.streams.filter(s=>s.codec_type==='audio');
  if(videos.length!==1 || audios.length>1) throw failure('canvas_stream_layout_unsupported');
  const v=videos[0],a=audios[0]||null;
  const duration=Math.max(Number(data.format.duration)||0,...data.streams.map(s=>Number(s.duration)||0));
  if(!(duration>0 && duration<=600 && v.width>0 && v.height>0 && v.width<=4096 && v.height<=4096)) throw failure('canvas_media_limits');
  const fingerprint=JSON.stringify(data.streams.map(s=>Object.fromEntries(['codec_type','codec_name','codec_tag_string','profile','level','width','height','pix_fmt','sample_aspect_ratio','time_base','r_frame_rate','sample_rate','channels','channel_layout','extradata_hash'].map(k=>[k,s[k]??null]))));
  return {video:v,audio:a,duration,fingerprint};
}

export async function concatenateClips(files,dir,{ffmpeg='ffmpeg',ffprobe='ffprobe',run=mediaCommand,limits={durationSeconds:600,outputBytes:80000000}}={}) {
  if(files.length<2 || files.some(f=>path.dirname(f)!==dir)) throw failure('canvas_sources_invalid');
  const clips=[];for(const file of files) clips.push(await inspectClip(file,{ffprobe,run}));
  const duration=clips.reduce((s,c)=>s+c.duration,0);
  if(duration>limits.durationSeconds) throw failure('canvas_duration_limit');
  const compatible=clips.every(c=>c.fingerprint===clips[0].fingerprint) && clips.every(c=>c.video.codec_name==='h264' && (!c.audio || c.audio.codec_name==='aac'));
  const hasAudio=clips.some(c=>c.audio);
  let inputs=files;
  if(!compatible) {
    const width=Math.ceil(Math.max(...clips.map(c=>c.video.width))/2)*2,height=Math.ceil(Math.max(...clips.map(c=>c.video.height))/2)*2;
    const fps=Math.max(...clips.map(c=>{const [n,d]=String(c.video.r_frame_rate).split('/').map(Number);return d?n/d:30;}));
    if(!Number.isFinite(fps) || fps>60 || fps<=0) throw failure('canvas_frame_rate_unsupported');
    inputs=[];let temporaryBytes=0;
    for(let i=0;i<files.length;i++) {
      const c=clips[i],output=path.join(dir,`normalized-${i}.mp4`);
      const args=['-y','-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',files[i]];
      if(hasAudio && !c.audio) args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
      args.push('-map','0:v:0');
      if(hasAudio) args.push('-map',c.audio?'0:a:0':'1:a:0','-af','aresample=48000,apad','-c:a','aac','-b:a','192k','-ac','2');
      args.push('-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${c.duration}`,
        '-t',String(c.duration),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-threads','2','-fs',String(limits.outputBytes+1),'-movflags','+faststart',output);
      await run(ffmpeg,args,{cwd:dir});temporaryBytes+=(await stat(output)).size;
      if(temporaryBytes>400000000 || (await stat(output)).size>limits.outputBytes)throw failure('canvas_temporary_size_limit');
      inputs.push(output);
    }
  }
  const list=path.join(dir,'clips.ffconcat');
  // Filenames are processor-created integers, never client strings or URLs.
  if(inputs.some(f=>!/^[a-z0-9-]+\.mp4$/.test(path.basename(f)))) throw failure('canvas_source_name_invalid');
  await writeFile(list,inputs.map(f=>`file '${path.basename(f)}'`).join('\n')+'\n');
  const output=path.join(dir,'full-video.mp4');
  await run(ffmpeg,['-y','-v','error','-nostdin','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',list,'-map','0:v:0',...(hasAudio?['-map','0:a:0']:[]),'-c','copy','-movflags','+faststart',output],{cwd:dir});
  if((await stat(output)).size>limits.outputBytes) throw failure('canvas_output_size_limit');
  const result=await inspectClip(output,{ffprobe,run});
  // Encoded packet duration rounding is permitted, missing clips/audio is not.
  if(Math.abs(result.duration-duration)>Math.max(0.25,files.length*0.06) || Boolean(result.audio)!==hasAudio) throw failure('canvas_output_incomplete');
  return {output,duration:result.duration,width:result.video.width,height:result.video.height,mode:compatible?'copy':'normalized'};
}

export async function processCanvasExports({requestJson,authHeaders,baseUrl,limit,dryRun=false,ffmpeg='ffmpeg',ffprobe='ffprobe',fetchImpl=fetch}) {
  const base='/api/internal/homepage/hero-videos/canvas-exports/jobs';
  const json=(url,init={})=>requestJson(url,{...init,signal:init.signal||AbortSignal.timeout(120000)});
  const protocol=await json(base+'/claim');
  if(protocol?.data?.protocol!==1) throw failure('canvas_processor_protocol');
  if(dryRun) return; // A dry run must not acquire a processing lease.
  const jobs=(await json(base+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:1,limit:Math.min(1,limit)})})).data.jobs;
  for(const job of jobs) {
    const deadline=Date.now()+12*60_000;
    const boundedRun=(cmd,args,options={})=>{const remaining=deadline-Date.now();if(remaining<=0)throw failure('canvas_processing_deadline');return mediaCommand(cmd,args,{...options,timeout:remaining});};
    const dir=await mkdtemp(path.join(tmpdir(),'bitbi-canvas-full-'));
    const headers=authHeaders({'X-BITBI-Canvas-Claim':job.claim});
    try {
      let total=0;const files=[];
      for(let i=0;i<job.sources.length;i++) {
        const url=new URL(job.sources[i].url,baseUrl);
        if(url.origin!==new URL(baseUrl).origin || url.pathname!==`${base}/${job.id}/source/${i}`) throw failure('canvas_source_route_invalid');
        const response=await fetchImpl(url,{headers,redirect:'error',signal:AbortSignal.timeout(processingTimeout(deadline))});
        if(!response.ok) throw failure('canvas_source_unavailable');
        const chunks=[];let size=0;
        for await(const chunk of response.body) {size+=chunk.length;total+=chunk.length;if(size>80000000 || total>job.limits.sourceBytes)throw failure('canvas_source_size');chunks.push(chunk);}
        if(size!==job.sources[i].size)throw failure('canvas_source_changed');
        const file=path.join(dir,`clip-${i}.mp4`);await writeFile(file,Buffer.concat(chunks));files.push(file);
      }
      const result=await concatenateClips(files,dir,{ffmpeg,ffprobe,limits:job.limits,run:boundedRun});
      const form=new FormData();form.set('video',new Blob([await readFile(result.output)],{type:'video/mp4'}),'full-video.mp4');
      for(const key of ['duration','width','height'])form.set(key,String(result[key]));
      await json(`${base}/${job.id}/complete`,{method:'POST',headers,body:form,signal:AbortSignal.timeout(processingTimeout(deadline))});
      console.log(JSON.stringify({phase:'canvas_full_video',status:'stored',mode:result.mode}));
    } catch(error) {
      const code=/^canvas_[a-z_]+$/.test(error.code||'')?error.code:'canvas_processing_failed';
      await json(`${base}/${job.id}/fail`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({code})});
      console.error(JSON.stringify({phase:'canvas_full_video',code}));process.exitCode=1;
    } finally {await rm(dir,{recursive:true,force:true});}
  }
}
