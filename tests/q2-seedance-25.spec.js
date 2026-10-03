const { test, expect } = require('@playwright/test');
const contract = () => import('../js/shared/seedance-25-contract.mjs');
const reference = (role, index = 0) => ({ role, source: { source_type: 'saved_asset', asset_id: `${role}_${index}` } });

test('Seedance 2.5 accepts documented boundaries and rejects inherited or invented controls', async () => {
    const c = await contract();
    expect(c.normalizeSeedance25Request({ prompt: 'A scene' })).toEqual({ model: 'bytedance/seedance-2.5', preset: 'video_seedance_25', prompt: 'A scene', references: [], workflow: 'generate', duration: 5, resolution: '720p', aspect_ratio: 'adaptive', fps: 24, camera_fixed: false, watermark: false, output_format: 'mp4', use_virtual_avatar: false });
    for (const duration of [-1, 4, 12, 13, 30]) expect(c.normalizeSeedance25Request({ prompt: 'Scene', duration }).duration).toBe(duration);
    for (const duration of [-2, 0, 3, 31, 4.5, '5']) expect(() => c.normalizeSeedance25Request({ prompt: 'Scene', duration })).toThrow();
    for (const field of [{ mode: 'edit' }, { duration_ms: 5000 }, { fps: 30 }, { seed: 2 ** 53 }, { output_format: 'webm' }, { resolution: '1080p' }, { generate_audio: 1 }]) expect(() => c.normalizeSeedance25Request({ prompt: 'Scene', ...field })).toThrow();
    expect(c.normalizeSeedance25Request({ prompt: 'x'.repeat(2000), seed: -Number.MAX_SAFE_INTEGER }).seed).toBe(-Number.MAX_SAFE_INTEGER);
    expect(() => c.normalizeSeedance25Request({ prompt: 'x'.repeat(2001) })).toThrow();
    expect(() => c.normalizeSeedance25Request({ prompt: '  ' })).toThrow();
    expect(c.normalizeSeedance25Request({ references: [reference('reference_audio')] }).prompt).toBe('');
    expect(c.normalizeSeedance25Request({ references: [reference('first_frame'), reference('last_frame')], aspect_ratio: '21:9' }).aspect_ratio).toBe('adaptive');
    expect(() => c.normalizeSeedance25Request({ references: [reference('last_frame')] })).toThrow(/first frame/);
    expect(c.normalizeSeedance25Request({ references: [reference('reference_video')], duration: 4 }).duration).toBe(4);
    expect(c.normalizeSeedance25Request({ references: [reference('reference_video')], workflow: 'edit', duration: -1 }).duration).toBe(-1);
    expect(() => c.normalizeSeedance25Request({ references: [reference('reference_video')], workflow: 'edit' })).toThrow(/Auto/);
    expect(() => c.normalizeSeedance25Request({ prompt: 'extend', workflow: 'extend' })).toThrow(/video/);
});

test('Seedance 2.5 preserves all 52 ordered input roles, measures aggregate time and serializes only actual schema fields', async () => {
    const c = await contract();
    const references = ['first_frame', 'last_frame'].map(role => reference(role));
    for (const [role, count] of [['reference_image', 30], ['reference_video', 10], ['reference_audio', 10]]) references.push(...Array.from({ length: count }, (_, index) => reference(role, index)));
    const input = c.normalizeSeedance25Request({ references, duration: -1, workflow: 'edit', output_format: 'mov', generate_audio: true, use_virtual_avatar: true });
    expect(input.references).toEqual(references);
    const seedance25_sources = references.map((ref, index) => ({ role: ref.role, url: `https://bitbi.ai/api/internal/ai/media-source/test-${index}` }));
    const payload = c.buildSeedance25ProviderInput({ ...input, seedance25_sources });
    expect(Object.keys(payload).sort()).toEqual(['aspect_ratio', 'camera_fixed', 'duration', 'fps', 'generate_audio', 'image', 'last_frame_image', 'output_format', 'reference_audios', 'reference_images', 'reference_videos', 'resolution', 'use_virtual_avatar', 'watermark'].sort());
    expect(payload.reference_images).toEqual(Array.from({ length: 30 }, (_, i) => `https://bitbi.ai/api/internal/ai/media-source/test-${i + 2}`));
    expect(payload.reference_videos).toHaveLength(10); expect(payload.reference_audios).toHaveLength(10);
    expect(payload.image).toBe('https://bitbi.ai/api/internal/ai/media-source/test-0');
    const durations = references.map(ref => c.seedance25MediaType(ref.role) === 'image' ? null : 3);
    expect(c.validateSeedance25ReferenceDurations(references, durations)).toEqual({ video: 30, audio: 30 });
    for (const index of [32, 42]) { const broken = [...durations]; broken[index] += 0.001; expect(() => c.validateSeedance25ReferenceDurations(references, broken)).toThrow(/30 seconds/); }
    for (const role of c.SEEDANCE_25_ROLES) expect(() => c.seedance25References(Array.from({ length: c.SEEDANCE_25_REFERENCE_LIMITS[role] + 1 }, (_, i) => reference(role, i)))).toThrow();
    expect(() => c.buildSeedance25ProviderInput({ ...input, seedance25_sources: seedance25_sources.slice(1) })).toThrow();
    const wrongOrder = [...seedance25_sources]; [wrongOrder[0], wrongOrder[32]] = [wrongOrder[32], wrongOrder[0]];
    expect(() => c.buildSeedance25ProviderInput({ ...input, seedance25_sources: wrongOrder })).toThrow();
    expect(() => c.buildSeedance25ProviderInput({ ...input, seedance25_sources: seedance25_sources.map(source => ({ ...source, url: 'https://attacker.invalid/file' })) })).toThrow();
});

test('Seedance 2.5 four supplied rates use one funding fee, a margin and final rounding; the owner custom rule reserves a bounded amount and never invents provider usage', async () => {
    const p = await import('../js/shared/seedance-25-pricing.mjs');
    const t = await import('../js/shared/model-tariff.mjs');
    const credits = await import('../js/shared/model-credit-pricing.mjs');
    const keys = new Set();
    for (const [resolution, video, rate] of [['480p', false, 0.1028], ['480p', true, 0.4304], ['720p', false, 0.2312], ['720p', true, 0.9676]]) {
        const input = { duration: 5, resolution, references: video ? [reference('reference_video')] : [] };
        const price = p.seedance25FactoryPrice(input, 5), basis = t.mediaTariffBasis(price, 'video', input), key = t.tariffKey(price.modelId, basis.configuration);
        keys.add(key);
        expect(price.providerCostUsd).toBeCloseTo(5 * rate * 1.05, 10);
        expect(price.credits).toBe(Math.ceil(5 * rate * 1.05 / 0.8 * 0.855176 / credits.BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING));
        expect(basis.units).toEqual({ second: 5 });
        expect(t.applyModelTariff(price, { revision: 3, rules: { [key]: { rates: { second: 2.01 } } } }, basis).credits).toBe(11);
        const auto = p.seedance25FactoryPrice({ ...input, duration: -1 });
        expect(auto.formula).toMatchObject({ auto: true, outputSeconds: 30, pricingStatus: 'owner_custom_output_duration' });
        expect(t.mediaTariffBasis(auto, 'video').units.second).toBe(30);
        expect(auto.credits).toBe(Math.ceil(30 * rate * 1.05 / 0.8 * 0.855176 / credits.BITBI_NET_EUR_PER_CREDIT_FOR_MODEL_PRICING));
        expect(auto.formula.providerMeteringVerified).toBe(false);
    }
    expect(keys.size).toBe(4);
    expect(p.seedance25FactoryPrice({ inputTier: 'video' }).normalized.inputTier).toBe('non_video');
});

test('Seedance 2.5 Completed is a URL receipt, never fabricated usage or a recovered pending result', async () => {
    const c = await contract();
    expect(c.parseSeedance25Result({ state: 'Completed', result: { video: 'https://example.com/original.mov' } })).toEqual({ video: 'https://example.com/original.mov', usage: null, providerCostUsd: null });
    for (const value of [{ state: 'Pending', result: { video: 'https://example.com/stale.mp4' } }, { state: 'Completed', result: { prompt: 'https://example.com/not-output.mp4' } }, { video: 'http://example.com/file' }]) expect(() => c.parseSeedance25Result(value)).toThrow();
});

test('Seedance 2.5 migration seeds audited custom configurations, pins quotes and rejects stale edits or missing settlement', async () => {
    const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');
    const m = await import('../workers/auth/src/lib/model-tariffs.js');
    const p = await import('../js/shared/seedance-25-pricing.mjs');
    const DB = new SqliteD1Database(); applyAuthMigrations(DB);
    try {
        const env = { DB }, snapshot = await m.getModelTariff(env), modelId = 'bytedance/seedance-2.5';
        expect(snapshot.rules).toMatchObject(p.seedance25InitialTariffRules());
        expect((await DB.prepare("SELECT actor_user_id,model_id,action FROM model_pricing_changes WHERE change_id='seedance-25-custom-output-duration-2026-10-03'").first())).toEqual({ actor_user_id: 'owner-authorized-release', model_id: modelId, action: 'save' });
        const input = { duration: -1, resolution: '480p', references: [reference('reference_video')] };
        const pinned = await m.pinModelTariff(env, { modelId, input });
        expect(pinned.tariff).toMatchObject({ source: 'custom', configuration: { inputTier: 'video', resolution: '480p' }, units: { second: 30 } });
        const expected = Math.ceil(6.125 * pinned.tariff.rates.second);
        expect(m.settlePinnedModelTariff(pinned, 0, { second: 6.125 })).toBe(expected);
        for (const units of [undefined, {}, { second: 0 }, { second: -1 }, { second: 30.001 }, { second: 5, request: 1 }]) expect(() => m.settlePinnedModelTariff(pinned, 0, units)).toThrow(/review/);
        const change = { modelId, settings: { resolution: '480p', inputTier: 'video' }, action: 'save', rates: { second: 2 }, revision: snapshot.revision };
        await m.changeModelTariff(env, { id: 'synthetic-admin' }, change);
        await expect(m.changeModelTariff(env, { id: 'synthetic-admin' }, change)).rejects.toMatchObject({ code: 'model_pricing_conflict' });
        expect(m.settlePinnedModelTariff(pinned, 0, { second: 6.125 })).toBe(expected);
        const updated = await m.pinModelTariff(env, { modelId, input }); expect(updated.credits).toBe(60);
        expect(m.settlePinnedModelTariff(updated, 0, { second: 6.125 })).toBe(13);
        expect((await m.pinModelTariff(env, { modelId, input: { ...input, references: [] } })).credits).not.toBe(60);
    } finally { DB.close(); }
});

test('Seedance 2.5 actual Admin queue stores original MP4, settles measured duration and replays without another inference', async () => {
    const { videoFixture } = require('./helpers/q4-video-jobs');
    const { readFileSync } = require('node:fs');
    const { pathToFileURL } = require('node:url');
    const c = await contract(), bytes = readFileSync(new URL('./fixtures/media/canvas-preview.mp4', pathToFileURL(__filename)));
    const f = await videoFixture(async request => {
        const body = await request.json(); expect(body).toMatchObject({ model: 'bytedance/seedance-2.5', duration: -1, output_format: 'mp4' });
        return Response.json({ ok: true, result: { status: 'succeeded', providerState: 'Completed', videoUrl: 'https://fixture.invalid/seedance-output.mp4' } });
    }, { payload: c.normalizeSeedance25Request({ prompt: 'Synthetic video', duration: -1 }), download: async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }) });
    try {
        await f.deliver(); const row = await f.row();
        expect(row.status).toBe('succeeded');
        const saved = await f.env.USER_IMAGES.get(row.output_r2_key); expect(Buffer.from(await new Response(saved.body).arrayBuffer())).toEqual(bytes);
        const usage = await f.db.prepare('SELECT units FROM platform_budget_usage_events WHERE source_job_id=?').bind(row.id).first();
        const pinned=JSON.parse(row.budget_policy_json).model_tariff; expect(usage.units).toBe(Math.ceil(20*pinned.tariff.rates.second)); expect(usage.units).toBeLessThan(row.platform_exposure_units);
        await f.deliver(); expect(f.calls.create).toBe(1); expect(f.calls.poll).toBe(0); expect((await f.usage()).count).toBe(1);
    } finally { f.db.close(); }
});

test('Seedance actual AI adapter forwards only schema fields through the uncached private binding',async()=>{
 const {createVideoProviderTask}=await import('../workers/ai/src/lib/invoke-ai-video.js');const c=await contract(),calls=[];
 const input={...c.normalizeSeedance25Request({references:[reference('reference_audio')],duration:-1,generate_audio:false,output_format:'mov'}),seedance25_sources:[{role:'reference_audio',url:'https://bitbi.ai/api/internal/ai/media-source/synthetic'}]};
 const env={AI:{async run(id,body,options){calls.push({id,body,options});return {state:'Completed',result:{video:'https://fixture.invalid/original.mov'}};}}};
 const result=await createVideoProviderTask(env,(await import('../js/shared/admin-ai-contract.mjs')).getAdminAiVideoModelSpec(c.SEEDANCE_25_MODEL),input);
 expect(calls).toHaveLength(1);expect(calls[0].body).toEqual({duration:-1,resolution:'720p',aspect_ratio:'adaptive',fps:24,camera_fixed:false,watermark:false,output_format:'mov',use_virtual_avatar:false,generate_audio:false,reference_audios:['https://bitbi.ai/api/internal/ai/media-source/synthetic']});
 expect(calls[0].options.gateway).toMatchObject({collectLog:false,skipCache:true});expect(result).toMatchObject({status:'succeeded',videoUrl:'https://fixture.invalid/original.mov',providerCostUsd:null});
});

test('Seedance stored MOV duration retains native audio, rejects absent/replaced/overlong evidence instead of free billing',async()=>{
 const {seedance25StoredOutputSeconds}=await import('../workers/auth/src/lib/seedance-25-output.js');const {createAuthTestEnv}=require('./helpers/auth-worker-harness');const fs=require('node:fs');const env=createAuthTestEnv();const key='synthetic/output.mov',bytes=fs.readFileSync(require('node:path').join(__dirname,'fixtures/media/seedance-output.mov'));
 await env.USER_IMAGES.put(key,bytes,{httpMetadata:{contentType:'video/quicktime'}});expect(await seedance25StoredOutputSeconds(env,key,'mov')).toBe(4);
 await expect(seedance25StoredOutputSeconds(env,key,'mp4')).rejects.toMatchObject({code:'generation_result_requires_credit_review'});
 await env.USER_IMAGES.put(key,new Uint8Array(128),{httpMetadata:{contentType:'video/quicktime'}});await expect(seedance25StoredOutputSeconds(env,key,'mov')).rejects.toMatchObject({code:'generation_result_requires_credit_review'});
 const {inspectOwnedTimeReference}=await import('../workers/auth/src/lib/h3-reference-metadata.js');expect(inspectOwnedTimeReference(bytes,'video','video/quicktime')).toMatchObject({duration:4,audioDuration:4,fps:24});
});

test('Seedance durable admission retains all 52 owned sources and blocks foreign references before dispatch',async()=>{
 const {videoFixture}=require('./helpers/q4-video-jobs');const fs=require('node:fs'),path=require('node:path');const c=await contract();
 const references=['first_frame','last_frame',...Array(30).fill('reference_image'),...Array(10).fill('reference_video'),...Array(10).fill('reference_audio')].map((role,index)=>reference(role,index));
 const f=await videoFixture(async request=>{const body=await request.json();expect(body.seedance25_sources.map(v=>v.role)).toEqual(references.map(v=>v.role));expect(body.seedance25_sources).toHaveLength(52);return Response.json({ok:true,result:{status:'failed'}});},{payload:c.normalizeSeedance25Request({references,duration:-1}),prepare:async(env,admin)=>{
   for(const ref of references){const media=c.seedance25MediaType(ref.role),id=ref.source.asset_id,key=`users/${admin.id}/${id}`,file=media==='image'?'member-image.png':media==='audio'?'canvas-preview-loud.wav':'canvas-end-frame.mp4',mime=media==='image'?'image/png':media==='audio'?'audio/wav':'video/mp4';const bytes=fs.readFileSync(path.join(__dirname,'fixtures/media',file));await env.USER_IMAGES.put(key,bytes,{httpMetadata:{contentType:mime}});
     if(media==='image')await env.DB.prepare('INSERT INTO ai_images(id,user_id,r2_key,prompt,model,created_at) VALUES(?,?,?,?,?,?)').bind(id,admin.id,key,'Synthetic','fixture',new Date().toISOString()).run();
     else await env.DB.prepare('INSERT INTO ai_text_assets(id,user_id,r2_key,title,file_name,source_module,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,admin.id,key,'Synthetic',file,media==='audio'?'music':'video',mime,bytes.length,new Date().toISOString()).run();
   }
 }});
 try{
   const row=await f.row(),input=JSON.parse(row.input_json);expect(input._source_snapshots).toHaveLength(52);expect(input.references).toEqual(references);
   const sources=await import('../workers/auth/src/lib/admin-ai-video-sources.js');await expect(sources.snapshotGrokVideoSources(f.env,{id:'foreign-user'},input)).rejects.toMatchObject({status:404});
   expect(f.calls.create).toBe(0);await f.deliver();expect(f.calls.create).toBe(1);expect((await f.row()).status).toBe('failed');expect((await f.usage()).count).toBe(0);
 }finally{f.db.close();}
});

test('Seedance late Admin MOV recovery settles the pinned output duration once without regeneration',async()=>{
 const {videoFixture}=require('./helpers/q4-video-jobs');const fs=require('node:fs'),path=require('node:path');const c=await contract(),bytes=fs.readFileSync(path.join(__dirname,'fixtures/media/seedance-output.mov'));
 const f=await videoFixture(async()=>Response.json({ok:true,result:{status:'failed'}}),{payload:c.normalizeSeedance25Request({prompt:'Synthetic recovery',duration:-1,output_format:'mov'}),download:async()=>new Response(bytes,{headers:{'content-type':'video/quicktime'}})});
 try{
   await f.deliver();const row=await f.row();expect(row.status).toBe('failed');
   const args={env:f.env,adminUser:{id:row.user_id,role:'admin'},jobId:row.id,providerResponseRaw:JSON.stringify({state:'Completed',result:{video:'https://fixture.invalid/recovered.mov'}}),operatorReason:'Synthetic stored output recovery',idempotencyKey:'seedance-recovery',correlationId:'synthetic-seedance'};
   await f.jobs.recoverAdminAiVideoJobFromProviderResponse(args);const recovered=await f.row();expect(recovered.status).toBe('succeeded');expect(recovered.output_r2_key).toMatch(/\.mov$/);expect(f.jobs.serializeAiVideoJob(recovered).outputFormat).toBe('mov');
   const event=await f.db.prepare('SELECT units FROM platform_budget_usage_events WHERE source_job_id=?').bind(row.id).first();expect(event.units).toBe(Math.ceil(4*JSON.parse(row.budget_policy_json).model_tariff.tariff.rates.second));
   await f.jobs.recoverAdminAiVideoJobFromProviderResponse(args);await f.deliver();expect((await f.usage()).count).toBe(1);expect(f.calls).toMatchObject({create:1,poll:0,download:1});
 }finally{f.db.close();}
});
