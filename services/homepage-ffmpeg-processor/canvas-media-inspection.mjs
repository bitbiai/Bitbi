import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectClip, mediaCommand } from './canvas-full-video.mjs';
const fail = code => { throw Object.assign(new Error(code), {code}); };

export async function extractCanvasFrame(file,dir,frame,{ffmpeg='ffmpeg',ffprobe='ffprobe',run=mediaCommand}={}) {
    const source=await inspectClip(file,{ffprobe,run});
    const [n,d]=String(source.video.avg_frame_rate).split('/').map(Number),fps=n/d;
    const [rn,rd]=String(source.video.r_frame_rate).split('/').map(Number);
    if(!Number.isFinite(fps)||fps<=0||fps>60||Math.abs(fps-rn/rd)>.001)fail('canvas_frame_rate_unsupported');
    let frames=Number(source.video.nb_frames);
    if(!Number.isSafeInteger(frames)) {
        const counted=JSON.parse(await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames','-of','json',file]));
        frames=Number(counted.streams?.[0]?.nb_read_frames);
    }
    if(!Number.isSafeInteger(frames)||frames<1||frames>36000||Math.abs(frames/fps-source.videoDuration)>1/fps+.001)fail('canvas_media_timing_invalid');
    const index=frame?.kind==='last'?frames-1:frame?.kind==='time'&&Number.isFinite(frame.seconds)?Math.round(frame.seconds*fps):NaN;
    if(!Number.isSafeInteger(index)||index<0||index>=frames)fail('canvas_inspection_frame_outside_source');
    const sample=frame.kind==='time',output=path.join(dir,sample?'sample.jpg':'frame.png');
    const filters=`select=eq(n\\,${index})`+(sample?",scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease":'');
    for(const quality of sample?[5,10,20]:[0]) {
        await run(ffmpeg,['-y','-v','error','-nostdin','-xerror','-protocol_whitelist','file,pipe','-i',file,'-map','0:v:0','-vf',filters,'-frames:v','1','-c:v',sample?'mjpeg':'png',...(sample?['-q:v',String(quality)]:[]),'-threads','1',output],{cwd:dir});
        const size=(await stat(output)).size;if(size>0&&size<=(sample?48000:10000000))break;
        if(!sample||quality===20)fail('canvas_inspection_image_invalid');
    }
    const dimensions=JSON.parse(await run(ffprobe,['-v','error','-show_entries','stream=width,height','-of','json',output])).streams[0];
    return {output,mimeType:sample?'image/jpeg':'image/png',metadata:{duration:frames/fps,width:sample?source.video.width:dimensions.width,height:sample?source.video.height:dimensions.height,fps,frames,hasAudio:Boolean(source.audio),frameTime:index/fps,
        ...(sample?{frameWidth:dimensions.width,frameHeight:dimensions.height,frameMimeType:'image/jpeg'}:{})}};
}

export async function processCanvasInspections({requestJson,authHeaders,baseUrl,ffmpeg='ffmpeg',ffprobe='ffprobe',fetchImpl=fetch}) {
    const base='/api/internal/homepage/hero-videos/canvas-exports/jobs/inspections';
    const result=await requestJson(base+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"protocol":1}',signal:AbortSignal.timeout(30000)});
    for(const job of result.data.jobs) {
        const dir=await mkdtemp(path.join(tmpdir(),'canvas-inspection-'));let completing=false;
        const headers=authHeaders({'X-BITBI-Canvas-Claim':job.claim});
        try {
            if(!/^[a-f0-9]{32}$/.test(job.id)||job.source.url!==`${base}/${job.id}/source`||job.complete!==`${base}/${job.id}/complete`||job.fail!==`${base}/${job.id}/fail`)fail('canvas_source_route_invalid');
            const response=await fetchImpl(new URL(job.source.url,baseUrl),{headers,redirect:'error',signal:AbortSignal.timeout(120000)});
            if(!response.ok)fail(response.status>=500?'canvas_processing_transient':'canvas_source_invalid');
            const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>80000000)fail('canvas_source_size');chunks.push(chunk);}
            if(bytes!==job.source.size)fail('canvas_source_changed');
            const input=path.join(dir,'source.mp4');await writeFile(input,Buffer.concat(chunks));
            const extracted=await extractCanvasFrame(input,dir,job.frame,{ffmpeg,ffprobe});
            const form=new FormData();form.set('image',new Blob([await readFile(extracted.output)],{type:extracted.mimeType}),extracted.mimeType==='image/jpeg'?'sample.jpg':'frame.png');form.set('metadata',JSON.stringify(extracted.metadata));
            completing=true;
            await requestJson(job.complete,{method:'POST',headers,body:form,signal:AbortSignal.timeout(120000)});
        } catch(error) {
            // The same claim/result key recovers a lost image-save reply. No
            // blind new extraction identity and no provider calls are involved.
            if(!completing)await requestJson(`${base}/${job.id}/fail`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({code:['TypeError','TimeoutError','AbortError'].includes(error.name)?'canvas_processing_transient':error.code}),signal:AbortSignal.timeout(30000)});
            process.exitCode=1;
        } finally {await rm(dir,{recursive:true,force:true});}
    }
}
