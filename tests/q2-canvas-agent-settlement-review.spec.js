const {test,expect}=require('@playwright/test');
const {SqliteD1Database,applyAuthMigrations}=require('./helpers/sqlite-d1.js');
const {createAuthTestEnv}=require('./helpers/auth-worker-harness.js');

for(const name of ['recover','guards','race'])test(`Canvas reviewed invalid plan correction ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try{
        const {canvasPlanCorrectionReviewCase}=await import('./helpers/canvas-agent-plan-correction-review-control.mjs');
        const result=await canvasPlanCorrectionReviewCase({...createAuthTestEnv(),DB},name);
        expect(result.case).toBe(name);expect(result.newPlanningCalls).toBe(name==='recover'?1:0);
        expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    }finally{DB.close();}
});

for(const name of ['recover','guards','crash','active','preflight'])test(`Canvas stored invalid plan interpretation ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try{
        const {canvasPlanInterpretationCase}=await import('./helpers/canvas-agent-plan-interpretation-control.mjs');
        const result=await canvasPlanInterpretationCase({...createAuthTestEnv(),DB},name);
        expect(result.case).toBe(name);expect(result.newPlanningCalls).toBe(name==='preflight'?1:0);
        expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    }finally{DB.close();}
});

for(const name of ['exact','unrelated','concurrent','debit-crash','graph-crash','cancelled','expired','taken-over','edited','invalid-plan','usage-invalid','raw-usage-contract','over-reservation','identity','inert-music-normalization','inert-music-boundary','continuation','continuation-crash','continuation-authority','continuation-evidence','continuation-revalidation'])test(`Canvas stored planning settlement ${name}`,async()=>{
    const DB=new SqliteD1Database();applyAuthMigrations(DB);
    try{
        const {canvasPlanningSettlementCase}=await import('./helpers/canvas-agent-settlement-review-control.mjs');
        const result=await canvasPlanningSettlementCase({...createAuthTestEnv(),DB},name);
        expect(result.case).toBe(name);expect(result.planningCalls).toBe(0);
        expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    }finally{DB.close();}
});

test('Canvas planning settlement review preserves historical tariffs and monetary limits',async()=>{
    const {HISTORICAL_PLANNING_TARIFF}=await import('./helpers/canvas-agent-settlement-review-control.mjs');
    const {calculateCanvasPlanningSettlementReview,settlePinnedModelTariff}=await import('../workers/auth/src/lib/model-tariffs.js');
    const {normalizeCanvasGrokUsage}=await import('../workers/shared/canvas-agent-metering.mjs');
    const usage=normalizeCanvasGrokUsage({prompt_tokens:16076,completion_tokens:2582,total_tokens:33409,
        prompt_tokens_details:{cached_tokens:1152},completion_tokens_details:{reasoning_tokens:14751}});
    const pinned=structuredClone(HISTORICAL_PLANNING_TARIFF),before=structuredClone(pinned);
    expect(()=>settlePinnedModelTariff(pinned,146,{inputToken:16076,outputToken:17333})).toThrow('Actual token usage');
    const reviewed=calculateCanvasPlanningSettlementReview(pinned,146,usage);
    expect(reviewed.credits).toBe(94);expect(reviewed.diagnostics.unusedReservationCredits).toBe(52);
    expect(pinned).toEqual(before);
    for(const invalid of [null,{}, {...usage,output_tokens:16384}, {...usage,cache_read_input_tokens:0},
        {...usage,provider:{...usage.provider,total_tokens:33410}}, {...usage,output_tokens_details:{thinking_tokens:0}}])
        expect(()=>calculateCanvasPlanningSettlementReview(pinned,146,invalid)).toThrow('Stored Canvas metering requires review');
    expect(()=>calculateCanvasPlanningSettlementReview({...pinned,tariff:{...pinned.tariff,key:'xai/grok-4.6:{}'}},146,usage)).toThrow();
    expect(()=>calculateCanvasPlanningSettlementReview({...pinned,canvasGrokAdmission:{version:1}},146,usage)).toThrow();
    const custom={...pinned,credits:139,tariff:{...pinned.tariff,rates:{inputToken:.001,outputToken:.005},source:'custom'}};
    expect(calculateCanvasPlanningSettlementReview(custom,139,usage).credits).toBe(103);
    const expensive={...pinned,tariff:{...pinned.tariff,rates:{inputToken:.001,outputToken:.02},source:'custom'}};
    let exceeded;try{calculateCanvasPlanningSettlementReview(expensive,146,usage);}catch(error){exceeded=error;}
    expect(exceeded).toMatchObject({code:'canvas_agent_settlement_additional_authorization_required',settlementCredits:363,originalReservationCredits:146,additionalCredits:217});
    expect(()=>settlePinnedModelTariff({credits:10,tariff:{key:'minimax/h3:{}',units:{second:4},rates:{second:2}}},10,{second:6})).toThrow();
});

test('Canvas recovered original plan exports real media and remains manually editable without reasoning',async()=>{
    test.setTimeout(90000);
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
    const DB=new SqliteD1Database();applyAuthMigrations(DB);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-settlement-film-'));
    const ffmpeg=args=>execFileSync('ffmpeg',['-v','error','-nostdin',...args]);
    try{
        const {canvasAudioFixture}=await import('./helpers/canvas-audio-control.mjs');
        const {seedCanvasPlanningSettlement}=await import('./helpers/canvas-agent-settlement-review-control.mjs');
        const {finishCanvasAgentFixture,freshCanvasAgentPlan}=await import('./helpers/canvas-agent-control.mjs');
        const {processCanvasExports,inspectClip}=await import('../services/homepage-ffmpeg-processor/canvas-full-video.mjs');
        const {processCanvasInspections}=await import('../services/homepage-ffmpeg-processor/canvas-media-inspection.mjs');
        const {getModelTariff}=await import('../workers/auth/src/lib/model-tariffs.js');
        const videos=[];
        for(const color of ['red','green','blue','yellow']){
            const file=path.join(dir,color+'.mp4');ffmpeg(['-f','lavfi','-i',`color=c=${color}:size=320x180:rate=24:duration=4`,
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',file]);videos.push(fs.readFileSync(file));
        }
        const media=name=>fs.readFileSync(path.join(__dirname,'fixtures/media',name)).toString('base64');
        const f=await canvasAudioFixture({...createAuthTestEnv(),DB},{scope:'settlement-export',videoBase64:videos[0].toString('base64'),
            imageBase64:media('h3-frame.png'),musicBase64:media('member-music.mp3')});
        const oldFetch=f.env.__TEST_FETCH;
        f.env.__TEST_FETCH=(url,init)=>url==='https://fixture.invalid/completion.mp4'
            ?Promise.resolve(new Response(videos[f.calls.length-1],{headers:{'Content-Type':'video/mp4'}})):oldFetch(url,init);
        const c=await seedCanvasPlanningSettlement(f,{scope:'real-export'});
        const recovered=await c.apply();expect(recovered.settlementCredits).toBe(94);expect(recovered.reviewState).toBe('completed');
        const options={baseUrl:'https://bitbi.ai',limit:1,authHeaders:headers=>({Authorization:'Bearer synthetic-audio-processor',...headers}),
            requestJson:async(url,init={})=>{const response=await f.request(url,init.method||'GET',init.body,{Authorization:'Bearer synthetic-audio-processor',...init.headers});
                const body=await response.json();expect(response.ok,JSON.stringify(body)).toBe(true);return body;},fetchImpl:(url,init)=>f.request(url.pathname+url.search,'GET',null,init.headers)};
        const processor=async()=>{await processCanvasInspections(options);await processCanvasExports(options);};
        const finished=await finishCanvasAgentFixture({f,processor,targetSeconds:12,planOverride:freshCanvasAgentPlan(),
            budgetCredits:3893,admittedRunId:c.ids.runId,recoveredPlanning:true});
        expect(finished.plannerCalls).toBe(0);expect(finished.generationCalls).toBe(3);expect(finished.output.storage).toBe('assets');
        const originalBytes=Buffer.from(await(await f.request(finished.output.asset.file_url)).arrayBuffer()),originalFile=path.join(dir,'original.mp4');
        fs.writeFileSync(originalFile,originalBytes);expect((await inspectClip(originalFile)).videoDuration).toBe(12);ffmpeg(['-xerror','-i',originalFile,'-f','null','-']);
        let view=await f.readProject();const first=finished.order[0],removed=finished.order[1],last=finished.order[2];
        expect(view.nodes.filter(node=>finished.order.includes(node.id))).toHaveLength(3);
        const lastAsset=view.nodes.find(node=>node.id===last).assetId||view.nodes.find(node=>node.id===last).output.assetId;
        // Manual work is independent of the assistant and its review approval.
        f.env.CANVAS_AGENT_ENABLED='false';f.env.AI_LAB={fetch(){throw new Error('Manual editing cannot invoke reasoning');}};
        const firstNode=view.nodes.find(node=>node.id===first);
        await f.data(await f.request(`${f.projectPath}/nodes/${first}`,'PATCH',{config:{...firstNode.config,prompt:'A yellow dog-house: intentionally revised clip.'}}));
        const generated=await f.request(`${f.projectPath}/nodes/${first}/run`,'POST',{}, {'Idempotency-Key':'synthetic-manual-recovered-rerun','X-Bitbi-Tariff-Revision':String((await getModelTariff(f.env)).revision)});
        expect(generated.status).toBe(202);await f.deliver();expect(f.calls).toHaveLength(4);
        view=await f.readProject();const assembly={...view.project.assembly,clips:[
            {...view.project.assembly.clips.find(clip=>clip.nodeId===last),transition:{preset:'fade',duration:.5}},
            {...view.project.assembly.clips.find(clip=>clip.nodeId===first),transition:{preset:'none'}}],
            target:{seconds:7.5,toleranceSeconds:.5},musicNodeId:f.music.id,backgroundMusic:{enabled:true,gain:.25,musicAssetId:f.musicId}};
        await f.data(await f.request(f.projectPath+'/assembly','PATCH',{revision:view.project.revision,assembly}));
        await f.data(await f.request(`${f.projectPath}/nodes/${removed}`,'DELETE'));
        view=await f.readProject();expect(view.project.assembly.clips.map(clip=>clip.nodeId)).toEqual([last,first]);expect(view.nodes.some(node=>node.id===removed)).toBe(false);
        expect(view.nodes.find(node=>node.id===last).output.assetId).toBe(lastAsset);expect(f.calls).toHaveLength(4);
        const endpoint=`${f.projectPath}/nodes/${last}/full-video`;
        const admission=await f.data(await f.request(endpoint,'POST',{assemblyRevision:view.project.revision,backgroundMusic:assembly.backgroundMusic}, {'Idempotency-Key':'synthetic-manual-recovered-export'}));
        expect(admission.export.id).not.toBe(finished.output.id);await processor();
        const revised=(await f.data(await f.request(endpoint))).current;
        expect(revised.storage).toBe('assets');expect(revised.duration).toBe(7.5);expect(revised.recipe.assembly.clips.map(clip=>clip.nodeId)).toEqual([last,first]);
        expect(revised.recipe.transitions[0].preset).toBe('fade');expect(revised.recipe.backgroundMusic).toMatchObject({enabled:true,gain:.25});
        const revisedFile=path.join(dir,'revised.mp4');fs.writeFileSync(revisedFile,Buffer.from(await(await f.request(revised.asset.file_url)).arrayBuffer()));
        expect((await inspectClip(revisedFile)).videoDuration).toBe(7.5);ffmpeg(['-xerror','-i',revisedFile,'-f','null','-']);
        const pixel=time=>[...ffmpeg(['-ss',String(time),'-i',revisedFile,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-']).subarray(0,3)];
        const blue=pixel(1),yellow=pixel(5);expect(blue[2]).toBeGreaterThan(180);expect(blue[0]).toBeLessThan(40);expect(yellow[0]).toBeGreaterThan(180);expect(yellow[1]).toBeGreaterThan(180);expect(yellow[2]).toBeLessThan(40);
        expect(Buffer.from(await(await f.request(finished.output.asset.file_url)).arrayBuffer())).toEqual(originalBytes);
        const reopened=await f.readProject();expect(reopened.project.assembly).toEqual(view.project.assembly);expect(f.calls).toHaveLength(4);
        expect((await c.ledger()).map(row=>row.amount)).toEqual([-94]);expect((await c.operation()).reconcile_attempts).toBe(5);
    }finally{DB.close();fs.rmSync(dir,{recursive:true,force:true});}
});
