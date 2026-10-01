import { assistantDefaultSettings, callAssistantControl } from '../../workers/auth/src/lib/website-assistant-control.js';
// Loopback test-server adapter only. The production Auth handler uses its closed
// reviewed policy; these synthetic admission values never enter deploy artifacts.
import { createWebsiteAssistantHandler } from '../../workers/auth/src/routes/website-assistant.js';
import { knowledgeVersion } from '../../workers/shared/website-assistant-knowledge.mjs';
import { ASSISTANT_BUDGET_STORAGE_KEY } from '../../workers/auth/src/lib/website-assistant-budget.js';
import { harness } from './website-assistant-fixture.mjs';
import { testAssistantPolicy, testAssistantStream } from './website-assistant-policy.mjs';

const sessions = new Map();
function session(id) {
    if (!sessions.has(id)) {
        if (sessions.size >= 16) throw new Error('Fixture session bound reached');
        const state = harness();
        const tasks = [];
        let calls = 0;
        const env = { ...state.env, WEBSITE_ASSISTANT_ENABLED: 'true', AI: { async run(_model, params) {
            calls += 1;
            const german = params.messages[0].content.includes('Reply in German.');
            return testAssistantStream({ chunks: german
                ? ['Prüfen Sie die aktuelle Schätzung ', 'vor dem Generieren in Generate Lab.']
                : ['Check the current estimate ', 'before generating in Generate Lab.'] });
        } } };
        const ready = callAssistantControl(env, 'write', { revision: 0, settings: { ...assistantDefaultSettings(testAssistantPolicy(knowledgeVersion)), mode: 'public' }, actor: 'test-admin' }).then(result => { if (!result.ok) throw new Error('Synthetic control enable failed'); });
        sessions.set(id, { state, env, tasks, ready, calls: () => calls, handle: createWebsiteAssistantHandler({ policy: testAssistantPolicy(knowledgeVersion) }) });
    }
    return sessions.get(id);
}

export async function serveAssistantFixture(req, res, url) {
    if (req.headers['x-bitbi-assistant-fixture'] !== 'test-only') return false;
    if (!['/api/public/assistant/config', '/api/public/assistant/chat', '/__test/assistant-metrics'].includes(url.pathname)) return false;
    const id = req.headers['x-bitbi-assistant-fixture-id'];
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,50}$/.test(id)) { res.writeHead(400); res.end(); return true; }
    const fixture = session(id);
    await fixture.ready;
    if (url.pathname === '/__test/assistant-metrics') {
        await Promise.all(fixture.tasks);
        const ledger = await fixture.state.storage.get(ASSISTANT_BUDGET_STORAGE_KEY);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ providerCalls: fixture.calls(), measuredRequests: Object.values(ledger?.days || {}).reduce((sum, day) => sum + (day.measuredRequests || 0), 0) }));
        return true;
    }
    let body = '';
    for await (const chunk of req) { body += chunk.toString(); if (body.length > 20000) { res.writeHead(413); res.end(); return true; } }
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    const request = new Request(url, { method: req.method, headers: req.headers, signal: controller.signal,
        ...(body ? { body } : {}) });
    const response = await fixture.handle({ request, env: fixture.env, url, pathname: url.pathname,
        method: request.method, isSecure: false, execCtx: { waitUntil(task) { fixture.tasks.push(task); } } });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    // Preserve actual chunked SSE from the handler; do not turn it into a single
    // route.fulfill buffer. Cancellation reaches the handler's AbortSignal.
    const reader = response.body?.getReader();
    try {
        if (reader) while (!res.destroyed) {
            const value = await reader.read();
            if (value.done) break;
            res.write(value.value);
        }
        await Promise.all(fixture.tasks);
        if (!res.destroyed) res.end();
    } finally {
        await reader?.cancel().catch(() => {});
    }
    return true;
}
