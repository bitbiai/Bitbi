const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const load = () => import('../workers/auth/src/lib/appearance-settings.js');
const admin = { id: 'appearance-test-admin', role: 'admin' };
const defaults = { public: 'dark', admin: 'dark', generateLab: 'dark', canvas: 'dark', account: 'dark' };

test('appearance resolves real nested EN/DE routes and keeps personal preferences behind the authoritative gate', () => {
    const contract = require('../js/shared/appearance-contract.js');
    for (const [segment, routes] of Object.entries({
        public: ['/', '/de/', '/pricing.html', '/de/legal/privacy.html'],
        admin: ['/admin', '/admin/index.html#appearance', '/admin/tools/example.html'],
        generateLab: ['/generate-lab/', '/de/generate-lab/index.html'],
        canvas: ['/canvas/', '/de/canvas/index.html'],
        account: ['/account/assets-manager.html', '/de/account/profile-settings.html', '/account/organization.html', '/de/account/reset-password.html'],
    })) for (const route of routes) expect(contract.resolveSegment(route)).toBe(segment);
    expect(contract.PERSONAL_THEMES_ENABLED).toBe(false);
    expect(contract.THEMES).toEqual(['dark', 'light', 'soft']);
    expect(contract.DEFAULT_SEGMENTS).toEqual(defaults);
    const personalPreference = { version: 1, theme: 'light' };
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference })).toBe('dark');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference, personalEnabled: false })).toBe('dark');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference, personalEnabled: true })).toBe('light');
    expect(contract.resolvePreference({ globalTheme: 'soft', personalPreference })).toBe('soft');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference: { version: 1, theme: 'soft' } })).toBe('dark');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference: { version: 1, theme: 'soft' }, personalEnabled: true })).toBe('soft');
    expect(() => contract.normalizeAppearance({ version: 1, revision: 0, segments: defaults, personalEnabled: true })).toThrow();
});

test('appearance extends stored Dark/Light settings to Soft without resetting revisions or neighboring segments', async () => {
    const m = await load(), DB = new SqliteD1Database(); applyAuthMigrations(DB);
    const legacy = { version: 1, revision: 18, segments: { ...defaults, public: 'light', account: 'light' }, personalEnabled: false };
    try {
        const previous = JSON.stringify({ ...legacy, changeId: 'previous-version-setting' });
        await DB.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)').bind(m.APPEARANCE_SETTING_KEY, previous, '2026-09-21T12:00:00.000Z').run();
        expect(await m.getAppearance({ DB })).toEqual(legacy);
        expect((await DB.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(m.APPEARANCE_SETTING_KEY).first()).value_json).toBe(previous);
        const updated = await m.saveAppearance({ DB }, admin, { revision: legacy.revision, segments: { ...legacy.segments, canvas: 'soft' } });
        expect(updated).toMatchObject({ version: 1, revision: 19, segments: { ...legacy.segments, canvas: 'soft' }, personalEnabled: false });
        expect((await m.getAppearance({ DB })).segments).toEqual(updated.segments);
        await expect(m.saveAppearance({ DB }, admin, { revision: legacy.revision, segments: legacy.segments })).rejects.toMatchObject({ status: 409 });
        expect((await m.getAppearance({ DB })).segments.canvas).toBe('soft');
        const audit = JSON.parse((await DB.prepare('SELECT meta_json FROM admin_audit_log').first()).meta_json);
        expect(audit.before).toEqual(legacy); expect(audit.after.segments).toEqual(updated.segments);
        const unknown = JSON.stringify({ ...updated, segments: { ...updated.segments, canvas: 'future-unsupported-theme' } });
        await DB.prepare('UPDATE app_settings SET value_json=? WHERE key=?').bind(unknown, m.APPEARANCE_SETTING_KEY).run();
        await expect(m.getAppearance({ DB })).rejects.toMatchObject({ status: 503 });
        await expect(m.saveAppearance({ DB }, admin, { revision: 19, segments: defaults })).rejects.toMatchObject({ status: 503 });
        expect((await DB.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(m.APPEARANCE_SETTING_KEY).first()).value_json).toBe(unknown);
    } finally { DB.close(); }
});

test('appearance bootstrap paints cached Soft early and rejects stale or unknown responses without overriding global policy', async () => {
    const vm = require('node:vm');
    const cached = { version: 1, revision: 7, segments: { ...defaults, canvas: 'soft' }, personalEnabled: false };
    const documentRoot = { dataset: {}, style: {}, setAttribute() {}, removeAttribute() {} }, meta = {};
    const requests = [], writes = [], events = new Map();
    const context = {
        URL, AbortController, CustomEvent, structuredClone, location: { pathname: '/de/canvas/' },
        localStorage: { getItem: () => JSON.stringify(cached), setItem: (key, value) => writes.push([key, value]) },
        document: { documentElement: documentRoot, visibilityState: 'visible', querySelector: () => meta, addEventListener() {} },
        setTimeout: () => 1, clearTimeout() {},
        fetch: () => new Promise(resolve => requests.push(resolve)),
        addEventListener: (name, callback) => events.set(name, callback), dispatchEvent() {},
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['appearance-contract.js', 'appearance.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared', file), 'utf8'), context);
    expect(documentRoot.dataset).toMatchObject({ theme: 'soft', themeSegment: 'canvas' });
    expect(documentRoot.style.colorScheme).toBe('light'); expect(meta.content).toBe('#f3f0e8');
    expect(writes).toHaveLength(0); // Reading a cache cannot claim a server-confirmed write.
    const confirmed = { ...cached, revision: 9, segments: { ...cached.segments, public: 'light' } };
    expect(context.BitbiAppearance.acceptConfirmed(confirmed)).toBe(true);
    const pending = context.BitbiAppearance.refresh({ force: true });
    requests.shift()({ ok: true, json: async () => ({ ok: true, appearance: { ...cached, revision: 8, segments: defaults } }) });
    await pending;
    expect(context.BitbiAppearance.snapshot()).toEqual(confirmed); expect(documentRoot.dataset.theme).toBe('soft');
    expect(context.BitbiAppearance.acceptConfirmed({ ...confirmed, revision: 10, segments: { ...defaults, canvas: 'sepia' } })).toBe(false);
    expect(context.BitbiAppearance.acceptConfirmed({ ...confirmed, revision: 10, personalEnabled: true })).toBe(false);
    expect(documentRoot.dataset.theme).toBe('soft'); expect(writes).toHaveLength(1);
    events.get('pagehide')(); events.get('pageshow')();
    const resumed = context.BitbiAppearance.refresh({ force: true });
    requests.shift()({ ok: true, json: async () => ({ ok: true, appearance: confirmed }) }); await resumed;
    expect(documentRoot.dataset.theme).toBe('soft'); expect(context.BitbiAppearance.snapshot().personalEnabled).toBe(false);
});

test('appearance rollout is unchanged; persisted safe configuration survives another database connection', async () => {
    const m = await load(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbi-appearance-'));
    let DB = new SqliteD1Database({ filename: path.join(directory, 'settings.db') });
    try {
        applyAuthMigrations(DB);
        expect(await m.getAppearance({ DB })).toEqual({ version: 1, revision: 0, segments: defaults, personalEnabled: false });
        expect((await DB.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key='appearance.global.v1'").first()).n).toBe(0);
        const segments = { ...defaults, canvas: 'light' };
        const saved = await m.saveAppearance({ DB }, admin, { revision: 0, segments });
        expect(saved.revision).toBe(1);
        DB.close(); DB = new SqliteD1Database({ filename: path.join(directory, 'settings.db') });
        expect(await m.getAppearance({ DB })).toEqual({ version: 1, revision: 1, segments, personalEnabled: false });
        const audit = await DB.prepare('SELECT * FROM admin_audit_log').first();
        expect(audit.admin_user_id).toBe(admin.id); expect(audit.created_at).toBe(saved.updatedAt);
        expect(JSON.parse(audit.meta_json)).toMatchObject({ before: { revision: 0, segments: defaults }, after: { revision: 1, segments } });
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM activity_search_index WHERE source_event_id=?').bind(audit.id).first()).n).toBe(1);
        const reset = await m.saveAppearance({ DB }, admin, { revision: 1, segments: defaults });
        expect(reset.segments).toEqual(defaults); expect(reset.revision).toBe(2);
        expect((await DB.prepare('SELECT revision FROM model_pricing_state').first()).revision).toBe(0);
    } finally { DB.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('appearance rejects invalid scopes, personal activation and non-admin writes without changing storage', async () => {
    const m = await load(), DB = new SqliteD1Database(); applyAuthMigrations(DB);
    try {
        await expect(m.saveAppearance({ DB }, { id: 'member', role: 'user' }, { revision: 0, segments: defaults })).rejects.toMatchObject({ status: 403 });
        for (const input of [null, [], { revision: -1, segments: defaults }, { revision: 0, segments: { canvas: 'light' } },
            { revision: 0, segments: { ...defaults, canvas: 'auto' } }, { revision: 0, segments: { ...defaults, unknown: 'dark' } },
            { revision: 0, segments: defaults, personalEnabled: true }, { revision: 0, segments: defaults, updatedBy: 'someone-else' }]) {
            await expect(m.saveAppearance({ DB }, admin, input)).rejects.toMatchObject({ status: 400 });
        }
        expect((await DB.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key='appearance.global.v1'").first()).n).toBe(0);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first()).n).toBe(0);
    } finally { DB.close(); }
});

test('appearance concurrent writers cannot overwrite accepted settings or add a false audit entry', async () => {
    const m = await load(), DB = new SqliteD1Database(); applyAuthMigrations(DB);
    try {
        const outcomes = await Promise.allSettled([
            m.saveAppearance({ DB }, admin, { revision: 0, segments: { ...defaults, canvas: 'light' } }),
            m.saveAppearance({ DB }, { ...admin, id: 'other-admin' }, { revision: 0, segments: { ...defaults, admin: 'light' } }),
        ]);
        expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.find(value => value.status === 'rejected').reason).toMatchObject({ status: 409, code: 'appearance_conflict' });
        expect((await m.getAppearance({ DB })).revision).toBe(1);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first()).n).toBe(1);
        expect((await DB.prepare('SELECT COUNT(*) AS n FROM activity_search_index').first()).n).toBe(1);
    } finally { DB.close(); }
});

test('appearance audit failure rolls back settings; corrupt stored configuration fails closed', async () => {
    const m = await load(), DB = new SqliteD1Database(); applyAuthMigrations(DB);
    try {
        DB.exec("CREATE TRIGGER appearance_audit_failure BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT,'synthetic appearance audit failure'); END;");
        await expect(m.saveAppearance({ DB }, admin, { revision: 0, segments: { ...defaults, public: 'light' } })).rejects.toThrow(/synthetic appearance audit failure/);
        expect((await DB.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key='appearance.global.v1'").first()).n).toBe(0);
        expect((await m.getAppearance({ DB })).revision).toBe(0);
        await DB.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?)').bind(m.APPEARANCE_SETTING_KEY, '{broken', new Date().toISOString()).run();
        await expect(m.getAppearance({ DB })).rejects.toMatchObject({ status: 503 });
        await expect(m.saveAppearance({ DB }, admin, { revision: 0, segments: defaults })).rejects.toMatchObject({ status: 503 });
    } finally { DB.close(); }
});
