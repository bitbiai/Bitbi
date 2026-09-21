const { DEFAULT_SEGMENTS } = require('../../js/shared/appearance-contract.js');
const clone = value => JSON.parse(JSON.stringify(value));

// Synthetic, local-only fixture shared by the Admin and segment browser cases.
// Writes other than the explicitly exercised appearance/Canvas edits fail closed.
async function setupAppearance(page, baseURL, { role = 'admin', adminGate = 0, segments = {}, appearance = null } = {}) {
    const { listCanvasModelsForRole } = await import('../../js/shared/canvas-model-contract.mjs');
    const projectId = '1'.repeat(32), nodeId = '2'.repeat(32), generatorId = '3'.repeat(32);
    const now = '2026-09-21T12:00:00.000Z';
    const textModel = listCanvasModelsForRole(role).find(model => model.capability === 'text' && model.runnable);
    const state = {
        appearance: appearance || { version: 1, revision: 0, segments: { ...DEFAULT_SEGMENTS, ...segments }, personalEnabled: false },
        calls: [], errors: [], saveFailure: 0, publicFailure: 0, unexpectedWrites: [], publicHolds: [],
        project: { id: projectId, title: 'Theme fixture', locale: 'en', created_at: now, updated_at: now },
        nodes: [
            { id: nodeId, project_id: projectId, type: 'text_prompt', title: 'Creative brief', x: 80, y: 80, config: {}, content: { text: 'A calm landscape' }, asset_id: null, output: null },
            { id: generatorId, project_id: projectId, type: 'text_generation', title: 'Prompt writer', x: 410, y: 80, model_id: textModel.id, config: { prompt: 'Keep the open draft', maxTokens: 500, textPurpose: 'image_prompt' }, content: {}, asset_id: null, output: null },
        ],
        edges: [{ id: '4'.repeat(32), project_id: projectId, source_node_id: nodeId, target_node_id: generatorId, source_port: 'text', target_port: 'input', config: {} }],
    };
    state.change = patch => { state.appearance = { ...state.appearance, revision: state.appearance.revision + 1, segments: { ...state.appearance.segments, ...patch }, updatedAt: now }; };
    state.holdPublic = () => {
        let release, reached;
        const completed = new Promise(resolve => { release = resolve; });
        const requested = new Promise(resolve => { reached = resolve; });
        state.publicHolds.push({ completed, reached });
        return { requested, release };
    };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
    await page.context().route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method(), pathname = url.pathname;
        if (url.origin !== new URL(baseURL).origin) return route.abort();
        if (!pathname.startsWith('/api/')) return route.continue();
        let body = null;
        try { body = request.postDataJSON(); } catch { /* a read has no JSON body */ }
        state.calls.push({ method, pathname, body });
        const reply = (data, status = 200) => route.fulfill({ json: data, status });
        const nested = data => reply({ ok: true, data });
        const user = role === 'anonymous' ? null : { id: 'appearance-owner', email: 'appearance@example.invalid', role, username: 'theme-review', displayName: 'Theme review' };
        if (pathname === '/api/appearance') {
            const snapshot = clone(state.appearance), hold = state.publicHolds.shift();
            if (hold) { hold.reached(); await hold.completed; }
            return state.publicFailure ? reply({ ok: false, error: 'Synthetic unavailable' }, state.publicFailure) : reply({ ok: true, appearance: snapshot });
        }
        if (pathname === '/api/me') return reply({ loggedIn: !!user, user });
        if (pathname === '/api/admin/me') return adminGate || role !== 'admin'
            ? reply({ ok: false, error: 'Admin access denied', code: adminGate === 428 ? 'admin_mfa_required' : 'forbidden' }, adminGate || (user ? 403 : 401))
            : reply({ ok: true, user });
        if (pathname === '/api/admin/appearance') {
            if (adminGate || role !== 'admin') return reply({ ok: false, error: 'Admin access denied' }, adminGate || (user ? 403 : 401));
            if (method === 'GET') return reply({ ok: true, appearance: clone(state.appearance) });
            if (method === 'PATCH') {
                if (state.saveFailure) return reply({ ok: false, error: 'Synthetic save failure' }, state.saveFailure);
                if (body.revision !== state.appearance.revision) return reply({ ok: false, code: 'appearance_conflict', error: 'Newer settings exist' }, 409);
                state.change(body.segments); return reply({ ok: true, appearance: clone(state.appearance) });
            }
        }
        if (pathname === '/api/model-pricing') return reply({ ok: true, revision: 0, rules: {} });
        if (pathname === '/api/wallet/status') return reply({ ok: true, linked: false });
        if (pathname === '/api/ai/quota') return reply({ ok: true, data: { isAdmin: role === 'admin', credits: 500, totalCredits: 500, remaining: 500, dailyLimit: 500, storage: { usedBytes: 0, limitBytes: 104857600, isUnlimited: false } } });
        if (pathname === '/api/account/credits-dashboard') return nested({ dashboard: { balance: { totalCredits: 500 } } });
        if (pathname === '/api/account/canvas/models') return nested({ models: listCanvasModelsForRole(role), organizations: [], selected_organization_id: null, access: { role, is_admin: role === 'admin' } });
        if (pathname === '/api/account/canvas/projects') return nested({ projects: [state.project], applied_limit: 50 });
        if (pathname === `/api/account/canvas/projects/${projectId}` && method === 'GET') return nested({ project: state.project, nodes: clone(state.nodes), edges: state.edges, runs: [] });
        const match = pathname.match(/^\/api\/account\/canvas\/projects\/([^/]+)\/nodes\/([^/]+)$/);
        if (match && method === 'PATCH') {
            const node = state.nodes.find(item => item.project_id === match[1] && item.id === match[2]);
            if (!node) return reply({ ok: false, error: 'Not found' }, 404);
            Object.assign(node, clone(body)); return nested({ node: clone(node) });
        }
        if (pathname === '/api/profile') return reply({ ok: true, user, profile: user, data: { profile: user, user } });
        if (pathname === '/api/ai/folders') return nested({ folders: [{ id: 'folder-theme', name: 'Theme examples', asset_count: 0 }] });
        if (pathname === '/api/ai/assets' || pathname === '/api/ai/images') return nested({ assets: [], images: [], has_more: false, next_cursor: null });
        if (pathname === '/api/ai/generation-jobs') return nested({ jobs: [] });
        if (method !== 'GET') { state.unexpectedWrites.push({ method, pathname }); return reply({ ok: false, error: 'Unmocked mutation' }, 400); }
        return reply({ ok: true, data: {}, stats: {}, items: [], news: [], enabled: false });
    });
    return state;
}

module.exports = { setupAppearance };
