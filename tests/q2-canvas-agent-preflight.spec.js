const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');

test('Canvas executable preflight rejects actual H3 combinations, repairs safely and runs an editable graph normally',async()=>{
    const fs=require('node:fs'),path=require('node:path'),DB=new SqliteD1Database();applyAuthMigrations(DB);
    const media=Object.fromEntries([['videoBase64','canvas-end-frame.mp4'],['imageBase64','h3-frame.png'],['musicBase64','member-music.mp3']].map(([key,name])=>[key,fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64')]));
    try{
        const {canvasAgentPreflightCase}=await import('./helpers/canvas-agent-preflight-control.mjs');
        expect(await canvasAgentPreflightCase({...createAuthTestEnv(),DB},media)).toEqual({mixedRejected:true,extractedFrameRejected:true,technicalDefaultRepaired:true,creativeRepairPreservedReferences:true,editableGraph:true,syntheticProviderCalls:2,measuredTargetMode:'creative',versionedCreativeExport:true,savedCreativeOutput:true,importedReferences:true,persistedReferenceOrder:true});
        expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    }finally{DB.close();}
});
test('Canvas duration admission requires a stated length or explicit delegation and a hard credit cap',async()=>{
    const {normalizeCanvasAgentStart,resolveCanvasAgentDuration}=await import('../js/shared/canvas-agent-contract.mjs');
    const input={brief:'Build a house with ducks nearby.',budgetCredits:3000,expectedRevision:0};
    expect(normalizeCanvasAgentStart(input).duration).toBeNull();
    expect(normalizeCanvasAgentStart({...input,durationChoice:'automatic'}).duration).toBeNull();
    expect(normalizeCanvasAgentStart(input,{durationAsked:true}).duration).toBeNull();
    expect(normalizeCanvasAgentStart({...input,durationChoice:'delegated'}).duration).toEqual({targetDurationSeconds:null,durationChoice:'delegated'});
    expect(normalizeCanvasAgentStart({...input,brief:'Make a film about 40 seconds long.'}).duration.targetDurationSeconds).toBe(40);
    expect(normalizeCanvasAgentStart({...input,targetDurationSeconds:120}).duration.targetDurationSeconds).toBe(120);
    expect(()=>normalizeCanvasAgentStart({...input,budgetCredits:null})).toThrow('canvas_agent_budget_required');
    for(const targetDurationSeconds of [0,181,Infinity,-3])expect(()=>resolveCanvasAgentDuration({targetDurationSeconds})).toThrow('canvas_agent_duration_invalid');
    expect(()=>normalizeCanvasAgentStart({...input,budgetCredits:100001})).toThrow('canvas_agent_budget_required');
});
