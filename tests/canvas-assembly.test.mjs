import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canvasAssembly, canvasAssemblyTiming, verifyCanvasDuration, resolveCanvasTrimFrames, fitCanvasCreativeTransitions } from '../js/shared/canvas-assembly.mjs';
const id = n => n.toString(16).padStart(32, '0');
test('Assembly validates editable settings without trusting URLs, filters or duplicate node identities', () => {
    const assembly = canvasAssembly({ version: 1, clips: [{ nodeId: id(1) }], target: { seconds: 120 } });
    assert.deepEqual(assembly.clips[0], { nodeId: id(1), trim: { start: 0 }, transition: { preset: 'none' } });
    for (const invalid of [
        { ...assembly, backgroundMusic: { enabled:true,gain:3 } },
        { ...assembly, smoothJoins:'yes' },
        { ...assembly, musicNodeId:'https://untrusted.invalid' },
        { ...assembly, url: 'https://untrusted.invalid' },
        { ...assembly, clips: [...assembly.clips, ...assembly.clips] },
        { ...assembly, clips: [{ nodeId: id(1), trim: { start: -1 } }] },
        { ...assembly, clips: [{ nodeId: id(1), transition: { preset: 'fade', duration: .5, filter: 'movie=evil' } }] },
        { ...assembly, target: { seconds: 120, toleranceSeconds: 10 } },
    ]) assert.throws(() => canvasAssembly(invalid));
});
test('Two-minute assembly subtracts every overlap and cannot pass an actually short output', () => {
    const clips = Array.from({ length: 12 }, (_, i) => ({ nodeId: id(i + 1), transition: { preset: 'fade', duration: .5 } }));
    const short = canvasAssemblyTiming({ version: 1, clips, target: { seconds: 120 } }, Array(12).fill(10), 24);
    assert.equal(short.duration, 114.5);
    assert.throws(() => verifyCanvasDuration(short.duration, { seconds: 120 }), { code: 'canvas_duration_target_missed' });
    const complete = canvasAssemblyTiming({ version: 1, clips: [...clips, { nodeId: id(13), trim: { start: 0, duration: 6 } }], target: { seconds: 120 } }, Array(13).fill(10), 24);
    assert.equal(complete.duration, 120);
    assert.equal(verifyCanvasDuration(120.04, { seconds: 120 }).toleranceSeconds, .5);
    assert.throws(() => canvasAssemblyTiming({ version: 1, clips: [{ nodeId: id(1), trim: { start: 9, duration: 2 } }] }, [10], 24), { code: 'canvas_trim_outside_source' });
});
test('Removing a middle clip and reordering assembly changes only playback data', () => {
    const graph = { nodes: [id(1), id(2), id(3)], edges: [[id(1), id(2)], [id(2), id(3)]] };
    const original = JSON.stringify(graph), assembly = canvasAssembly({ version: 1, clips: graph.nodes.map(nodeId => ({ nodeId })) });
    assembly.clips.splice(1, 1); assembly.clips.reverse(); assembly.clips[0].transition = { preset: 'fade', duration: .5 };
    assert.deepEqual(canvasAssembly(assembly).clips.map(c => c.nodeId), [id(3), id(1)]);
    assert.equal(JSON.stringify(graph), original);
    assert.equal(canvasAssemblyTiming(assembly, [10, 10], 24).duration, 19.5);
});
test('Private processor assembly contract matches the shared editor/server contract', async () => {
    const shared = await readFile(new URL('../js/shared/canvas-assembly.mjs', import.meta.url), 'utf8');
    const processor = await readFile(new URL('../services/homepage-ffmpeg-processor/canvas-assembly-contract.mjs', import.meta.url), 'utf8');
    assert.equal(await readFile(new URL('../services/homepage-ffmpeg-processor/canvas-export-contract.mjs', import.meta.url),'utf8'), await readFile(new URL('../js/shared/canvas-export.mjs',import.meta.url),'utf8'));
    assert.equal(processor, shared.replace("'./canvas-transitions.mjs'", "'./canvas-transition-contract.mjs'").replace("'./canvas-export.mjs'", "'./canvas-export-contract.mjs'"));
});

test('Creative duration reports actual media without replacing technical or legacy exact checks', () => {
    const target={seconds:40,mode:'creative'};
    for(const seconds of [38,39,41,42,36,44]) {
        const result=verifyCanvasDuration(seconds,target);
        assert.equal(result.measuredSeconds,seconds);assert.equal(result.targetSeconds,40);
        assert.equal(result.mode,'creative');assert.equal(result.toleranceSeconds,null);
        assert.equal(result.deviationSeconds,seconds-40);
    }
    assert.throws(()=>verifyCanvasDuration(38,{seconds:40}),{code:'canvas_duration_target_missed'});
    assert.throws(()=>verifyCanvasDuration(42,{seconds:40,mode:'exact'}),{code:'canvas_duration_target_missed'});
    for(const invalid of [0,-1,NaN,Infinity,601])assert.throws(()=>verifyCanvasDuration(invalid,target),{code:'canvas_duration_invalid'});
    for(const mode of ['approximate','ignore',true])assert.throws(()=>canvasAssembly({version:1,clips:[],target:{...target,mode}}),{code:'canvas_duration_target_invalid'});
    const assembly=canvasAssembly({version:1,clips:[{nodeId:id(1),trim:{start:0,duration:4}},{nodeId:id(2),trim:{start:0,duration:4}}],target});
    assert.deepEqual(assembly.target,target);
    assert.equal(canvasAssemblyTiming(assembly,[4,4],24).duration,8);
    assert.equal(canvasAssemblyTiming(assembly,[3,4],24).duration,7);
    assert.throws(()=>canvasAssemblyTiming({...assembly,target:{seconds:40}},[3,4],24),{code:'canvas_trim_outside_source'});
});

test('Creative frame intervals fit only the requested end and retain end-exclusive source evidence', () => {
    const source={frameRateNumerator:25,frameRateDenominator:1,sourceFrames:370};
    const fit=resolveCanvasTrimFrames({...source,start:0,duration:15,creative:true});
    assert.equal(fit.durationSeconds,14.8);
    assert.equal(fit.endFrame,370);assert.equal(fit.requestedEndFrame,375);
    assert.deepEqual(fit.fit,{...source,startFrame:0,requestedEndFrame:375,endFrame:370});
    assert.throws(()=>resolveCanvasTrimFrames({...source,start:0,duration:15}),{code:'canvas_trim_outside_source'});
    const selected=resolveCanvasTrimFrames({...source,start:2,duration:3,creative:true});
    assert.equal(selected.startFrame,50);assert.equal(selected.endFrame,125);assert.equal(selected.durationSeconds,3);assert.equal(selected.fit,null);
    const remainder=resolveCanvasTrimFrames({...source,start:2,creative:true});
    assert.equal(remainder.startFrame,50);assert.equal(remainder.endFrame,370);assert.equal(remainder.durationSeconds,12.8);assert.equal(remainder.fit,null);
    assert.equal(resolveCanvasTrimFrames({...source,start:14.76,duration:.1,creative:true}).durationSeconds,1/25);
    for(const start of [14.8,15])assert.throws(()=>resolveCanvasTrimFrames({...source,start,duration:.1,creative:true}),{code:'canvas_trim_outside_source'});
});

test('Fractional picture clocks and one-frame sources do not add an end frame or hide invalid timing', () => {
    const source={frameRateNumerator:30000,frameRateDenominator:1001,sourceFrames:30};
    const fitted=resolveCanvasTrimFrames({...source,start:0,duration:2,creative:true});
    assert.equal(fitted.endFrame,30);assert.equal(fitted.durationSeconds,1.001);
    assert.equal(resolveCanvasTrimFrames({...source,start:0,duration:1.001,creative:true}).fit,null);
    assert.equal(resolveCanvasTrimFrames({...source,start:.968,duration:.1,creative:true}).startFrame,29);
    assert.equal(resolveCanvasTrimFrames({...source,start:.968,duration:.1,creative:true}).durationSeconds,1001/30000);
    const single=resolveCanvasTrimFrames({...source,sourceFrames:1,start:0,duration:.1,creative:true});
    assert.equal(single.endFrame-single.startFrame,1);
    for(const changed of [{sourceFrames:0},{sourceFrames:NaN},{sourceFrames:1.5},{frameRateDenominator:0},{frameRateNumerator:Infinity}])
        assert.throws(()=>resolveCanvasTrimFrames({...source,...changed,start:0,duration:.1,creative:true}),{code:'canvas_media_timing_invalid'});
    for(const start of [-1,NaN])assert.throws(()=>resolveCanvasTrimFrames({...source,start,creative:true}),{code:'canvas_trim_invalid'});
    assert.throws(()=>resolveCanvasTrimFrames({...source,start:0,duration:0,creative:true}),{code:'canvas_trim_invalid'});
});

test('Creative fitting changes only affected infeasible joins and retains existing transition limits', () => {
    const fade={preset:'fade',duration:.5},requested=[fade,fade],before=JSON.stringify(requested);
    const fitted=fitCanvasCreativeTransitions([1,.5,1],requested,24,[1]);
    assert.deepEqual(fitted.adjustments,[
        {index:0,requestedFrames:12,effectiveFrames:6,requestedPreset:'fade',effectivePreset:'fade'},
        {index:1,requestedFrames:12,effectiveFrames:5,requestedPreset:'fade',effectivePreset:'fade'},
    ]);
    assert.equal(JSON.stringify(requested),before);
    assert.equal(fitCanvasCreativeTransitions([1,1],[{preset:'fade',duration:.25}],24,[0]).adjustments.length,0);
    const cut=fitCanvasCreativeTransitions([1/24,1],[fade],24,[0]);
    assert.deepEqual(cut.transitions,[{preset:'none'}]);assert.equal(cut.adjustments[0].effectiveFrames,0);
    assert.throws(()=>fitCanvasCreativeTransitions([1,.1,1,1],[fade,fade,fade],24,[3]),{code:'canvas_transition_too_long'},
        'An unrelated invalid overlap is not authorized by an adjustment elsewhere');
    assert.throws(()=>fitCanvasCreativeTransitions([1,0],[fade],24,[1]),{code:'canvas_media_timing_invalid'});
});

test('Assembly uses available creative frames while exact and legacy source and overlap checks stay strict', () => {
    const clips=[{nodeId:id(1),trim:{start:.25,duration:1},transition:{preset:'fade',duration:.5}},{nodeId:id(2)}];
    const assembly={version:1,clips,target:{seconds:4,mode:'creative'}};
    const result=canvasAssemblyTiming(assembly,[.75,1],24);
    assert.equal(result.duration,1.25);assert.equal(result.timeline[0].duration,.5);assert.equal(result.overlaps[0],.25);
    for(const target of [undefined,{seconds:4},{seconds:4,mode:'exact'}])
        assert.throws(()=>canvasAssemblyTiming({...assembly,target},[.75,1],24),{code:'canvas_trim_outside_source'});
    assert.throws(()=>canvasAssemblyTiming(assembly,[.25,1],24),{code:'canvas_trim_outside_source'});
    for(const missing of [NaN,0,Infinity])
        assert.throws(()=>canvasAssemblyTiming(assembly,[missing,1],24),{code:'canvas_media_timing_invalid'});
});
