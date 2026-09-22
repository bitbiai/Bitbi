import fs from 'node:fs';
import assert from 'node:assert/strict';

// Real Auth bundle, native D1/R2/Images; only the AI service response is synthetic.
export async function runCanvasTests(f) {
  for (const migration of f.migrations) await f.db.batch(migration.statements.map(s => f.db.prepare(s)));
  const now = new Date().toISOString(), adminId = 'q2-workerd-admin', memberId = 'q2-workerd-member';
  for (const [id, role] of [[adminId, 'admin'], [memberId, 'user']]) await f.sql('INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)', id, id+'@example.invalid', 'synthetic', now, role, 'active', now, 'email').run();
  const cookie = async id => (await (await f.control('/session', { userId: id })).json()).cookie;
  let admin = await cookie(adminId); const member = await cookie(memberId); let count = 0;
  const request = (route, body, key = 'native-canvas-key', auth = admin, method = body ? 'POST' : 'GET') => f.mf.dispatchFetch('https://bitbi.ai'+route, { method, headers: { Cookie: auth, Origin: 'https://bitbi.ai', 'Content-Type': 'application/json', 'Idempotency-Key': key, 'CF-Connecting-IP': `192.0.2.${++count}` }, body: body ? JSON.stringify(body) : undefined });
  const ok = async response => { const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.ok, true); return data.data; };
  const project = 'a'.repeat(32), node = 'b'.repeat(32), org = 'org_'+'c'.repeat(32), other = 'org_'+'d'.repeat(32);
  await f.sql('INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)', project, adminId, 'Synthetic Canvas', 'en', now, now).run();
  await f.sql('INSERT INTO canvas_nodes(id,project_id,user_id,type,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?,?)', node, project, adminId, 'text_generation', '@cf/meta/llama-3.1-8b-instruct-fast', JSON.stringify({ prompt: 'Synthetic native prompt', maxTokens: 300 }), '{}', now, now).run();
  const route = `/api/account/canvas/projects/${project}/nodes/${node}/run`;
  await f.test('image25_native_owned_reference_boundary_and_unverified_tariff_blocks_dispatch', async () => {
    const bytes = fs.readFileSync(new URL('../../fixtures/media/member-image.png', import.meta.url));
    const sources = [];
    for (let i = 0; i < 16; i++) {
      const id = `image25-native-${i}`, key = `users/${memberId}/image25-${i}.png`;
      await f.bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
      await f.sql('INSERT INTO ai_images(id,user_id,r2_key,prompt,model,size_bytes,created_at) VALUES(?,?,?,?,?,?,?)', id, memberId, key, 'Synthetic reference', 'uploaded', bytes.length, now).run();
      sources.push({ source_type: 'saved_asset', asset_id: id });
    }
    for (const model of ['openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare']) {
      const body = { model, prompt: 'x'.repeat(1001), quality: 'max', size: 'auto', background: 'transparent', outputFormat: 'png', source_images: sources };
      const valid = await request('/api/ai/generate-image', body, `image25-${model}`, member);
      assert.equal(valid.status, 503, await valid.clone().text()); assert.equal((await valid.json()).code, 'gpt_image_25_reference_pricing_unavailable');
      const tooMany = await request('/api/ai/generate-image', { ...body, source_images: [...sources, sources[0]] }, 'image25-too-many', member);
      assert.equal(tooMany.status, 400);
      const foreign = await request('/api/ai/generate-image', body, 'image25-foreign', admin);
      assert.equal(foreign.status, 404);
    }
    const body = { model: 'openai/gpt-image-2.5-flare', prompt: 'Synthetic reference', source_images: [sources[0]] };
    await f.bucket.put(`users/${memberId}/image25-0.png`, 'not-an-image', { httpMetadata: { contentType: 'image/png' } });
    assert.equal((await request('/api/ai/generate-image', body, 'image25-invalid-mime', member)).status, 400);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_ai_usage_attempts_v2'), 0);
    assert.equal(f.canvasProvider.requests.length, 0);
  });
  await f.test('canvas_native_MFA_and_ownership_deny_before_provider', async () => {
    assert.equal((await request(route, {})).status, 403);
    assert.equal((await request(route, {}, 'member-key', member)).status, 404);
    assert.equal((await request('/api/admin/private-media/service',undefined,'media-mfa')).status,403);
    assert.equal((await request('/api/admin/private-media/service',{backend:'cloudflare',reason:'Unauthorized'},'media-denied',member)).status,403);
    assert.equal(f.canvasProvider.requests.length, 0);
  });
  const password = 'Synthetic native Canvas password 123!';
  await f.control('/password', { userId: adminId, password });
  const login = await request('/api/login', { email: adminId+'@example.invalid', password });
  assert.equal(login.status, 200); admin = login.headers.getSetCookie().find(c => c.startsWith('__Host-bitbi_session=')).split(';')[0];
  const setup = (await (await request('/api/admin/mfa/setup', {})).json()).setup;
  const code = (await (await f.control('/totp', { secret: setup.secret })).json()).code;
  const enabled = await request('/api/admin/mfa/enable', { code }); assert.equal(enabled.status, 200);
  admin += '; '+enabled.headers.getSetCookie().find(c => c.startsWith('__Host-bitbi_admin_mfa=')).split(';')[0];
  await f.test('private_media_admin_read_no_inference_and_not_ready_switch_denied',async()=>{
    const state=await ok(await request('/api/admin/private-media/service'));assert.equal(state.backend,'github');assert.equal(state.thumbnailBackend,'github');assert.equal(state.services.cloudflare.state,'not_configured');
    assert.equal((await request('/api/admin/private-media/service',{backend:'cloudflare',reason:'Not configured'})).status,409);
    assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM app_settings WHERE key='private_media_service'"),1);
  });
  await f.test('canvas_native_budget_switch_and_missing_cap_deny_before_inference', async () => {
    assert.equal((await request(route, {}, 'switch-off')).status, 503);
    for (const key of ['ENABLE_ADMIN_AI_TEXT_BUDGET', 'ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET']) await f.sql('INSERT INTO admin_runtime_budget_switches(switch_key,enabled,created_at,updated_at) VALUES(?,1,?,?)', key, now, now).run();
    assert.equal((await request(route, {}, 'missing-cap')).status, 503);
    assert.equal(f.canvasProvider.requests.length, 0);
  });
  for (const window of ['daily', 'monthly']) await f.sql("INSERT INTO platform_budget_limits(id,budget_scope,window_type,limit_units,created_at,updated_at) VALUES(?,'platform_admin_lab_budget',?,1000000,?,?)", window, window, now, now).run();
  await f.test('canvas_native_text_platform_budget_without_member_credit_and_exact_replay', async () => {
    const result = await ok(await request(route, {})); assert.equal(result.run.output.text, 'Native Canvas answer');
    assert.equal(result.run.input.execution_mode, 'admin_platform_text');
    assert.equal((await ok(await request(route, {}))).idempotent_replay, true);
    assert.equal(f.canvasProvider.requests.length, 1);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_credit_ledger'), 0);
    assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM admin_ai_usage_attempts_v2 WHERE status='succeeded'"), 1);
  });
  for (const id of [org, other]) await f.sql('INSERT INTO organizations(id,name,slug,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, 'Synthetic', id, adminId, now, now).run();
  await f.sql('INSERT INTO organization_memberships(id,organization_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'membership', org, adminId, 'owner', now, now).run();
  await f.sql('UPDATE canvas_nodes SET type=?,model_id=? WHERE id=?', 'image_generation', '@cf/black-forest-labs/flux-1-schnell', node).run();
  await f.test('canvas_native_image_requires_selected_member_org_and_credits', async () => {
    assert.equal((await request(route, {}, 'missing-org')).status, 409);
    assert.equal((await request(route, { organization_id: other }, 'foreign-org')).status, 404);
    assert.equal((await request(route, { organization_id: org }, 'empty-org')).status, 402);
    assert.equal(f.canvasProvider.requests.length, 1);
  });
  await f.sql("INSERT INTO credit_ledger(id,organization_id,amount,balance_after,entry_type,source,created_by_user_id,created_at) VALUES(?,?,100,100,'grant','synthetic',?,?)", 'credit', org, adminId, now).run();
  await f.test('canvas_native_paid_image_checkpoint_retry_no_regeneration_and_owner_asset_reload', async () => {
    // Native DB failure after reference checkpoint; no production failpoint.
    await f.db.exec("CREATE TRIGGER canvas_test_save_failure BEFORE INSERT ON ai_images BEGIN SELECT RAISE(ABORT, 'synthetic save interruption'); END;");
    const first = await request(route, { organization_id: org }, 'save-key');
    assert.equal((await first.json()).code, 'canvas_image_save_pending');
    assert.equal(f.canvasProvider.requests.length, 2);
    await f.db.exec('DROP TRIGGER canvas_test_save_failure;');
    const results = await Promise.all([request(route, { organization_id: org }, 'save-key'), request(route, { organization_id: org }, 'save-key')]);
    const saved = results.find(r => r.status === 200); assert.ok(saved, 'One native claimant must finish');
    const result = await ok(saved); const image = result.run.asset_id;
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=? AND user_id=?', image, adminId), 1);
    assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM credit_ledger WHERE entry_type='consume'"), 1);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_credit_ledger'), 0);
    assert.equal(f.canvasProvider.requests.length, 2);
    const reloaded = await ok(await request(`/api/account/canvas/projects/${project}`));
    assert.equal(reloaded.nodes[0].output.assetId, image);
    assert.equal((await ok(await request(route, { organization_id: org }, 'save-key'))).idempotent_replay, true);
    assert.equal((await request(`/api/account/canvas/projects/${project}`, undefined, 'private-key', member)).status, 404);
    assert.equal(f.canvasProvider.requests.length, 2);
  });
  await f.test('canvas_native_saved_image_is_reusable_only_by_owner_and_org_switch_conflicts', async () => {
    const target = 'e'.repeat(32);
    await f.sql('INSERT INTO organization_memberships(id,organization_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'other-membership', other, adminId, 'member', now, now).run();
    assert.equal((await request(route, { organization_id: other }, 'save-key')).status, 409);
    await f.sql('INSERT INTO canvas_nodes(id,project_id,user_id,type,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?,?)', target, project, adminId, 'image_generation', 'black-forest-labs/flux-2-max', JSON.stringify({ prompt: 'Refine existing image' }), '{}', now, now).run();
    await f.sql('INSERT INTO canvas_edges(id,project_id,user_id,source_node_id,target_node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', 'f'.repeat(32), project, adminId, node, target, now, now).run();
    const result = await ok(await request(`/api/account/canvas/projects/${project}/nodes/${target}/run`, { organization_id: org }, 'reference-key'));
    assert.equal(result.run.input.generation.connected_reference_image_count, 1);
    assert.equal(f.canvasProvider.requests.length, 3);
    assert.equal(f.canvasProvider.requests[2].body.referenceImages.length, 1);
    assert.match(f.canvasProvider.requests[2].body.referenceImages[0], /^data:image\/png;base64,/);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_images WHERE user_id=?', adminId), 2);
    const before = await f.scalar("SELECT COUNT(*) AS value FROM credit_ledger WHERE entry_type='consume'");
    f.canvasProvider.fail = true;
    const failed = await request(route, { organization_id: org }, 'provider-failure');
    assert.equal(failed.status, 502); assert.equal((await request(route, { organization_id: org }, 'provider-failure')).status, 409);
    assert.equal(f.canvasProvider.requests.length, 4);
    assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM credit_ledger WHERE entry_type='consume'"), before);
  });
  for (const name of ['h3','h3-overrun','h3-overrun-failure','h3-last-frame','h3-stale','h3-deleted','h3-foreign','first','success','last-frame','foreign','changed','blocked','blocked-admin','provider-interrupted','receipt-write']) await f.test(`canvas_native_video_${name}`, async () => {
    const response = await f.control('/canvas-video', { name,
      shortBase64: fs.readFileSync(new URL('../../fixtures/media/h3-reference.mp4', import.meta.url)).toString('base64'),
      preparedBase64: fs.readFileSync(new URL('../../fixtures/media/h3-prepared.mp4', import.meta.url)).toString('base64'),
      videoBase64: fs.readFileSync(new URL(name.startsWith('h3-overrun')?'../../fixtures/media/h3-overrun.mp4':name.startsWith('h3')?'../../fixtures/media/h3-reference.mp4':'../../fixtures/media/canvas-end-frame.mp4', import.meta.url)).toString('base64'),
      imageBase64: fs.readFileSync(new URL(name.startsWith('h3')?'../../fixtures/media/h3-frame.png':'../../fixtures/media/member-image.png', import.meta.url)).toString('base64'),
    });
    assert.equal(response.status, 200, `Native Canvas video ${name}: ${await response.clone().text()}`);
    f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
  });
  for(const model of ['xai/grok-imagine-video','xai/grok-imagine-video-1.5-preview']) for(const operation of ['edit','extend']) await f.test(`canvas_native_${model.split('/')[1]}_${operation}_references`,async()=>{
    const response=await f.control('/canvas-video',{name:'last-frame',model,operation,
      videoBase64:fs.readFileSync(new URL('../../fixtures/media/canvas-end-frame.mp4',import.meta.url)).toString('base64'),
      imageBase64:fs.readFileSync(new URL('../../fixtures/media/member-image.png',import.meta.url)).toString('base64'),
    });
    assert.equal(response.status,200,await response.clone().text());f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
  });
  for (const name of ['success','failure','unknown','grok-base','grok-preview','h3']) await f.test(`admin_native_pixverse_${name}`, async () => {
    const response = await f.control('/admin-pixverse', { name,
      referenceBase64:fs.readFileSync(new URL('../../fixtures/media/h3-overrun.mp4',import.meta.url)).toString('base64'),
      preparedBase64:fs.readFileSync(new URL('../../fixtures/media/h3-prepared.mp4',import.meta.url)).toString('base64'),
      videoBase64: fs.readFileSync(new URL('../../fixtures/media/canvas-end-frame.mp4', import.meta.url)).toString('base64'),
      imageBase64: fs.readFileSync(new URL(name.startsWith('h3')?'../../fixtures/media/h3-frame.png':'../../fixtures/media/member-image.png', import.meta.url)).toString('base64'),
    });
    assert.equal(response.status, 200, `Native Canvas video ${name}: ${await response.clone().text()}`);
    f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'), []);
  });
  await f.test('canvas_native_private_full_video_and_posters', async () => {
    const response=await f.control('/canvas-processing',{
      videoBase64:fs.readFileSync(new URL('../../fixtures/media/canvas-end-frame.mp4',import.meta.url)).toString('base64'),
      imageBase64:fs.readFileSync(new URL('../../fixtures/media/member-image.png',import.meta.url)).toString('base64'),
    });
    assert.equal(response.status,200,await response.clone().text());f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
  });
  await f.test('private_media_native_release_smoke_same_endpoints_both_backends',async()=>{
    const response=await f.control('/private-media-smoke',{
      referenceBase64:fs.readFileSync(new URL('../../fixtures/media/h3-overrun.mp4',import.meta.url)).toString('base64'),
      preparedBase64:fs.readFileSync(new URL('../../fixtures/media/h3-prepared.mp4',import.meta.url)).toString('base64'),
      videoBase64:fs.readFileSync(new URL('../../fixtures/media/canvas-end-frame.mp4',import.meta.url)).toString('base64'),
      imageBase64:fs.readFileSync(new URL('../../fixtures/media/member-image.png',import.meta.url)).toString('base64'),
    });assert.equal(response.status,200,await response.clone().text());f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
  });
  await f.test('private_media_native_immediate_fenced_dispatch_and_backend_assignment',async()=>{
    const response=await f.control('/private-media',{cookie:admin,videoBase64:fs.readFileSync(new URL('../../fixtures/media/canvas-end-frame.mp4',import.meta.url)).toString('base64'),imageBase64:fs.readFileSync(new URL('../../fixtures/media/member-video-poster.webp',import.meta.url)).toString('base64')});assert.equal(response.status,200,await response.clone().text());f.metrics.push(await response.json());
    assert.deepEqual(await f.rows('PRAGMA foreign_key_check'),[]);
  });
  await f.test('canvas_native_grok_reasoning_reservation_saved_output_and_replay', async () => {
    const { estimateCanvasTextCredits, getCanvasTextInstructions } = await import('../../../js/shared/canvas-model-contract.mjs');
    const p='7a'.repeat(16), n='7b'.repeat(16), config={prompt:'Native Grok fixture',reasoningEffort:'high',textPurpose:'song_lyrics',systemPrompt:'Legacy saved value'};
    f.canvasProvider.fail=false;
    await f.sql('INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)',p,memberId,'Grok','en',now,now).run();
    await f.sql('INSERT INTO canvas_nodes(id,project_id,user_id,type,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?,?)',n,p,memberId,'text_generation','xai/grok-4.6',JSON.stringify(config),'{}',now,now).run();
    const endpoint=`/api/account/canvas/projects/${p}/nodes/${n}/run`, before=f.canvasProvider.requests.length;
    assert.equal((await request(endpoint,{},'empty-grok',member)).status,402);
    assert.equal(f.canvasProvider.requests.length,before);
    await f.sql("INSERT INTO member_credit_ledger(id,user_id,amount,balance_after,entry_type,source,created_by_user_id,created_at) VALUES(?,?,1000,1000,'grant','synthetic',?,?)",'grok-grant',memberId,adminId,new Date().toISOString()).run();
    const result=await ok(await request(endpoint,{},'grok-run',member));
    assert.equal(result.run.output.text,'Native Canvas answer');
    assert.equal(f.canvasProvider.requests.at(-1).body.reasoningEffort,'high');
    assert.equal(f.canvasProvider.requests.at(-1).body.maxTokens,32768);
    assert.equal(f.canvasProvider.requests.at(-1).body.system,getCanvasTextInstructions(config));
    assert.equal(await f.scalar("SELECT -SUM(amount) AS value FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'",memberId),estimateCanvasTextCredits('xai/grok-4.6',{...config,systemPrompt:getCanvasTextInstructions(config)}));
    assert.equal((await ok(await request(endpoint,{},'grok-run',member))).idempotent_replay,true);
    assert.equal(f.canvasProvider.requests.length,before+1);
    const reload=await ok(await request(`/api/account/canvas/projects/${p}`,undefined,'reload-grok',member));
    assert.equal(reload.nodes[0].output.text,'Native Canvas answer');
    assert.equal(reload.nodes[0].config.reasoningEffort,'high');
    assert.equal(reload.nodes[0].config.textPurpose,'song_lyrics');
    assert.equal(reload.nodes[0].config.systemPrompt,'Legacy saved value');
    await f.sql('UPDATE canvas_nodes SET config_json=? WHERE id=?',JSON.stringify({...config,textPurpose:'video_prompt'}),n).run();
    assert.equal((await request(endpoint,{},'grok-run',member)).status,409);
    assert.equal(f.canvasProvider.requests.length,before+1);
    assert.equal((await request(endpoint,{},'foreign-grok',admin)).status,404);
  });
  await f.test('image25_native_completed_uri_preserves_alpha_format_model_and_single_paid_save_after_reload', async () => {
    f.canvasProvider.image25Https = true;
    const probe=await f.control('/image25-output',{});
    if (!probe.ok) console.log(JSON.stringify(await probe.json()));
    assert.equal(probe.status,200);
    const { calculateAiImageCreditCost } = await import('../../../js/shared/ai-model-pricing.mjs');
    const p='81'.repeat(16);
    await f.sql('INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)',p,memberId,'Image 2.5 native','en',now,now).run();
    await f.db.exec(`CREATE TRIGGER image25_native_checkpoint_before_debit BEFORE INSERT ON member_credit_ledger
      WHEN NEW.entry_type='consume' AND NEW.user_id='q2-workerd-member'
        AND NOT EXISTS(SELECT 1 FROM member_ai_usage_attempts_v2 a WHERE a.idempotency_key=NEW.idempotency_key AND a.user_id=NEW.user_id
          AND a.result_status='stored' AND a.result_temp_key IS NOT NULL AND a.result_save_reference IS NOT NULL AND a.result_mime_type IN ('image/png','image/webp'))
      BEGIN SELECT RAISE(ABORT,'image25 result must be durable before debit'); END;`.replace(/\s+/g,' '));
    for(const [index,modelId] of ['openai/gpt-image-2.5-sunburst','openai/gpt-image-2.5-flare'].entries()){
      const n=(index?'83':'82').repeat(16), format=index?'webp':'png';
      const config={prompt:'Native transparent image 2.5 fixture',quality:'medium',size:'1024x1024',background:'transparent',outputFormat:format,source_images:[],referenceOrder:[]};
      await f.sql('INSERT INTO canvas_nodes(id,project_id,user_id,type,model_id,x,y,config_json,content_json,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?,?,?)',n,p,memberId,'image_generation',modelId,JSON.stringify(config),'{}',now,now).run();
      const endpoint=`/api/account/canvas/projects/${p}/nodes/${n}/run`,key=`image25-native-run-${index}`;
      const before=f.canvasProvider.requests.length, debitBefore=await f.scalar("SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'",memberId);
      if(index){
        await f.db.exec("CREATE TRIGGER image25_native_save_interrupted BEFORE INSERT ON ai_images WHEN NEW.model='openai/gpt-image-2.5-flare' BEGIN SELECT RAISE(ABORT,'synthetic image25 save interruption'); END;");
        const interrupted=await request(endpoint,{},key,member);assert.equal((await interrupted.json()).code,'canvas_image_save_pending');
        assert.equal(f.canvasProvider.requests.length,before+1);
        await f.db.exec('DROP TRIGGER image25_native_save_interrupted;');
      }
      const result=await ok(await request(endpoint,{},key,member)),assetId=result.run.asset_id;
      assert.equal(result.run.status,'completed');assert.equal(result.run.output.mimeType,`image/${format}`);
      assert.equal(f.canvasProvider.requests.length,before+1);
      assert.deepEqual(f.canvasProvider.requests.at(-1).body,{model:modelId,prompt:config.prompt,quality:'medium',size:'1024x1024',background:'transparent',output_format:format});
      const image=await f.sql('SELECT model,r2_key,size_bytes FROM ai_images WHERE id=? AND user_id=?',assetId,memberId).first();
      assert.ok(image);assert.equal(image.model,modelId);assert.ok(image.r2_key.endsWith('.'+format));
      const stored=await f.bucket.get(image.r2_key),bytes=Buffer.from(await stored.arrayBuffer());
      assert.equal(stored.httpMetadata.contentType,`image/${format}`);assert.deepEqual(bytes,f.canvasProvider.image25Fixtures[format]);
      if(format==='png')assert.equal(bytes[25],6,'Original PNG retains RGBA color type');
      assert.deepEqual(JSON.parse(stored.customMetadata.generation),{model:modelId,quality:'medium',size:'1024x1024',background:'transparent',outputFormat:format,referenceImageCount:0,width:1024,height:1024,mimeType:`image/${format}`});
      assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'",memberId),debitBefore+1);
      assert.equal(await f.scalar('SELECT a.credit_cost AS value FROM member_ai_usage_attempts_v2 a JOIN canvas_runs r ON r.usage_attempt_id=a.id WHERE r.id=?',result.run.id),calculateAiImageCreditCost(modelId,config).credits);
      const reloaded=await ok(await request(`/api/account/canvas/projects/${p}`,undefined,'image25-reload',member));
      const savedNode=reloaded.nodes.find(value=>value.id===n);assert.deepEqual(savedNode.config,config);assert.equal(savedNode.output.assetId,assetId);
      assert.equal((await ok(await request(endpoint,{},key,member))).idempotent_replay,true);
      const save=`/api/account/canvas/projects/${p}/runs/${result.run.id}/save-asset`;
      for(let repeat=0;repeat<2;repeat++){const saved=await ok(await request(save,{},`image25-save-${index}`,member));assert.equal(saved.asset_id,assetId);assert.equal(saved.storage,'assets');}
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=?',assetId),1);
      assert.equal(f.canvasProvider.requests.length,before+1);assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'",memberId),debitBefore+1);
      assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM member_credit_ledger l JOIN member_ai_usage_attempts_v2 a ON a.user_id=l.user_id AND a.idempotency_key=l.idempotency_key WHERE l.user_id=? AND l.entry_type='consume' AND a.result_model=?",memberId,modelId),1,'Checkpoint trigger must cover the actual debit');
      assert.equal((await request(`/api/account/canvas/projects/${p}`,undefined,'image25-foreign-reload',admin)).status,404);
      f.metrics.push({model:modelId,format,width:1024,height:1024,providerCalls:1,debits:1,credits:calculateAiImageCreditCost(modelId,config).credits,checkpointBeforeDebit:true,interruptedSaveRecovered:Boolean(index),reloadReplayAndSave:true});
    }
    await f.db.exec('DROP TRIGGER image25_native_checkpoint_before_debit;');
  });

  for(const [scenario,model,format] of [
    ['success','openai/gpt-image-2.5-sunburst','png'],
    ['released','openai/gpt-image-2.5-flare','webp'],
    ['body','openai/gpt-image-2.5-sunburst','png'],
    ['redirect','openai/gpt-image-2.5-flare','png'],
  ]) await f.test(`image25_native_generate_lab_queue_https_${scenario}`,async()=>{
    const before=f.canvasProvider.requests.length, key=`image25-queue-${scenario}`;
    const payload={model,prompt:'Synthetic queued image',quality:'medium',size:'1024x1024',background:'transparent',outputFormat:format};
    const accepted=await f.mf.dispatchFetch('https://bitbi.ai/api/ai/generate-image',{method:'POST',headers:{Cookie:member,Origin:'https://bitbi.ai','Content-Type':'application/json','Idempotency-Key':key,Prefer:'respond-async','CF-Connecting-IP':`192.0.2.${++count}`},body:JSON.stringify(payload)});
    assert.equal(accepted.status,202,await accepted.clone().text());
    const id=(await accepted.json()).data.job.id;
    const row=()=>f.sql('SELECT * FROM member_generation_jobs WHERE id=?',id).first();
    const usage=async()=>f.sql('SELECT * FROM member_ai_usage_attempts_v2 WHERE id=?',(await row()).usage_attempt_id).first();
    const debit=async()=>f.scalar("SELECT COUNT(*) AS value FROM member_credit_ledger l JOIN member_ai_usage_attempts_v2 a ON a.user_id=l.user_id AND a.idempotency_key=l.idempotency_key WHERE a.id=? AND l.entry_type='consume'",(await row()).usage_attempt_id);
    const queue=async()=>{const response=await f.control('/image25-queue',{id});assert.equal(response.status,200,await response.clone().text());return response.json();};
    f.canvasProvider.outputFailure=scenario==='released'?'transport':scenario==='success'?null:scenario;
    await queue();
    assert.equal(f.canvasProvider.requests.length,before+1);
    let job=await row(),receipt=JSON.parse(job.provider_receipts_json)['ai-0'];
    assert.match(receipt.correlationId,/^[a-f0-9]{32}$/);
    assert.ok(JSON.stringify(f.canvasProvider.requestOptions.at(-1)).includes(receipt.correlationId),'Real AI binding receives immutable dispatch correlation');
    const receiptObject=await f.bucket.get(receipt.key),originalReceipt=Buffer.from(await receiptObject.arrayBuffer());
    if(scenario!=='success'){
      assert.equal(job.delivery_status,undefined,'Delivery stays in the existing receipt metadata');
      assert.ok(receipt.delivery.diagnostic,JSON.stringify({code:job.error_code,delivery:receipt.delivery,usage:(await usage()).error_code}));
      assert.equal(receipt.delivery.diagnostic.correlationId,receipt.correlationId);
      assert.equal(receipt.delivery.diagnostic.stage,scenario==='released'?'output_http':scenario==='body'?'output_validate':'output_redirect_rejected');
      if(scenario==='released')assert.equal(receipt.delivery.diagnostic.status,500,'Native service transport failure becomes HTTP 500');
      assert.equal(await debit(),0);
      assert.equal((await usage()).late_outcome,'succeeded');
      assert.equal(job.status,scenario==='redirect'?'failed':'ingesting');
      if(scenario==='released'){
        // Simulate the recorded elapsed lease/reservation, using real expiry accounting.
        await f.sql("UPDATE member_ai_usage_attempts_v2 SET expires_at=? WHERE id=?",new Date(Date.now()-60_000).toISOString(),job.usage_attempt_id).run();
        assert.equal((await f.control('/image25-queue',{id,expire:true})).status,200);
        assert.equal((await usage()).billing_status,'released');
        await f.sql("UPDATE member_generation_jobs SET status='outcome_unknown',attempt_count=8 WHERE id=?",id).run();
      }
      if(scenario==='redirect'){
        await queue();assert.equal(f.canvasProvider.requests.length,before+1);assert.equal(await debit(),0);
        assert.equal((await row()).status,'failed');return;
      }
      f.canvasProvider.outputFailure=null;
      await f.sql('UPDATE member_generation_jobs SET next_attempt_at=? WHERE id=?',new Date(Date.now()-1000).toISOString(),id).run();
      await queue();job=await row();receipt=JSON.parse(job.provider_receipts_json)['ai-0'];
    }
    assert.equal(job.status,'succeeded',JSON.stringify({status:job.status,code:job.error_code,delivery:receipt.delivery}));
    assert.equal(job.asset_id,id);assert.equal(receipt.delivery.status,'saved');
    const expectedDebit=scenario==='released'?0:1;
    assert.equal(await debit(),expectedDebit);
    if(scenario==='released'){
      const attempt=await usage();assert.equal(attempt.billing_status,'released');assert.ok(attempt.reservation_released_at);
      assert.equal(job.attempt_count,9);assert.equal(receipt.delivery.billing,'released_no_debit');
      const reconciliation=JSON.parse(attempt.metadata_json).image_delivery_reconciliation;
      assert.equal(reconciliation.receiptSha256,(await import('node:crypto')).createHash('sha256').update(originalReceipt).digest('hex'));
      assert.equal(reconciliation.creditsCharged,0);assert.equal(reconciliation.jobId,id);
      await f.sql("UPDATE member_ai_usage_attempts_v2 SET metadata_json=json_remove(metadata_json,'$.image_delivery_reconciliation.receiptSha256') WHERE id=?",job.usage_attempt_id).run();
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_generation_unready_assets WHERE id=?',id),1,'Missing audit cannot expose released output');
      await f.sql('UPDATE member_ai_usage_attempts_v2 SET metadata_json=? WHERE id=?',attempt.metadata_json,job.usage_attempt_id).run();
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_generation_unready_assets WHERE id=?',id),0);
      await f.db.exec("DROP VIEW member_generation_unready_assets; CREATE VIEW member_generation_unready_assets AS SELECT jobs.id FROM member_generation_jobs jobs JOIN member_ai_usage_attempts_v2 usage ON usage.id=jobs.usage_attempt_id WHERE usage.billing_status <> 'finalized';");
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_generation_unready_assets WHERE id=?',id),1,'Old visibility contract hides the recovered image');
      const migration=f.migrations.find(value=>value.path.startsWith('0095_'));
      await f.db.batch(migration.statements.map(statement=>f.db.prepare(statement)));
      assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM member_generation_unready_assets WHERE id=?',id),0,'Populated native migration exposes only audited recovery');


    }
    const image=await f.sql('SELECT r2_key,model FROM ai_images WHERE id=? AND user_id=?',id,memberId).first();
    assert.equal(image.model,model);assert.ok(image.r2_key.endsWith('.'+format));
    assert.deepEqual(Buffer.from(await (await f.bucket.get(image.r2_key)).arrayBuffer()),f.canvasProvider.image25Fixtures[format]);
    const read=await ok(await request(`/api/ai/generation-jobs/${id}`,undefined,key,member));
    assert.equal(read.job.status,'succeeded');assert.equal(read.result.data.asset.id,id);assert.equal(read.result.data.mimeType,`image/${format}`);
    assert.equal((await request(`/api/ai/generation-jobs/${id}`,undefined,key,admin)).status,404);
    const download=await request(`/api/ai/images/${id}/file`,undefined,key,member);
    assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),`image/${format}`);
    assert.ok(download.headers.get('Content-Disposition').includes('.'+format));
    assert.deepEqual(Buffer.from(await download.arrayBuffer()),f.canvasProvider.image25Fixtures[format]);
    assert.equal((await request(`/api/ai/images/${id}/file`,undefined,key,admin)).status,404);

    await queue();await queue();
    assert.equal(f.canvasProvider.requests.length,before+1);assert.equal(await debit(),expectedDebit);
    assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=?',id),1);
    assert.deepEqual(Buffer.from(await (await f.bucket.get(receipt.key)).arrayBuffer()),originalReceipt);
    if(scenario==='released') {
      assert.equal((await request(`/api/ai/images/${id}`,undefined,key,member,'DELETE')).status,200);
      await queue();assert.equal(await f.scalar('SELECT COUNT(*) AS value FROM ai_images WHERE id=?',id),0);
      assert.equal((await row()).error_code,'generation_asset_removed');assert.equal(f.canvasProvider.requests.length,before+1);
    }
    f.metrics.push({scenario,queue:true,https:true,nativeDecode:true,providerCalls:1,debits:expectedDebit,assets:1,receiptUnchanged:true});
  });
  assert.equal(f.counters.outboundDenied, 0, 'No external provider or network call');
}
