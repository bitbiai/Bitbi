const { DEFAULT_SEGMENTS } = require('../../js/shared/appearance-contract.js');
const fs = require('node:fs'), path = require('node:path');
const clone = value => JSON.parse(JSON.stringify(value));

function buildWavBuffer({ durationSeconds = 4, sampleRate = 8000 } = {}) {
  const samples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.floor(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 12000);
    buffer.writeInt16LE(sample, 44 + (i * bytesPerSample));
  }
  return buffer;
}


// Synthetic, local-only fixture shared by the Admin and segment browser cases.
// Writes other than the explicitly exercised appearance/Canvas edits fail closed.
async function setupAppearance(page, baseURL, { role = 'admin', adminGate = 0, segments = {}, appearance = null, media = false } = {}) {
    const { listCanvasModelsForRole } = await import('../../js/shared/canvas-model-contract.mjs');
    const projectId = '1'.repeat(32), nodeId = '2'.repeat(32), generatorId = '3'.repeat(32);
    const now = '2026-09-21T12:00:00.000Z';
    const { listAdminAiCatalog } = await import('../../js/shared/admin-ai-contract.mjs');
    const assets = media ? [
        { id: 'a'.repeat(32), asset_type: 'image', title: 'Colour study', mime_type: 'image/png', file_name: 'colour-study.png' },
        { id: 'b'.repeat(32), asset_type: 'video', title: 'Motion study', mime_type: 'video/mp4', file_name: 'motion-study.mp4' },
        { id: 'c'.repeat(32), asset_type: 'sound', title: 'Music sketch', mime_type: 'audio/wav', file_name: 'music-sketch.wav' },
    ].map(asset => ({ ...asset, folder_id: 'folder-theme', visibility: 'private', created_at: now, poster_status: 'ready',
        file_url: `/api/ai/${asset.asset_type === 'image' ? 'images' : 'text-assets'}/${asset.id}/file`,
        thumb_url: `/api/ai/images/${asset.id}/thumb`, poster_url: `/api/ai/text-assets/${asset.id}/poster` })) : [];
    const textModel = listCanvasModelsForRole(role).find(model => model.capability === 'text' && model.runnable);
    const state = {
        assets,
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
        if (pathname === '/api/admin/fable-chat-data/overview') return reply({ ok: true, statistics: { activeConversations: 0, deletedConversations: 0, visibleMessages: 0, completedTurns: 0, attempts: {} } });
        if (pathname === '/api/admin/ai/models') return reply({ ok: true, ...listAdminAiCatalog() });
        if (media && /^\/api\/ai\/(images|text-assets)\/[a-c]{32}\/(thumb|poster|medium|file)$/.test(pathname)) {
            if (pathname.includes('/text-assets/' + 'c'.repeat(32)) && pathname.endsWith('/file')) return route.fulfill({ contentType: 'audio/wav', body: buildWavBuffer() });
            const video = pathname.includes('/text-assets/' + 'b'.repeat(32)) && pathname.endsWith('/file');
            return route.fulfill({ contentType: video ? 'video/mp4' : 'image/png', body: fs.readFileSync(path.join(__dirname, '../fixtures/media/', video ? 'test-video-changing.mp4' : 'member-image.png')) });
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
        if (pathname === '/api/ai/folders') return nested({ folders: [{ id: 'folder-theme', name: 'Theme examples', asset_count: assets.length }], counts: { 'folder-theme': assets.length }, unfolderedCount: 0 });
        if (pathname === '/api/ai/assets' || pathname === '/api/ai/images') return nested({ assets: clone(assets), images: clone(assets.filter(a => a.asset_type === 'image')), has_more: false, next_cursor: null });
        if (pathname === '/api/ai/generation-jobs') return nested({ jobs: [] });
        if (method !== 'GET') { state.unexpectedWrites.push({ method, pathname }); return reply({ ok: false, error: 'Unmocked mutation' }, 400); }
        return reply({ ok: true, data: {}, stats: {}, items: [], news: [], enabled: false });
    });
    return state;
}

// Measure the rendered foreground over its ancestor-composited solid background.
// Callers deliberately use text/control surfaces, not images or gradient text.
async function measureContrast(locator) {
    return locator.evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => {
        const rgba = value => { const n = value.match(/[\d.]+/g).map(Number); return [n[0], n[1], n[2], n[3] ?? 1]; };
        const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
        const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
        const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
        let background = [255, 255, 255], opacity = 1;
        for (const node of ancestors) { const style = getComputedStyle(node); background = over(rgba(style.backgroundColor), background); opacity *= Number(style.opacity); }
        const style = getComputedStyle(el), foreground = rgba(style.color); foreground[3] *= opacity;
        const ink = luminance(over(foreground, background)), paper = luminance(background);
        return { selector: el.id || el.className, text: el.textContent.trim().slice(0, 90), ratio: (Math.max(ink, paper) + .05) / (Math.min(ink, paper) + .05), color: style.color, background, opacity };
    }));
}
module.exports = { setupAppearance, measureContrast };
