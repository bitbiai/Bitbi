const { responseBytes } = require('./canvas-agent-ui.cjs');

async function voiceAttribution({ page, expect, c, DB, panel, transcript, de, requests }) {
    const { recordCanvasVoiceUserTurn, recordCanvasVoiceReply, markCanvasVoiceReplyInterrupted } = await import('../../workers/auth/src/lib/canvas-voice-conversation.js');
    const { sha256Hex } = await import('../../workers/auth/src/lib/tokens.js');
    const f = c.f, before = await c.read(), project = (await f.data(await f.request(f.projectPath))).project;
    const counts = async () => {
        const result = {};
        for (const table of ['canvas_agent_runs', 'canvas_agent_steps', 'member_ai_usage_attempts_v2', 'member_credit_ledger', 'canvas_nodes', 'canvas_runs']) result[table] = (await DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
        return result;
    };
    const initialCounts = await counts(), initialRequests = requests.length, initialCalls = c.calls.length;
    const scope = { userId: f.owner, projectId: f.project, sessionId: (await sha256Hex(f.project + ':voice-ui-provenance')).slice(0, 32) };
    const prefix = de ? 'Festgehalten.' : 'Noted.', text = prefix + (de ? ' Diesen weiteren Teil bestätigt die Wiedergabe nicht.' : ' Playback does not confirm this remaining part.');
    const reply = await f.atClock(async () => {
        const now = new Date().toISOString();
        await DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,state,conversation_revision,brief_revision,project_revision,settings_json,created_at,expires_at)
            VALUES(?,?,?,'active',?,?,?,'{}',?,?)`).bind(scope.sessionId, f.project, f.owner, before.revision, before.briefRevision, project.revision, now, new Date(Date.now() + 600000).toISOString()).run();
        const turn = await recordCanvasVoiceUserTurn(f.env, scope, { itemId: 'voice-ui-user', text: de ? 'Behalte die bereits geklärten Angaben.' : 'Keep the already confirmed details.' });
        return recordCanvasVoiceReply(f.env, scope, { turnId: turn.turnId, responseId: 'voice-ui-response', text, interrupted: false });
    });
    const replyId = reply.replyTurnId + ':reply', row = transcript.locator(`[data-message-id="${replyId}"]`);
    const readRendered = async () => {
        const received = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === c.route);
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        const response = await received, body = await response.json(); expect(response.status()).toBe(200); expect(body.ok).toBe(true);
        await expect(row).toBeVisible();
        return body.data.conversation.messages.find(message => message.id === replyId);
    };
    const complete = await readRendered();
    expect(complete).toMatchObject({ text, provenance: 'model', modelId: 'grok-voice-3.0', channel: 'voice', interrupted: false, playback: 'not_verified', delivery: { source: 'provider', stage: 'completed', blocking: false } });
    await expect(row).toHaveAttribute('data-kind', 'assistant'); await expect(row.locator('.canvas-agent__model-label')).toHaveText('grok-voice-3.0');
    await expect(row.locator('p').first()).toHaveText(text);
    await f.atClock(() => markCanvasVoiceReplyInterrupted(f.env, scope, { responseId: 'voice-ui-response', audioEndMs: 150 }));
    const interrupted = await readRendered();
    expect(interrupted).toMatchObject({ provenance: 'application', kind: 'voice_interruption', originalModelId: 'grok-voice-3.0', interrupted: true, playback: 'not_verified', delivery: { source: 'system', blocking: false } });
    await expect(row).toHaveAttribute('data-kind', 'system'); await expect(row.locator('.canvas-agent__system-label')).toHaveText(de ? 'Projekthinweis' : 'Project note');
    await expect(row.locator('p').first()).toHaveText(de ? 'Antwort unterbrochen; gesprochener Anteil nicht bestätigt.' : 'Reply interrupted; spoken portion not confirmed.');
    await expect(row.locator('.canvas-agent__model-label')).toHaveCount(0);
    await f.atClock(() => markCanvasVoiceReplyInterrupted(f.env, scope, { responseId: 'voice-ui-response', audioEndMs: 150, transcript: prefix }));
    const retained = await readRendered();
    expect(retained).toMatchObject({ text: prefix, provenance: 'model', modelId: 'grok-voice-3.0', interrupted: true, playback: 'not_verified', delivery: { source: 'provider', blocking: false } });
    await expect(row).toHaveAttribute('data-kind', 'assistant'); await expect(row.locator('.canvas-agent__model-label')).toHaveText('grok-voice-3.0');
    await expect(row.locator('p').first()).toHaveText(prefix); await expect(row.locator('.canvas-agent__system-label')).toHaveCount(0);
    const stored = await DB.prepare('SELECT assistant_text,run_id FROM canvas_agent_turns WHERE id=?').bind(reply.replyTurnId).first();
    expect(stored).toEqual({ assistant_text: text, run_id: null }); // No invented text-run receipt or rewritten provider evidence.
    expect(await counts()).toEqual(initialCounts); expect(c.calls).toHaveLength(initialCalls);
    expect(requests.slice(initialRequests).filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method))).toEqual([]);
    const after = await c.read(); expect(after.brief).toEqual(before.brief); expect(after.allowance).toEqual(before.allowance);
    expect((await f.data(await f.request(f.projectPath))).project.revision).toBe(project.revision);
    expect((await f.data(await f.request(f.route))).run.status).toBe('queued');
    await expect(panel.locator('.canvas-agent__messages')).toContainText(prefix);
}

module.exports = async ({ page, expect, locale, info, mockSharedAuth, createCanvasApiMock }) => {
    const { SqliteD1Database, applyAuthMigrations } = require('./sqlite-d1.js');
    const { createAuthTestEnv } = require('./auth-worker-harness.js');
    const { canvasAgentConversationFixture } = await import('./canvas-agent-conversation-control.mjs');
    const DB = new SqliteD1Database(); applyAuthMigrations(DB);
    const errors = [], requests = [], de = locale === 'de';
    try {
        const c = await canvasAgentConversationFixture({ ...createAuthTestEnv(), DB }, { scope: 'conversation-browser-' + locale, locale });
        const f = c.f;
        await DB.prepare('UPDATE canvas_projects SET locale=? WHERE id=?').bind(locale, f.project).run();
        await page.setViewportSize({ width: de ? 390 : 1440, height: 1000 });
        await mockSharedAuth(page,true,'user',f.owner); createCanvasApiMock(page); page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/account/canvas/**', async route => {
            const req = route.request(), url = new URL(req.url()), body = req.postData() ? req.postDataJSON() : undefined;
            const headers = {};
            for (const name of ['Idempotency-Key', 'X-Bitbi-Tariff-Revision']) if (req.headers()[name.toLowerCase()]) headers[name] = req.headers()[name.toLowerCase()];
            requests.push({ path: url.pathname, method: req.method(), body });
            const response = await f.request(url.pathname + url.search, req.method(), body, headers), bytes = await responseBytes(response);
            if (!page.isClosed()) await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: bytes });
        });
        const open = async () => { await page.goto(de ? '/de/canvas/' : '/canvas/'); await page.locator('#canvasAgentToggle').click(); };
        await open();
        const panel = page.locator('#canvasAgentPanel'), composer = panel.locator('.canvas-agent__composer');
        const showProject=()=>panel.getByRole('tab',{name:de?'Projekt & Produktion':'Project & production',exact:true}).click(),showChat=()=>panel.getByRole('tab',{name:de?'Gespräch':'Conversation',exact:true}).click();
        const input = composer.locator('textarea'), transcript = panel.locator('.canvas-agent__messages'), brief = panel.locator('.canvas-agent__brief');
        const submitMessage = async (text, pending = true) => {
            await showChat();await expect(input).toBeEnabled(); await input.fill(text);
            const accepted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/conversation/messages') && response.request().method() === 'POST');
            await composer.locator('button[type=submit]').click();
            const response = await accepted, body = await response.json();
            expect(response.status(), JSON.stringify(body)).toBe(202);
            if (pending) expect(body.data.conversation.pendingTurnId).toBeTruthy();
            else expect(body.data.conversation.pendingTurnId).toBe(null);
            await expect(transcript).toContainText(text);
        };
        const allowance = panel.locator('.canvas-agent__allowance');
        await panel.locator('.canvas-agent__approval-prompt').click();await expect(allowance.locator('[name=briefingBudget]')).not.toHaveValue('');
        await allowance.locator('[name=briefingBudget]').fill('3000');
        await allowance.getByRole('button', { name: de ? 'Dieses Gesprächsbudget freigeben' : 'Authorize this briefing allowance', exact: true }).click();
        await expect(allowance).toBeHidden();
        const initial = de ? 'Ein freundlicher Comicfilm über Hausbau, einen Pool mit Enten und ankommende Gäste.' : 'A friendly comic film about building a house, a duck pool and arriving visitors.';
        await submitMessage(initial);
        await expect(composer.locator('button[type=submit]')).toBeDisabled();
        expect(c.calls).toHaveLength(0);
        const firstRevision = (await f.data(await f.request(f.projectPath))).project.revision;
        // Closing the UI has no role in queue dispatch or completion. Two queue
        // deliveries and duplicate signed callbacks still represent one turn.
        await page.locator('#canvasAgentToggle').click();
        await c.deliver(); expect(c.calls).toHaveLength(1);
        await c.complete({ text: de ? 'Ein freundlicher Comicfilm passt dazu.' : 'A friendly comic style fits that story.', fields: { story: initial, style: 'comic' } });
        await c.deliver();
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        await expect(brief).toContainText(initial);
        await expect(transcript).toContainText(de ? 'Wie lang' : 'how long');
        expect((await f.data(await f.request(f.projectPath))).project.revision).toBe(firstRevision);
        const form = panel.locator('.canvas-agent__production-approval');
        await expect(form.locator('button[type=submit]')).toBeDisabled();
        expect(requests.filter(item => item.path.endsWith('/conversation/start'))).toEqual([]);
        await submitMessage(de ? 'Ungefähr zwei Minuten.' : 'About two minutes.');
        await expect(composer.locator('button[type=submit]')).toBeDisabled(); await c.deliver();
        await c.complete({ text: de ? 'Die Zieldauer ist ungefähr zwei Minuten.' : 'The target duration is about two minutes.' }); await c.deliver();
        await page.reload(); await page.locator('#canvasAgentToggle').click();
        await expect(brief).toContainText('120 s');
        expect((await c.read()).messages.filter(message => message.role === 'assistant' && /how long|Wie lang/.test(message.text))).toHaveLength(1);
        expect(c.calls).toHaveLength(2);
        await showProject();await panel.locator('.canvas-agent__manual-production > summary').click();await form.locator('[name=budget]').fill('5000'); await form.locator('[name=authorize]').check();
        const admitted = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/conversation/messages') && response.request().method() === 'POST' && /(?:Starte jetzt mit maximal|Start now with at most) 5000/.test(response.request().postDataJSON().text||''));
        await form.locator('button[type=submit]').click();
        expect((await admitted).status()).toBe(202);
        const production = requests.filter(item => item.path.endsWith('/conversation/messages') && /(?:Starte jetzt mit maximal|Start now with at most) 5000/.test(item.body?.text||''));
        expect(production).toHaveLength(1); expect(production[0].body.text).toMatch(/5000 [Cc]redits$/);
        const currentRun = (await f.data(await f.request(f.route))).run;
        expect(currentRun.status).toBe('queued');
        await submitMessage(de ? 'Wie weit bist du?' : 'How far along are you?', false);
        await expect(transcript).toContainText(de ? 'Produktion: vorgemerkt.' : 'Production: waiting.');
        await expect(transcript).toContainText(de ? 'Freigegebenes Projektlimit: 5000 Credits' : 'Authorized project cap: 5000 credits');
        await expect(transcript.locator('[data-kind=system]').last()).toContainText(de?'Stand:':'Observed:');
        expect((await f.data(await f.request(f.route))).run.status).toBe('queued');
        expect((await f.data(await f.request(f.projectPath))).project.revision).toBe(firstRevision);
        expect(c.calls).toHaveLength(2);
        expect(requests.filter(item => item.path.endsWith('/control') && item.body?.action === 'pause')).toEqual([]);
        await voiceAttribution({ page, expect, c, DB, panel, transcript, de, requests });
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await info.attach('persisted-conversation', { contentType: 'application/json', body: JSON.stringify({ syntheticInference: true, acceptedTurns: c.calls.length, source: 'authenticated routes + signed background callback + SQLite D1 adapter', duration: 120, productionAuthorized: true, statusQuestionDidNotPause: true, voiceProjection: ['complete:model', 'unknown-interruption:application', 'retained-prefix:model'], extraVoiceInference: 0, extraVoiceProduction: 0 }) });
    } finally { if (!page.isClosed()) await page.close(); DB.close(); }
};
