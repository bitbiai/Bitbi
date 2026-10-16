import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mediaCommand, inspectClip, trimCanvasSources, concatenateClips } from './canvas-full-video.mjs';
import { applyVideoTransitions } from './canvas-transitions.mjs';
import { extractCanvasFrame } from './canvas-media-inspection.mjs';
import { verifyCanvasDuration } from './canvas-assembly-contract.mjs';

export async function testCanvasAssemblyProcessing() {
    const dir=await mkdtemp(path.join(tmpdir(),'canvas-assembly-media-'));
    const limits={durationSeconds:600,outputBytes:80000000},options={run:mediaCommand,ffmpeg:'ffmpeg',ffprobe:'ffprobe',limits};
    try {
        const colors=[[255,0,0],[0,0,255],[0,128,0],[255,255,0],[255,0,255],[0,255,255],[255,165,0],[128,0,128],[255,192,203],[0,255,0],[255,215,0],[0,128,128],[255,255,255]],files=[];
        // A 20x20 dark marker moves seven pixels per source frame. Its 160-frame
        // period distinguishes small accumulated shifts across all twelve joins.
        // Prepare bounded raw fixtures directly: interpreting three geq
        // expressions per pixel dominates the actual AMD64 target's test time.
        for(let i=0;i<colors.length;i++) {
            const file=path.join(dir,`source-${i}.mp4`),rawFile=path.join(dir,`source-${i}.rgb`);files.push(file);
            const frame=Buffer.alloc(160*90*3).fill(Buffer.from(colors[i])),raw=Buffer.alloc(frame.length*240);
            for(let n=0;n<240;n++){
                const offset=n*frame.length;frame.copy(raw,offset);
                for(let y=70;y<90;y++)for(let dx=0;dx<20;dx++){
                    const x=((dx-7*n)%160+160)%160,pixel=offset+(y*160+x)*3;raw[pixel]=raw[pixel+1]=raw[pixel+2]=0;
                }
            }
            await writeFile(rawFile,raw);
            await mediaCommand('ffmpeg',['-y','-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size','160x90','-framerate','24','-i',rawFile,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);
            await rm(rawFile);
        }
        const decodedFrame=async(file,seconds,name,frameIndex)=>{
            const sample=path.join(dir,name+'.rgb');
            await mediaCommand('ffmpeg',['-y','-v','error',...(frameIndex===undefined?['-ss',String(seconds)]:[]),'-i',file,...(frameIndex===undefined?[]:['-vf',`select=eq(n\\,${frameIndex})`]),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',sample]);
            const rgb=await readFile(sample);assert.equal(rgb.length,160*90*3,'An actual complete decoded RGB frame is required');return rgb;
        };
        const frameColor=frame=>{
            const sum=[0,0,0];for(let pixel=0;pixel<frame.length;pixel+=3)for(let channel=0;channel<3;channel++)sum[channel]+=frame[pixel+channel];
            return sum.map(value=>value/(160*90));
        };
        const originalFrames=[];
        for(let i=0;i<files.length;i++)originalFrames.push(await decodedFrame(files[i],2,`original-${i}`,48));
        const originals=originalFrames.map(frameColor);
        const maxChannelError=(a,b)=>Math.max(...a.map((value,channel)=>Math.abs(value-b[channel]))),tolerance=4;
        for(let i=0;i<originals.length;i++)for(let j=i+1;j<originals.length;j++)
            assert(maxChannelError(originals[i],originals[j])>2*tolerance,`Decoded source colors ${i+1} and ${j+1} must distinguish their order`);
        const verifyOrder=samples=>{
            assert.equal(samples.length,13,'Every intended scene must be observed');
            samples.forEach((rgb,i)=>assert(maxChannelError(rgb,originals[i])<=tolerance,`Scene ${i+1} must match its decoded original, within ${tolerance} per RGB channel`));
        };
        verifyOrder(originals);
        const swapped=originals.map(rgb=>[...rgb]);[swapped[10],swapped[11]]=[swapped[11],swapped[10]];
        assert.throws(()=>verifyOrder(swapped),/Scene 11/,'A late-scene swap cannot pass the order oracle');
        assert.throws(()=>verifyOrder([...originals.slice(0,12),originals[0]]),/Scene 13/,'Repeated early footage cannot replace the final scene');
        assert.throws(()=>verifyOrder(originals.slice(0,12)),/Every intended scene/,'Missing observations are not successful verification');
        assert.throws(()=>verifyOrder(originals.map(()=>[0,0,0])),/Scene 1/,'A black artifact cannot pass the decoded source oracle');
        // Compare each channel separately over the marker strip. Averaging all
        // RGB channels together would dilute a shifted green marker's error.
        const markerError=(actual,expected)=>{
            const errors=[0,0,0];for(let pixel=160*70*3;pixel<actual.length;pixel+=3)for(let channel=0;channel<3;channel++)errors[channel]+=Math.abs(actual[pixel+channel]-expected[pixel+channel]);
            return Math.max(...errors.map(value=>value/(160*20)));
        };
        const verifySourceClock=(actual,i)=>assert(markerError(actual,originalFrames[i])<=tolerance,`Scene ${i+1} must retain source frame 48 within ${tolerance} mean error per RGB channel`);
        const codecControl=path.join(dir,'same-frame-codec-control.mp4');
        await mediaCommand('ffmpeg',['-y','-v','error','-ss','2','-i',files[2],'-frames:v','1','-vf','format=gbrp','-c:v','libx264','-threads','1','-crf','18','-pix_fmt','yuv420p',codecControl]);
        const sameFrame=await decodedFrame(codecControl,0,'same-frame-codec-control'),codecError=markerError(sameFrame,originalFrames[2]);
        verifySourceClock(sameFrame,2);
        const shifted=await decodedFrame(files[2],49/24,'one-frame-shifted',49),shiftedError=markerError(shifted,originalFrames[2]);
        assert(shiftedError>2*tolerance,'Decoded one-frame shift must exceed the accepted error by an independent calibration margin');
        assert.throws(()=>verifySourceClock(shifted,2),/Scene 3 must retain source frame/,'One dropped or repeated frame must fail the actual clock oracle');
        const assembly={version:1,clips:files.map((_,i)=>({nodeId:(i+1).toString(16).padStart(32,'0'),trim:{start:0,...(i===12?{duration:6}:{})},transition:{preset:'fade',duration:.5}})),target:{seconds:120}};
        const prepared=await trimCanvasSources(files,assembly,dir,options);
        assert.equal((await inspectClip(prepared[12])).videoDuration,6,'Explicit trim changes real frames, not requested duration');
        let film=await concatenateClips(prepared,dir,{...options,videoClock:true,fitAudio:true,transitions:assembly.clips.slice(0,-1).map(c=>c.transition)});
        film=await applyVideoTransitions(film,assembly.clips.slice(0,-1).map(c=>c.transition),dir,{...options,inspect:inspectClip});
        const measured=await inspectClip(film.output);
        assert.equal(measured.videoDuration,120);assert.equal(Number(measured.video.nb_frames),2880);assert.equal(verifyCanvasDuration(measured.videoDuration,assembly.target).targetSeconds,120);
        const timestamps=JSON.parse(await mediaCommand('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',film.output])).frames;
        assert.equal(timestamps.length,2880,'Every output frame must have an observed timestamp');
        timestamps.forEach((frame,i)=>assert(Math.abs(Number(frame.best_effort_timestamp_time)-i/24)<.00001,'Continuous independently calculated output picture clock'));
        assert.equal(film.timeline.length,13);assert.equal(film.timeline.at(-1).start,114);
        // Independent fixture clock: each 10-second shot advances by 9.5s
        // after the half-second overlap. The final six-second shot starts at
        // 114s. Do not derive observation points from the renderer's timeline.
        const decodedOutput=[];
        for(let i=0;i<files.length;i++)decodedOutput.push(await decodedFrame(film.output,i*9.5+2,`output-${i}`));
        const samples=decodedOutput.map(frameColor);
        verifyOrder(samples);
        decodedOutput.forEach(verifySourceClock);
        // Keep the known-color positive control as well as source comparison.
        for(const [i,channel] of [[0,0],[1,2],[2,1]]) {
            const rgb=samples[i];assert(rgb[channel]>70);assert(rgb[channel]>rgb[(channel+1)%3]+50);assert(rgb[channel]>rgb[(channel+2)%3]+50);
        }
        const short=await concatenateClips(files.slice(0,12),dir,{...options,videoClock:true,fitAudio:true,transitions:assembly.clips.slice(0,11).map(c=>c.transition)});
        const shortFilm=await applyVideoTransitions(short,assembly.clips.slice(0,11).map(c=>c.transition),dir,{...options,inspect:inspectClip});
        const shortMeasured=(await inspectClip(shortFilm.output)).videoDuration;
        assert.equal(shortMeasured,114.5);
        const creative=verifyCanvasDuration(shortMeasured,{seconds:120,mode:'creative'});
        assert.deepEqual(creative,{measuredSeconds:114.5,targetSeconds:120,toleranceSeconds:null,mode:'creative',deviationSeconds:-5.5});
        assert.throws(()=>verifyCanvasDuration(0,{seconds:120,mode:'creative'}),{code:'canvas_duration_invalid'});
        assert.throws(()=>verifyCanvasDuration((shortFilm.duration),assembly.target),{code:'canvas_duration_target_missed'});
        await assert.rejects(trimCanvasSources([files[0]],{version:1,clips:[{nodeId:'1'.repeat(32),trim:{start:9,duration:2}}]},dir,options),{code:'canvas_trim_outside_source'});
        const single=await trimCanvasSources([files[0]],{version:1,clips:[{nodeId:'1'.repeat(32),trim:{start:2,duration:3}}]},dir,options);
        const singleFilm=await concatenateClips(single,dir,{...options,allowSingle:true,videoClock:true,fitAudio:true,transitions:[]});
        assert.equal((await inspectClip(singleFilm.output)).videoDuration,3);
        const frame=await extractCanvasFrame(files[1],dir,{kind:'last'},options);
        assert.equal(frame.metadata.frameTime,239/24);assert.equal(frame.metadata.frames,240);assert.equal(frame.metadata.duration,10);
        const sample=path.join(dir,'frame.rgb');await mediaCommand('ffmpeg',['-y','-v','error','-i',frame.output,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',sample]);
        assert((await readFile(sample))[2]>240,'Extracted private frame contains decoded source pixels');
        const evaluation=await extractCanvasFrame(files[0],dir,{kind:'time',seconds:2},options),jpeg=await readFile(evaluation.output);
        assert.equal(evaluation.mimeType,'image/jpeg');assert(evaluation.metadata.frameWidth<=512&&evaluation.metadata.frameHeight<=512);assert(jpeg.length<=48000);
        assert.equal(evaluation.metadata.width,160,'Evaluation sample keeps separately measured original dimensions');
        await assert.rejects(extractCanvasFrame(files[0],dir,{kind:'time',seconds:11},options),{code:'canvas_inspection_frame_outside_source'});
        console.log('Canvas assembly: real 120-second/2880-frame export, all 13 independently timed decoded sources, order/frame-shift/repeat/black/missing/overlap countercontrols, trims, single clip and private last-frame inspection passed. Source-clock maximum channel error '+Math.max(...decodedOutput.map((frame,i)=>markerError(frame,originalFrames[i]))).toFixed(3)+' (limit '+tolerance+'); same-frame codec control '+codecError.toFixed(3)+'; one-frame shifted control '+shiftedError.toFixed(3)+'.');
    } finally {await rm(dir,{recursive:true,force:true});}
}
