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
    const personalPreference = { version: 1, theme: 'light' };
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference })).toBe('dark');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference, personalEnabled: false })).toBe('dark');
    expect(contract.resolvePreference({ globalTheme: 'dark', personalPreference, personalEnabled: true })).toBe('light');
    expect(() => contract.normalizeAppearance({ version: 1, revision: 0, segments: defaults, personalEnabled: true })).toThrow();
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
