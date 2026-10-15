import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
        const colors=['red','blue','green','yellow','magenta','cyan','orange','purple','pink','lime','gold','teal','white'],files=[];
        for(let i=0;i<colors.length;i++) {
            const file=path.join(dir,`source-${i}.mp4`);files.push(file);
            await mediaCommand('ffmpeg',['-y','-v','error','-f','lavfi','-i',`color=c=${colors[i]}:s=160x90:r=24:d=10`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',file]);
        }
        const assembly={version:1,clips:files.map((_,i)=>({nodeId:(i+1).toString(16).padStart(32,'0'),trim:{start:0,...(i===12?{duration:6}:{})},transition:{preset:'fade',duration:.5}})),target:{seconds:120}};
        const prepared=await trimCanvasSources(files,assembly,dir,options);
        assert.equal((await inspectClip(prepared[12])).videoDuration,6,'Explicit trim changes real frames, not requested duration');
        let film=await concatenateClips(prepared,dir,{...options,videoClock:true,fitAudio:true,transitions:assembly.clips.slice(0,-1).map(c=>c.transition)});
        film=await applyVideoTransitions(film,assembly.clips.slice(0,-1).map(c=>c.transition),dir,{...options,inspect:inspectClip});
        const measured=await inspectClip(film.output);
        assert.equal(measured.videoDuration,120);assert.equal(Number(measured.video.nb_frames),2880);assert.equal(verifyCanvasDuration(measured.videoDuration,assembly.target).targetSeconds,120);
        assert.equal(film.timeline.length,13);assert.equal(film.timeline.at(-1).start,114);
        // Decode actual output away from seams. A reversed/missing source or a
        // fabricated all-black artifact fails independent of recipe metadata.
        for(const [i,channel] of [[0,0],[1,2],[2,1]]) {
            const sample=path.join(dir,`sample-${i}.rgb`);
            await mediaCommand('ffmpeg',['-y','-v','error','-ss',String(film.timeline[i].start+2),'-i',film.output,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',sample]);
            const rgb=await readFile(sample);assert(rgb[channel]>70);assert(rgb[channel]>rgb[(channel+1)%3]+50);assert(rgb[channel]>rgb[(channel+2)%3]+50);
        }
        const short=await concatenateClips(files.slice(0,12),dir,{...options,videoClock:true,fitAudio:true,transitions:assembly.clips.slice(0,11).map(c=>c.transition)});
        const shortFilm=await applyVideoTransitions(short,assembly.clips.slice(0,11).map(c=>c.transition),dir,{...options,inspect:inspectClip});
        assert.equal((await inspectClip(shortFilm.output)).videoDuration,114.5);
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
        console.log('Canvas assembly: real 120-second/2880-frame export, overlap shortfall broken control, ordered decoded colors, trims, single clip and private last-frame inspection passed.');
    } finally {await rm(dir,{recursive:true,force:true});}
}
