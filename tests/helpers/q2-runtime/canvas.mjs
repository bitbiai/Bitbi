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
  assert.equal(f.counters.outboundDenied, 0, 'No external provider or network call');
}
