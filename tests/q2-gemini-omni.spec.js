const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');
const { videoFixture } = require('./helpers/q4-video-jobs');
const id = 'google/gemini-omni-flash';
const load = () => import('../js/shared/gemini-omni-contract.mjs');
const ref = (role, n=0) => ({ role, source: { source_type:'saved_asset', asset_id:'synthetic-asset-'+n } });

test('Omni exact Cloudflare payload preserves ten ordered references and every declared media role without native-only controls', async () => {
    const c=await load(), references=[ref('first_frame'),ref('last_frame'),...Array.from({length:10},(_,i)=>ref('reference_image',i)),ref('reference_video'),ref('reference_audio')];
    for(const resolution of ['360p','720p','1080p','4k'])for(const aspect_ratio of ['16:9','9:16']) {
        const body=c.normalizeOmniRequest({model:id,prompt:'Synthetic instruction with audio.',resolution,aspect_ratio,references});
        const payload=c.buildOmniProviderInput({...body,omni_sources:references.map((r,i)=>({role:r.role,url:`https://bitbi.ai/api/internal/ai/media-source/token-${i}`}))});
        expect(payload).toEqual({text:'Synthetic instruction with audio.',resolution,aspect_ratio,image:'https://bitbi.ai/api/internal/ai/media-source/token-0',last_frame:'https://bitbi.ai/api/internal/ai/media-source/token-1',reference_images:Array.from({length:10},(_,i)=>`https://bitbi.ai/api/internal/ai/media-source/token-${i+2}`),video:'https://bitbi.ai/api/internal/ai/media-source/token-12',audio:'https://bitbi.ai/api/internal/ai/media-source/token-13'});
        expect(body.operation).toBe('edit');
    }
    expect(()=>c.omniReferences(Array.from({length:11},(_,i)=>ref('reference_image',i)))).toThrow(/Too many/);
    for(const key of ['duration','seed','negative_prompt','generate_audio','previous_interaction_id','omni_sources'])expect(()=>c.normalizeOmniRequest({model:id,prompt:'x',[key]:5})).toThrow();
    expect(()=>c.normalizeOmniRequest({model:'google/gemini-omni-1.1-flash',prompt:'x'})).toThrow();
    expect(()=>c.normalizeOmniRequest({model:id,prompt:'x',operation:'text',references:[ref('reference_video')]})).toThrow(/does not match/);
    expect(()=>c.omniReferences([{role:'first_frame',source:{source_type:'url',url:'https://private.invalid'}}])).toThrow();
    const n=c.normalizeOmniRequest({prompt:'x',references:[ref('first_frame')]});
    for(const url of ['https://other.invalid/video','https://bitbi.ai/api/internal/ai/media-source/token?destination=evil','http://bitbi.ai/api/internal/ai/media-source/token'])expect(()=>c.buildOmniProviderInput({...n,omni_sources:[{role:'first_frame',url}]})).toThrow();
});

test('Omni output is strict, keeps explicit interaction identity, and never mistakes a request ID or unknown state for completion', async () => {
    const {parseOmniResult}=await load();
    const video='https://fixture.invalid/output.mp4';
    expect(parseOmniResult({state:'Completed',result:{video},id:'not-an-interaction',gatewayMetadata:{requestId:'also-not'}})).toEqual({video,interactionId:null,providerCostUsd:null,usage:null});
    expect(parseOmniResult({video,interaction_id:'provider-interaction-1'}).interactionId).toBe('provider-interaction-1');
    for(const raw of [{state:'Running',result:{video}},{state:'Failed',video},{result:{prompt:video}},{video:'http://private.invalid/x'},{video:'data:text/html;base64,PHNjcmlwdD4='},{video:'data:video/mp4;base64,####'}])expect(()=>parseOmniResult(raw)).toThrow();
    const bytes=readFileSync('tests/fixtures/media/canvas-preview.mp4'),uri='data:video/mp4;base64,'+bytes.toString('base64');
    const {decodeOmniInlineVideo}=await import('../workers/auth/src/lib/gemini-omni-media.js');
    const decoded=decodeOmniInlineVideo(uri);expect(Buffer.from(decoded.body)).toEqual(bytes);expect(decoded.contentType).toBe('video/mp4');
    expect(()=>decodeOmniInlineVideo('data:video/mp4;base64,'+Buffer.from('not media').toString('base64'))).toThrow(/bytes/);
});

test('Omni manual fixed retail pricing has no guessed factory price, no second margin, and accepted quotes survive tariff changes/reset', async () => {
    const m={...await import('../js/shared/model-pricing-catalog.mjs'),...await import('../workers/auth/src/lib/model-tariffs.js')};
    const DB=new SqliteD1Database();applyAuthMigrations(DB);const env={DB},actor={id:'synthetic-omni-admin'};
    try {
        await DB.prepare('INSERT INTO users(id,email,password_hash,created_at,role) VALUES(?,?,?,?,?)').bind(actor.id,'omni@example.invalid','unused',new Date().toISOString(),'admin').run();
        const {model,price,basis}=m.modelFactoryPrice(id);expect(price.credits).toBe(null);expect(price.providerCostUsd).toBe(null);expect(basis).toEqual({configuration:{resolution:'720p',operation:'text'},units:{request:1}});
        expect(m.modelPricingControls(model).map(field=>field.key)).toEqual(['resolution','operation']);
        await expect(m.pinModelTariff(env,{modelId:id,input:{},credits:1})).rejects.toMatchObject({code:'model_pricing_unavailable'});
        const settings={resolution:'720p',operation:'text'};
        await m.changeModelTariff(env,actor,{modelId:id,revision:0,action:'save',settings,rates:{request:37}});
        const pinned=await m.pinModelTariff(env,{modelId:id,input:settings});expect(pinned.credits).toBe(37);expect(pinned.tariff).toMatchObject({revision:1,units:{request:1},rates:{request:37}});
        await m.changeModelTariff(env,actor,{modelId:id,revision:1,action:'save',settings,rates:{request:64}});
        expect((await m.quoteModelTariff(env,{modelId:id,input:settings})).credits).toBe(64);
        for(const units of [undefined,{request:0},{second:40},{inputToken:20000,outputToken:90000}])expect(m.settlePinnedModelTariff(pinned,9999,units)).toBe(37);
        await m.changeModelTariff(env,actor,{modelId:id,revision:2,action:'reset',settings});
        await expect(m.pinModelTariff(env,{modelId:id,input:settings})).rejects.toMatchObject({code:'model_pricing_unavailable'});
        expect(m.settlePinnedModelTariff(pinned,0)).toBe(37);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM model_pricing_changes').first()).n).toBe(3);
        expect(()=>m.validateModelPricingSettings(model,{duration:5})).toThrow();
        expect((await m.quoteModelTariff(env,{modelId:id,input:{resolution:'4k',operation:'edit'}})).credits).toBe(null);
    } finally {DB.close();}
});

test('Omni readiness fails closed, persists independent Admin test authorization and rejects stale or unproved member activation', async () => {
    const m=await import('../workers/auth/src/lib/gemini-omni-readiness.js');
    const DB=new SqliteD1Database();applyAuthMigrations(DB);const env={DB},actor={id:'synthetic-owner'};
    try {
        await expect(m.assertOmniReady(env,{resolution:'720p',references:[]})).rejects.toMatchObject({code:'omni_capability_disabled'});
        await expect(m.assertOmniReady(env,{}, {adminTest:true})).rejects.toMatchObject({code:'omni_admin_test_disabled'});
        const state=await m.changeOmniReadiness(env,actor,{action:'omni_readiness',revision:0,reason:'Synthetic budget authorization only',config:{adminTestEnabled:true,adminTestCredits:29}});
        expect((await m.assertOmniReady(env,{}, {adminTest:true})).adminTestCredits).toBe(29);
        expect(m.publicOmniReadiness(state)).not.toHaveProperty('adminTestCredits');
        await expect(m.changeOmniReadiness(env,actor,{action:'omni_readiness',revision:0,reason:'Conflicting edit example',config:{adminTestEnabled:false,adminTestCredits:29}})).rejects.toMatchObject({code:'omni_readiness_conflict'});
        await expect(m.changeOmniReadiness(env,actor,{action:'omni_readiness',revision:1,feature:'generation',enabled:true,evidenceJobId:'nonexistent-job',reason:'Cannot invent acceptance evidence'})).rejects.toMatchObject({code:'omni_acceptance_required'});
        expect((await m.getOmniReadiness(env)).enabled.generation).toBe(false);
    }finally{DB.close();}
});

test('Omni actual Admin queue persists inline output, replays without inference, and reserves explicit platform units independently of retail', async () => {
    const c=await load(),bytes=readFileSync('tests/fixtures/media/canvas-preview.mp4');
    const f=await videoFixture(async request=>{
        const sent=await request.json();expect(sent.model).toBe(id);
        return Response.json({ok:true,result:{status:'succeeded',providerState:'Completed',videoUrl:'data:video/mp4;base64,'+bytes.toString('base64'),providerInteractionId:'real-field-in-synthetic-fixture'}});
    },{payload:c.normalizeOmniRequest({model:id,prompt:'Synthetic Omni queue test'}),prepare:async(env,actor)=>{
        const {changeOmniReadiness}=await import('../workers/auth/src/lib/gemini-omni-readiness.js');
        await changeOmniReadiness(env,actor,{action:'omni_readiness',revision:0,reason:'Synthetic test fixture only',config:{adminTestEnabled:true,adminTestCredits:29}});
    }});
    try {
        await f.deliver();const row=await f.row();expect(row.status).toBe('succeeded');expect(row.platform_exposure_units).toBe(29);
        const receipt=JSON.parse(row.provider_result_json);expect((await f.env.DB.prepare('SELECT r2_key FROM r2_cleanup_live_references WHERE r2_key=?').bind(receipt.providerInlineKey).first()).r2_key).toBe(receipt.providerInlineKey);expect(receipt.providerInlineKey).toContain('/provider-');expect(receipt.providerInteractionId).toBe('real-field-in-synthetic-fixture');
        const output=await f.env.USER_IMAGES.get(row.output_r2_key);expect(Buffer.from(await new Response(output.body).arrayBuffer())).toEqual(bytes);
        await f.deliver();expect(f.calls.create).toBe(1);expect(f.calls.poll).toBe(0);expect(f.calls.download).toBe(0);
        const readiness=await import('../workers/auth/src/lib/gemini-omni-readiness.js');
        const change={action:'omni_readiness',revision:1,feature:'generation',enabled:true,evidenceJobId:row.id,reason:'Synthetic accepted base generation'};
        await expect(readiness.changeOmniReadiness(f.env,{id:'other-admin'},change)).rejects.toMatchObject({code:'omni_acceptance_required'});
        await expect(readiness.changeOmniReadiness(f.env,{id:'q4-video-admin'},{...change,feature:'audio_reference'})).rejects.toMatchObject({code:'omni_acceptance_required'});
        await readiness.changeOmniReadiness(f.env,{id:'q4-video-admin'},change);
        await readiness.changeOmniReadiness(f.env,{id:'q4-video-admin'},{...change,revision:2,feature:'720p'});
        await expect(readiness.assertOmniReady(f.env,{resolution:'720p',references:[]})).resolves.toMatchObject({revision:3});
        await readiness.changeOmniReadiness(f.env,{id:'q4-video-admin'},{...change,revision:3,enabled:false});
        await expect(readiness.assertOmniReady(f.env,{resolution:'720p',references:[]})).rejects.toMatchObject({code:'omni_capability_disabled'});

    }finally{f.db.close();}
});


test('Omni actual AI service adapter uses the exact binding, disables Gateway logging/cache and rejects unknown outcomes without retries', async()=>{
    const {createVideoProviderTask}=await import('../workers/ai/src/lib/invoke-ai-video.js');
    const {resolveAdminAiModelSelection}=await import('../js/shared/admin-ai-contract.mjs');
    const c=await load(),input={...c.normalizeOmniRequest({prompt:'Synthetic service test'}),omni_sources:[]},model=resolveAdminAiModelSelection('video',{model:id}).model;
    let calls=0,raw={state:'Completed',result:{video:'https://fixture.invalid/stored.mp4'}};
    const env={AI:{async run(actual,payload,options){calls++;expect(actual).toBe(id);expect(payload).toEqual({text:'Synthetic service test',resolution:'720p',aspect_ratio:'16:9'});expect(options.gateway).toMatchObject({id:'default',skipCache:true,collectLog:false});return raw;}}};
    const result=await createVideoProviderTask(env,model,input);expect(result.status).toBe('succeeded');expect(result.providerTaskId).toBe(null);expect(calls).toBe(1);
    raw={state:'Running',result:{video:'https://fixture.invalid/unconfirmed.mp4'}};
    await expect(createVideoProviderTask(env,model,input)).rejects.toMatchObject({code:'omni_outcome_unconfirmed'});expect(calls).toBe(2);
});


test('Omni deactivation after Admin admission blocks queued inference without bypassing the platform budget',async()=>{
 const c=await load(),m=await import('../workers/auth/src/lib/gemini-omni-readiness.js');
 const f=await videoFixture(()=>{throw Error('Disabled inference must never run');},{payload:c.normalizeOmniRequest({prompt:'Synthetic queued request'}),prepare:(env,actor)=>m.changeOmniReadiness(env,actor,{action:'omni_readiness',revision:0,reason:'Synthetic test fixture authorization',config:{adminTestEnabled:true,adminTestCredits:29}})});
 try {
  await m.changeOmniReadiness(f.env,{id:'q4-video-admin'},{action:'omni_readiness',revision:1,reason:'Synthetic explicit test deactivation',config:{adminTestEnabled:false,adminTestCredits:29}});
  await f.deliver();expect(f.calls.create).toBe(0);expect((await f.row()).status).toBe('failed');expect((await f.usage()).count).toBe(0);
 }finally{f.db.close();}
});
