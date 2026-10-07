import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import {workspaceBounds,workspaceSize,validWorkspaceSize} from '../js/shared/canvas-workspace.mjs';
import {TRANSITIONS,transitionSettings,sequenceTransitions,transitionTimeline} from '../js/shared/canvas-transitions.mjs';
test('Canvas workspace geometry uses both extents, handles, variable sizes and negative legacy positions',()=>{
    const a={id:'a',x:2076,y:650,width:230,height:350},bounds=workspaceBounds([a]);assert.equal(bounds.width,2319);assert.equal(bounds.height,1000);
    assert.equal(validWorkspaceSize(2076,1000,bounds),false);assert.equal(validWorkspaceSize(2319,1000,bounds),true);
    assert.equal(workspaceSize({workspace_width:100,workspace_height:100},[a]).height,1000);
    assert.deepEqual(workspaceBounds([]),{left:0,top:0,right:0,bottom:0,width:64,height:64});
    assert.equal(workspaceBounds([{...a,x:-50,y:-20}]).left,-63);assert.equal(workspaceBounds([{...a,x:10,y:10}]).height,360);
    assert.equal(validWorkspaceSize(NaN,100,bounds),false);assert.equal(validWorkspaceSize(100000,100000,bounds),false);
});
test('Canvas transition catalog and per-edge mapping reject unsupported or untrusted parameters',()=>{
    assert.equal(TRANSITIONS.length,14);assert.equal(new Set(TRANSITIONS.map(p=>p.id)).size,14);
    for(const preset of TRANSITIONS){const settings=transitionSettings({preset:preset.id,...(preset.id==='none'?{}:{duration:.5})});assert.equal(settings.preset,preset.id);}
    for(const v of [{preset:'radial'},{preset:'none',filter:'unsafe'},{preset:'fade',duration:3},{preset:'zoom-blur',duration:.4,strength:5}])assert.throws(()=>transitionSettings(v));
    const edges=[{source_node_id:'a',target_node_id:'b',config:{transition:{preset:'fade',duration:.5}}},{source_node_id:'b',target_node_id:'d',config:{transition:{preset:'flash',duration:.5}}}];
    assert.deepEqual(sequenceTransitions([{nodeId:'a'},{nodeId:'b'},{nodeId:'c'}],edges),[{preset:'fade',duration:.5},{preset:'none'}]);
    assert.deepEqual(sequenceTransitions([{nodeId:'b'},{nodeId:'a'}],edges),[{preset:'none'}]);
    assert.equal(fs.readFileSync('js/shared/canvas-transitions.mjs','utf8'),fs.readFileSync('services/homepage-ffmpeg-processor/canvas-transition-contract.mjs','utf8'),'Container contract must be byte-identical');
});
test('Canvas transition timeline subtracts overlap exactly and protects short middle clips',()=>{
    const fade={preset:'fade',duration:.5};const t=transitionTimeline([2,2,2],[fade,fade],24);assert.equal(t.duration,5);assert.deepEqual(t.timeline.map(s=>s.start),[0,1.5,3]);
    assert.throws(()=>transitionTimeline([2,.8,2],[fade,fade],24),{code:'canvas_transition_too_long'});
    const hard=transitionTimeline([2,2],[{preset:'none'}],24);assert.equal(hard.duration,4);
});

test('Canvas native migration checkpoint rejects missing, duplicate and undeclared migrations',async()=>{
    const {verifyNativeMigrationSequence}=await import('./helpers/q2-runtime/environment.mjs');
    const rows=Array.from({length:20},(_,i)=>({path:String(i+84).padStart(4,'0')+'_fixture.sql'})),latest=rows.at(-1).path;
    verifyNativeMigrationSequence(rows,latest);
    for(const altered of [rows.slice(1),rows.slice(0,-1),[...rows,rows.at(-1)],rows.filter((_,i)=>i!==4)])assert.throws(()=>verifyNativeMigrationSequence(altered,latest));
    assert.throws(()=>verifyNativeMigrationSequence(rows,'0102_other.sql'));
});
