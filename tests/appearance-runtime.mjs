import assert from 'node:assert/strict';

export async function runAppearanceTests(f) {
    for (const migration of f.migrations) await f.db.batch(migration.statements.map(sql => f.db.prepare(sql)));
    const now = new Date().toISOString(), defaults = { public: 'dark', admin: 'dark', generateLab: 'dark', canvas: 'dark', account: 'dark' };
    for (const [id, role] of [['q2-workerd-admin', 'admin'], ['q2-workerd-member', 'user']]) {
        await f.sql('INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at,verification_method) VALUES(?,?,?,?,?,?,?,?)',
            id, id + '@example.invalid', 'synthetic', now, role, 'active', now, 'email').run();
    }
    const call = (cookie, method, path, body, origin = 'https://bitbi.ai') => f.mf.dispatchFetch('https://bitbi.ai' + path, {
        method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.20' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const cookie = async userId => (await (await f.control('/session', { userId })).json()).cookie;
    let admin = await cookie('q2-workerd-admin');
    const member = await cookie('q2-workerd-member'), route = '/api/admin/appearance';
    const publicRead = async identity => {
        const response = await call(identity || '', 'GET', '/api/appearance');
        assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
        return (await response.json()).appearance;
    };
    await f.test('appearance_public_defaults_do_not_expose_private_settings_or_mutate_storage', async () => {
        for (const identity of ['', member, admin]) assert.deepEqual(await publicRead(identity), { version: 1, revision: 0, segments: defaults, personalEnabled: false });
        assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM app_settings WHERE key='appearance.global.v1'"), 0);
        for (const [identity, status] of [['', 401], [member, 403], [admin, 403]]) {
            for (const method of ['GET', 'PATCH']) assert.equal((await call(identity, method, route, method === 'PATCH' ? { revision: 0, segments: defaults } : null)).status, status);
        }
    });
    const password = 'Appearance synthetic password 123!';
    await f.control('/password', { userId: 'q2-workerd-admin', password });
    const login = await call('', 'POST', '/api/login', { email: 'q2-workerd-admin@example.invalid', password });
    assert.equal(login.status, 200); admin = login.headers.getSetCookie().find(value => value.startsWith('__Host-bitbi_session=')).split(';')[0];
    const setupResponse = await call(admin, 'POST', '/api/admin/mfa/setup', {}); assert.equal(setupResponse.status, 200);
    const setup = (await setupResponse.json()).setup, code = (await (await f.control('/totp', { secret: setup.secret })).json()).code;
    const enabled = await call(admin, 'POST', '/api/admin/mfa/enable', { code }); assert.equal(enabled.status, 200);
    admin += '; ' + enabled.headers.getSetCookie().find(value => value.startsWith('__Host-bitbi_admin_mfa=')).split(';')[0];
    const save = (revision, segments) => call(admin, 'PATCH', route, { revision, segments });
    await f.test('appearance_authorized_save_is_durable_segment_scoped_and_atomically_audited', async () => {
        assert.equal((await call(admin, 'PATCH', route, { revision: 0, segments: defaults }, 'https://untrusted.invalid')).status, 403);
        const segments = { ...defaults, canvas: 'light' }, saved = await save(0, segments); assert.equal(saved.status, 200);
        const result = (await saved.json()).appearance; assert.equal(result.revision, 1); assert.equal(result.personalEnabled, false);
        for (const identity of ['', member, admin]) assert.deepEqual(await publicRead(identity), { version: 1, revision: 1, segments, personalEnabled: false });
        const read = await call(admin, 'GET', route); assert.equal(read.status, 200); assert.equal((await read.json()).appearance.updatedAt, result.updatedAt);
        const row = await f.sql("SELECT * FROM app_settings WHERE key='appearance.global.v1'").first(); assert.equal(JSON.parse(row.value_json).segments.canvas, 'light');
        const audit = await f.sql("SELECT * FROM admin_audit_log WHERE action='appearance.updated'").first();
        assert.equal(audit.admin_user_id, 'q2-workerd-admin'); assert.equal(audit.created_at, result.updatedAt);
        assert.deepEqual(JSON.parse(audit.meta_json).before.segments, defaults); assert.deepEqual(JSON.parse(audit.meta_json).after.segments, segments);
        assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM activity_search_index WHERE action_norm='appearance.updated'"), 1);
    });
    await f.test('appearance_concurrent_native_D1_writes_have_one_winner_and_one_audit_record', async () => {
        const responses = await Promise.all([save(1, { ...defaults, account: 'light' }), save(1, { ...defaults, public: 'light' })]);
        assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
        const accepted = (await responses.find(response => response.status === 200).json()).appearance;
        assert.deepEqual((await publicRead()).segments, accepted.segments); assert.equal((await publicRead()).revision, 2);
        assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM admin_audit_log WHERE action='appearance.updated'"), 2);
        assert.equal(await f.scalar("SELECT COUNT(*) AS value FROM activity_search_index WHERE action_norm='appearance.updated'"), 2);
        assert.equal((await save(1, defaults)).status, 409);
    });
    await f.test('appearance_invalid_and_personal_preference_requests_cannot_override_global_policy', async () => {
        for (const method of ['POST', 'PUT', 'PATCH']) {
            for (const identity of [member, admin]) {
                const response = await call(identity, method, '/api/account/appearance', { theme: 'light', personalEnabled: true });
                assert.equal(response.status, 403); assert.equal((await response.json()).code, 'appearance_personal_disabled');
            }
        }
        assert.equal((await call('', 'PUT', '/api/account/appearance', { theme: 'light' })).status, 401);
        for (const body of [{ revision: 2, segments: defaults, personalEnabled: true }, { revision: 2, segments: { canvas: 'light' } },
            { revision: 2, segments: { ...defaults, public: 'auto' } }, { revision: 2, segments: { ...defaults, unexpected: 'dark' } }]) {
            assert.equal((await call(admin, 'PATCH', route, body)).status, 400);
        }
        assert.equal((await publicRead()).revision, 2);
    });
    await f.test('appearance_failed_audit_cannot_report_success_or_change_settings_and_reset_keeps_pricing', async () => {
        const before = await publicRead();
        await f.sql("CREATE TRIGGER appearance_audit_failure BEFORE INSERT ON admin_audit_log WHEN NEW.action='appearance.updated' BEGIN SELECT RAISE(ABORT,'synthetic appearance audit failure'); END").run();
        assert.equal((await save(2, defaults)).status, 503); assert.deepEqual(await publicRead(), before);
        await f.sql('DROP TRIGGER appearance_audit_failure').run();
        const reset = await save(2, defaults); assert.equal(reset.status, 200); assert.deepEqual((await publicRead()).segments, defaults);
        assert.equal((await publicRead()).revision, 3); assert.equal(await f.scalar('SELECT revision AS value FROM model_pricing_state'), 0);
        assert.equal(f.counters.outboundDenied, 0); assert.equal(f.counters.serviceDenied, 0);
    });
}
