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
  for (const name of ['h3','h3-last-frame','h3-stale','h3-deleted','h3-foreign','first','success','last-frame','foreign','changed','blocked','blocked-admin','provider-interrupted','receipt-write']) await f.test(`canvas_native_video_${name}`, async () => {
    const response = await f.control('/canvas-video', { name,
      videoBase64: fs.readFileSync(new URL(name.startsWith('h3')?'../../fixtures/media/h3-reference.mp4':'../../fixtures/media/canvas-end-frame.mp4', import.meta.url)).toString('base64'),
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
  assert.equal(f.counters.outboundDenied, 0, 'No external provider or network call');
}
