import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canvasAssembly, canvasAssemblyTiming, verifyCanvasDuration } from '../js/shared/canvas-assembly.mjs';
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
