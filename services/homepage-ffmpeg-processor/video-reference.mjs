import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mediaCommand,inspectClip} from './canvas-full-video.mjs';
const fail=()=>{throw Object.assign(new Error('h3_reference_preparation_failed'),{code:'h3_reference_preparation_failed'});};

export async function prepareReference(file,dir,{ffmpeg='ffmpeg',ffprobe='ffprobe',run=mediaCommand}={}) {
  const source=await inspectClip(file,{ffprobe,run}),v=source.video;
  const [n,d]=String(v.avg_frame_rate).split('/').map(Number),fps=n/d,frames=Number(v.nb_frames);
  if(!Number.isFinite(fps)||fps<23.976||fps>60||!Number.isInteger(frames)
    || source.duration<=15||source.duration>15+2/fps+0.000001||frames>Math.round(15*fps)+2)fail();
  const output=path.join(dir,'reference.mp4');
  const args=['-y','-v','error','-nostdin','-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0'];
  if(source.audio)args.push('-map','0:a:0','-af','atrim=duration=15,asetpts=PTS-STARTPTS','-c:a','aac','-b:a','192k');
  args.push('-vf','trim=duration=15,setpts=PTS-STARTPTS','-t','15','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-threads','2','-fs','50000001','-movflags','+faststart',output);
  await run(ffmpeg,args,{cwd:dir,timeout:120000});
  const result=await inspectClip(output,{ffprobe,run});
  if(result.duration>15||result.duration<14.9||result.video.width!==v.width||result.video.height!==v.height
    || Boolean(result.audio)!==Boolean(source.audio)||(await stat(output)).size>50_000_000)fail();
  return {output,source,result};
}

export async function processVideoReferences({requestJson,authHeaders,baseUrl,ffmpeg='ffmpeg',ffprobe='ffprobe',fetchImpl=fetch,dryRun=false}) {
  if(dryRun)return;
  const base='/api/internal/homepage/hero-videos/reference-videos/jobs';
  const response=await requestJson(base+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({protocol:1})});
  for(const job of response.data.jobs) {
    const dir=await mkdtemp(path.join(tmpdir(),'bitbi-video-reference-'));
    const headers={...authHeaders(),'X-BITBI-Canvas-Claim':job.claim};
    let decoding=false;
    try {
      if(!/^[a-f0-9]{32}$/.test(job.id)||job.source.url!==`${base}/${job.id}/source/0`)fail();
      const response=await fetchImpl(new URL(job.source.url,baseUrl),{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok)fail();
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>50_000_000)fail();chunks.push(chunk);}
      if(size!==job.source.size)fail();
      const file=path.join(dir,'source.mp4');await writeFile(file,Buffer.concat(chunks));
      decoding=true;
      const {output}=await prepareReference(file,dir,{ffmpeg,ffprobe});
      const form=new FormData();form.set('video',new Blob([await readFile(output)],{type:'video/mp4'}),'reference.mp4');
      // Unknown completion response is recovered by the same durable output key.
      decoding=false;
      await requestJson(`${base}/${job.id}/complete`,{method:'POST',headers,body:form,signal:AbortSignal.timeout(120000)});
      console.log(JSON.stringify({phase:'video_reference',status:'ready'}));
    } catch {
      if(decoding)await requestJson(`${base}/${job.id}/fail`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
      console.error(JSON.stringify({phase:'video_reference',code:'h3_reference_preparation_failed'}));
      process.exitCode=1;
    } finally {await rm(dir,{recursive:true,force:true});}
  }
}
