import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processCanvasExports, trimCanvasSources, mediaCommand, inspectClip } from './canvas-full-video.mjs';
import { canvasProcessingFailure, canvasFailureCanRetry } from './canvas-diagnostics.mjs';

export async function testCanvasTrimTimingRejection() {
    const dir=await mkdtemp(path.join(tmpdir(),'canvas-trim-timing-'));
    const assembly={version:1,target:{seconds:1,mode:'creative'},clips:[{nodeId:'1'.repeat(32),trim:{start:.25,duration:1}}]};
    try {
        for(const [average,nominal] of [['24/1','0/0'],['24/1','N/A'],['24/1','Infinity/1'],['24/1','24/0'],['24/1','-24/-1'],['-24/-1','24/1'],['24/1','120/1'],['24/1','30/1'],['24/1','24/1']]) {
            let encoded=0;
            const run=async command=>{
                if(command==='ffprobe')return JSON.stringify({format:{duration:'1'},streams:[{codec_type:'video',width:96,height:64,duration:'1',nb_frames:'24',avg_frame_rate:average,r_frame_rate:nominal}]});
                assert.equal(command,'ffmpeg');encoded++;throw Object.assign(Error('encoder_boundary_reached'),{code:'encoder_boundary_reached'});
            };
            const valid=average==='24/1'&&nominal==='24/1';
            await assert.rejects(trimCanvasSources([path.join(dir,'source.mp4')],assembly,dir,{run,creativeEndFit:true}),{code:valid?'encoder_boundary_reached':'canvas_frame_rate_unsupported'});
            assert.equal(encoded,valid?1:0,'Malformed picture timing must reject before an encoder is started; valid timing reaches it');
        }
    } finally {await rm(dir,{recursive:true,force:true});}
}

// Tiny, real-media caller: claim -> private HTTP sources -> production renderer
// -> clean-base/final HTTP uploads. No inference or live account is involved.
export async function testCanvasCreativeTrim() {
    const rejectedFit=canvasProcessingFailure({status:400,body:{code:'canvas_source_end_fit_invalid',private:'not diagnostic data'}});
    assert.deepEqual(rejectedFit,{code:'canvas_source_end_fit_invalid',diagnostic:{errorClass:'unknown',httpStatus:400}});
    assert.equal(canvasFailureCanRetry(rejectedFit.code),false,'A rejected measured adjustment remains precise and is not a new render authorization');
    await testCanvasTrimTimingRejection();
    const dir=await mkdtemp(path.join(tmpdir(),'canvas-creative-end-'));
    const base='/api/internal/homepage/hero-videos/canvas-exports/jobs',claim='a'.repeat(32),secret='synthetic-creative-trim';
    const width=96,height=64,frameBytes=width*height*3,originalExit=process.exitCode;
    let state,serverError;
    const server=createServer(async(req,res)=>{
        try {
            assert.equal(req.headers.authorization,`Bearer ${secret}`);
            const url=new URL(req.url,'http://synthetic.invalid');
            const send=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,data}));};
            state.requests.push(`${req.method} ${url.pathname}${url.search}`);
            if(url.pathname===base+'/claim') {
                if(req.method==='GET')return send({protocol:1,recipeProtocol:9,previewBase:1});
                const chunks=[];for await(const chunk of req)chunks.push(chunk);
                assert.deepEqual(JSON.parse(Buffer.concat(chunks)),{protocol:1,recipeProtocol:9,limit:1});
                assert.equal(++state.claims,1,'Exactly one accepted render per fixture request');
                return send({jobs:[state.job]});
            }
            assert.equal(req.headers['x-bitbi-canvas-claim'],claim);
            const source=url.pathname.match(new RegExp(`^${base}/${state.job.id}/source/(\\d+)$`));
            if(source&&req.method==='GET') {
                const bytes=state.inputs[Number(source[1])];assert(bytes);
                state.downloads++;res.writeHead(200);return res.end(bytes);
            }
            const chunks=[];for await(const chunk of req)chunks.push(chunk);
            if(url.pathname===`${base}/${state.job.id}/fail`) {
                state.failures.push(JSON.parse(Buffer.concat(chunks)));return send({recorded:true});
            }
            assert.equal(url.pathname,`${base}/${state.job.id}/complete`);
            const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData();
            const bytes=Buffer.from(await form.get('video').arrayBuffer());
            const receipt={bytes,duration:Number(form.get('duration')),timeline:JSON.parse(form.get('audioTimeline')),report:JSON.parse(form.get('seamResult')||'null')};
            if(url.searchParams.get('part')==='preview-base'){assert(!state.clean);state.clean=receipt;return send({base_stored:true});}
            assert.equal(url.search,'');assert(!state.saved,'Final output is stored exactly once');
            state.saved=receipt;return send({asset_id:state.job.id,status:'preview_pending'});
        } catch(error){serverError||=error;res.writeHead(500);res.end('{}');}
    });
    const decodeVideo=async(file,name)=>{
        const raw=path.join(dir,name+'.rgb');
        await mediaCommand('ffmpeg',['-y','-v','error','-i',file,'-map','0:v:0','-pix_fmt','rgb24','-f','rawvideo',raw]);
        return readFile(raw);
    };
    const marker=(bytes,frame)=>{
        assert(bytes.length>=(frame+1)*frameBytes,'Requested output frame must exist');
        let sum=0,count=0;
        for(let y=32;y<48;y++)for(let x=0;x<width;x++) {
            const p=frame*frameBytes+(y*width+x)*3;
            if(bytes[p]>170&&bytes[p+1]>170&&bytes[p+2]>170){sum+=x;count++;}
        }
        assert(count>60,'Decoded moving marker must be visible');return sum/count;
    };
    const sameFrame=(bytes,frame,source,sourceFrame)=>assert(Math.abs(marker(bytes,frame)-marker(source,sourceFrame))<.8,'Output retains the independently observed source frame');
    const decodeAudio=async(file,name)=>{
        const pcm=path.join(dir,name+'.f32');
        await mediaCommand('ffmpeg',['-y','-v','error','-i',file,'-vn','-ar','48000','-ac','1','-f','f32le',pcm]);return readFile(pcm);
    };
    const amplitude=(pcm,hz,start)=>{
        const offset=Math.round(start*48000),count=1920;assert(pcm.length>=(offset+count)*4);
        let re=0,im=0;for(let i=0;i<count;i++){const value=pcm.readFloatLE((offset+i)*4),angle=2*Math.PI*hz*i/48000;re+=value*Math.cos(angle);im+=value*Math.sin(angle);}
        return 2*Math.hypot(re,im)/count;
    };
    try {
        const files=[],sourceBytes=[],decodedSources=[];
        for(const [index,color] of [[0,[210,20,20]],[1,[20,20,210]]]) {
            const raw=Buffer.alloc(frameBytes*24);
            for(let frame=0;frame<24;frame++) {
                raw.fill(Buffer.from(color),frame*frameBytes,(frame+1)*frameBytes);
                for(let y=32;y<48;y++)for(let x=frame*2+2;x<frame*2+14;x++)raw.fill(245,frame*frameBytes+(y*width+x)*3,frame*frameBytes+(y*width+x+1)*3);
            }
            const input=path.join(dir,`source-${index}.rgb`),file=path.join(dir,`source-${index}.mp4`);
            await writeFile(input,raw);
            await mediaCommand('ffmpeg',['-y','-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-framerate','24','-i',input,
                ...(index===0?['-f','lavfi','-i','sine=frequency=400:sample_rate=48000:duration=1.3']:[]),
                '-c:v','libx264','-threads','1','-crf','18','-pix_fmt','yuv420p',...(index===0?['-c:a','aac']:[]),file]);
            files.push(file);sourceBytes.push(await readFile(file));decodedSources.push(await decodeVideo(file,`decoded-source-${index}`));
            const info=await inspectClip(file);assert.equal(Number(info.video.nb_frames),24);assert.equal(info.videoDuration,1);
            if(index===0)assert(info.duration>1.2,'The audio/container overhang must not authorize nonexistent video frames');
        }
        sameFrame(decodedSources[0],6,decodedSources[0],6);
        assert.throws(()=>sameFrame(decodedSources[0],6,decodedSources[0],7),/independently observed/,'One shifted/repeated frame fails the actual marker oracle');
        const music=path.join(dir,'music.wav');
        await mediaCommand('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=1200:sample_rate=48000:duration=0.35','-ac','2',music]);
        const musicBytes=await readFile(music),sourceAudio=await decodeAudio(files[0],'source-audio');
        const originalAmplitude=amplitude(sourceAudio,400,.3);assert(originalAmplitude>.08);
        server.listen(0,'127.0.0.1');await once(server,'listening');
        const baseUrl=`http://127.0.0.1:${server.address().port}`;
        const requestJson=async(url,init={})=>{
            const response=await fetch(baseUrl+url,{...init,headers:{Authorization:`Bearer ${secret}`,...init.headers},redirect:'error'});
            const body=await response.json();if(!response.ok)throw Object.assign(Error('synthetic_http_failed'),{status:response.status,body});return body;
        };
        const cases=[
            {name:'end-fit',start:.25,duration:1,frames:36,overlap:6,firstSourceFrame:6,lastFirstFrame:17,firstSecondFrame:6},
            {name:'shorter-overlap',start:.75,duration:.75,frames:27,overlap:3,firstSourceFrame:18},
            {name:'minimum-becomes-cut',start:.875,duration:.5,frames:27,overlap:0,firstSourceFrame:21},
            {name:'valid-creative-unchanged',start:.25,duration:.5,frames:30,overlap:6,firstSourceFrame:6,unchanged:true},
            {name:'comparison-retains-fit',start:.25,duration:1,frames:36,overlap:6,firstSourceFrame:6,preview:true},
            {name:'exact-remains-strict',start:.25,duration:1,mode:'exact',error:'canvas_trim_outside_source'},
            {name:'implicit-remains-strict',start:.25,duration:1,mode:null,error:'canvas_trim_outside_source'},
            {name:'recipe-seven-remains-strict',start:.25,duration:1,version:7,error:'canvas_trim_outside_source'},
            {name:'start-at-end',start:1,duration:.5,error:'canvas_trim_outside_source'},
            {name:'start-after-end',start:1.1,duration:.5,error:'canvas_trim_outside_source'},
        ];
        for(const [index,test] of cases.entries()) {
            const id=(index+1).toString(16).repeat(32),target={seconds:3,...(test.mode===null?{}:{mode:test.mode||'creative'})};
            const inputs=[...sourceBytes,musicBytes],clips=[{nodeId:'1'.repeat(32),trim:{start:test.start,duration:test.duration},transition:{preset:'fade',duration:.25}},
                {nodeId:'2'.repeat(32),trim:{start:0,duration:1},transition:{preset:'none'}}];
            state={requests:[],claims:0,downloads:0,failures:[],inputs,job:{id,claim,attempt:1,recipeVersion:test.version||8,
                limits:{sourceBytes:400000000,outputBytes:80000000,durationSeconds:600},spatialPolicy:'center-crop-v1',
                smoothJoins:{policy:'motion-anchors-v1',enabled:false},originalAudioPolicy:'fit-picture-v1',transitionPolicy:'overlap-v1',transitions:[clips[0].transition],
                assembly:{version:1,clips,target},originalAudio:[{enabled:true,gain:.5,fadeIn:0,fadeOut:0},{enabled:true,gain:1,fadeIn:0,fadeOut:0}],
                ...(test.preview?{preview:{seamIndex:0}}:{}),
                backgroundMusic:{enabled:true,gain:.5,fadeIn:.05,fadeOut:.1},sources:inputs.map((bytes,i)=>({url:`${base}/${id}/source/${i}`,size:bytes.length,kind:i===2?'music':'video'}))}};
            const originalJob=structuredClone(state.job);
            await processCanvasExports({requestJson,authHeaders:extra=>({Authorization:`Bearer ${secret}`,...extra}),baseUrl,limit:1});
            process.exitCode=originalExit;
            if(serverError)throw serverError;
            assert.deepEqual(state.job,originalJob,'Rendering never rewrites the accepted creative recipe');
            assert.equal(state.downloads,3);assert.equal(state.claims,1);
            if(test.error){assert.equal(state.failures.length,1);assert.equal(state.failures[0].code,test.error);assert(!state.saved);assert(!state.clean);continue;}
            assert.deepEqual(state.failures,[]);assert(state.saved);assert.equal(Boolean(state.clean),!test.preview);
            const output=path.join(dir,test.name+'.mp4');await writeFile(output,state.saved.bytes);
            const info=await inspectClip(output);assert.equal(Number(info.video.nb_frames),test.frames);assert(Math.abs(info.videoDuration-test.frames/24)<.00001);
            assert.equal(state.saved.duration,info.videoDuration);assert.equal(state.saved.timeline.length,2);
            assert.equal(state.saved.timeline[0].overlap,test.overlap/24);
            const pixels=await decodeVideo(output,test.name);assert.equal(pixels.length,test.frames*frameBytes);
            sameFrame(pixels,0,decodedSources[0],test.firstSourceFrame);sameFrame(pixels,test.frames-1,decodedSources[1],23);
            const fit=state.saved.report.sourceEndFit;
            if(test.unchanged){assert.equal(fit,undefined);assert.equal(state.clean.report,null);}
            else {
                assert.equal(fit.policy,'fit-source-end-v1');assert.equal(fit.frameRate,24);assert.equal(fit.clips.length,1);
                assert.deepEqual(fit.durations,[(24-test.firstSourceFrame)/24,1],'Fit metadata retains full measured windows, including comparison exports');
                assert.deepEqual(fit.clips[0],{index:0,sourceFrames:24,startFrame:test.firstSourceFrame,requestedEndFrame:test.firstSourceFrame+Math.round(test.duration*24),endFrame:24,frameRateNumerator:24,frameRateDenominator:1});
                if(!test.preview)assert.deepEqual(state.clean.report.sourceEndFit,fit,'Both upload boundaries see the same effective source/overlap facts');
                assert.equal(fit.transitions.length,test.overlap===6?0:1);
                if(fit.transitions.length)assert.deepEqual(fit.transitions[0],{index:0,requestedFrames:6,effectiveFrames:test.overlap,requestedPreset:'fade',effectivePreset:test.overlap?'fade':'none'});
            }
            if(test.name==='end-fit') {
                sameFrame(pixels,11,decodedSources[0],test.lastFirstFrame);sameFrame(pixels,18,decodedSources[1],test.firstSecondFrame);
                const pcm=await decodeAudio(output,'mixed'),cleanFile=path.join(dir,'clean.mp4');await writeFile(cleanFile,state.clean.bytes);
                const clean=await decodeAudio(cleanFile,'clean');
                assert(Math.abs(amplitude(pcm,400,.2)/originalAmplitude-.5)<.06,'Original gain survives the fitted window');
                assert(amplitude(pcm,400,1.1)<.001,'The audio-less second source remains free of first-source audio');
                const audible=bytes=>amplitude(bytes,1200,.2)>.025&&amplitude(bytes,1200,1.1)>.025;
                assert(audible(pcm),'Selected music is audible in the actual stored MP4');assert(!audible(clean),'The clean base cannot pass as the mixed final');
            }
        }
        for(const [i,file] of files.entries())assert.deepEqual(await readFile(file),sourceBytes[i],'Source bytes remain untouched');
        console.log('Canvas creative end fit: real claim/source/completion HTTP, measured picture end, unchanged/shortened/cut overlaps, independent source frames and mixed audio, exact/legacy/start rejection passed.');
    } finally {
        process.exitCode=originalExit;server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
        await rm(dir,{recursive:true,force:true});
    }
}
