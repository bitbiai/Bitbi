import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CanvasVoiceRelay } from '../workers/auth/src/lib/canvas-voice-relay.js';
import { CanvasVoiceOwner } from '../workers/auth/src/lib/canvas-voice-owner.js';
import { canvasVoiceSettings } from '../js/shared/canvas-voice-settings.mjs';

function fixture(patch = {}, clock = {}) {
    const sent = [], upstream = [], calls = [], timers = [], closed = [];
    let time = 100000, authority = true;
    const services = { authorize: async () => authority, recordExposure: async e => calls.push(['exposure', e]),
        configuration: () => ({ type: 'session.update', session: { instructions: 'trusted' } }), verifyConfiguration: async session => { assert.equal(session.instructions, 'trusted'); },
        active: async () => calls.push(['active']), seedContext: async () => ({ type: 'conversation.item.create', item: { role: 'user', content: [] } }),
        userTurn: async value => { calls.push(['user', value]); return { id: value.itemId }; }, reply: async value => calls.push(['reply', structuredClone(value)]),
        tool: async value => { calls.push(['tool', value]); return { ok: true }; }, response: () => ({ type: 'response.create' }),
        interrupted: async value => calls.push(['interrupted', value]), ended: async value => calls.push(['ended', value]), ...patch };
    const relay = new CanvasVoiceRelay({ client: { send: raw => sent.push(JSON.parse(raw)), close: () => closed.push('client') },
        provider: { send: raw => upstream.push(raw instanceof ArrayBuffer ? raw : JSON.parse(raw)), close: () => closed.push('provider') },
        session: { id: 'session', expiresAt: new Date(time + 60000).toISOString(), settings: canvasVoiceSettings({ tools: { canvas: { enabled: true } } }) }, services,
        now: () => time, setTimer: callback => { timers.push(callback); return 1; }, clearTimer: clock.clearTimer || (() => {}) });
    const provider = event => relay.providerMessage(JSON.stringify(event));
    return { relay, sent, upstream, calls, closed, timers, provider, client: event => relay.clientMessage(JSON.stringify(event)),
        advance: ms => { time += ms; }, revoke: () => { authority = false; },
        ready: async () => { await provider({ type: 'session.created', session: { id: 'session_1' } }); await provider({ type: 'conversation.created', conversation: { id: 'conversation_1' } }); await provider({ type: 'session.updated', session: { instructions: 'trusted' } }); } };
}
test('only own conversation projections bridge a known presented context, never a changed semantic fence', () => {
    const owner = new CanvasVoiceOwner({}, {}), a = { revision: 5 };
    const context = { conversationRevision: 5, briefRevision: 2, projectRevision: 7 };
    const args = { expectedConversationRevision: 5, expectedBriefRevision: 2, expectedProjectRevision: 7 };
    owner.presentContext(a, context); owner.adoptRevision(a, { conversationRevision: 6 }, false, true);
    owner.adoptRevision(a, { conversationRevision: 7 }, false, true);
    assert.equal(owner.toolConversationRevision(a, args), 7);
    for (const patch of [{ expectedConversationRevision: 6 }, { expectedConversationRevision: 999 }, { expectedBriefRevision: 1 }, { expectedProjectRevision: 6 }])
        assert.equal(owner.toolConversationRevision(a, { ...args, ...patch }), undefined);
    owner.adoptRevision(a, { conversationRevision: 8 });
    assert.equal(owner.toolConversationRevision(a, args), undefined, 'A non-projection write invalidates the old context fence');
    assert.throws(() => owner.presentContext(a, context), error => error.code === 'canvas_voice_context_changed');
});
test('tool outcomes expose only fixed diagnostic fields on the existing change event', async () => {
    for (const [result, expected] of [[{ ok: true, data: { private: 'content' } }, { name: 'canvas_context', ok: true }],
        [{ ok: false, code: 'canvas_agent_conversation_changed', private: 'content' }, { name: 'canvas_context', ok: false, code: 'canvas_agent_conversation_changed' }],
        [{ ok: false, code: 'private_provider_token', private: 'content' }, { name: 'canvas_context', ok: false, code: 'canvas_voice_tool_failed' }]]) {
        const f = fixture({ tool: async () => result }); await f.ready();
        await f.provider({ type: 'response.created', response: { id: 'context_response' } });
        await f.provider({ type: 'response.function_call_arguments.done', response_id: 'context_response', call_id: 'context_call', name: 'canvas_context', arguments: '{}' });
        assert.deepEqual(f.sent.at(-1), { type: 'voice.changed', tool: expected });
        assert.equal(JSON.stringify(f.sent).includes('private'), false); await f.relay.stop();
    }
});
test('either startup event configures once; duplicate and reordered startup history cannot execute actions', async () => {
    const startup = [
        { type: 'session.created', session: { id: 'session_1' } },
        { type: 'conversation.created', conversation: { id: 'conversation_1' } },
    ];
    for (const first of [0, 1]) {
        const f = fixture();
        await f.provider({ ...startup[first], event_id: 'first' });
        assert.equal(f.upstream.filter(event => event.type === 'session.update').length, 1, 'The first startup event sends configuration without waiting for the other');
        for (const type of ['conversation.item.added', 'conversation.item.created']) {
            await f.provider({ type, item: { id: 'historical_tool', type: 'function_call', name: 'canvas_update_brief', arguments: '{"private":"ignored"}' } });
        }
        await f.provider({ ...startup[first], event_id: 'first' });
        await f.provider({ ...startup[1 - first], event_id: 'other_startup' });
        await f.provider({ ...startup[first], event_id: 'new_duplicate' });
        assert.equal(f.relay.active, false); assert.equal(f.calls.length, 0);
        await f.provider({ type: 'session.updated', session: { instructions: 'trusted' } });
        await f.provider({ ...startup[first], event_id: 'late_duplicate' });
        assert.equal(f.relay.active, true); assert.equal(f.relay.closed, false);
        assert.equal(f.upstream.filter(event => event.type === 'session.update').length, 1);
        assert.equal(f.upstream.filter(event => event.type === 'response.create').length, 0);
        assert.equal(f.calls.filter(call => call[0] === 'active').length, 1);
        assert.equal(f.calls.some(call => ['tool', 'user', 'reply', 'exposure'].includes(call[0])), false);
        await f.relay.stop();
    }
});
test('observed JSON ping is inert before and after acknowledgement and never extends the session', async () => {
    assert.equal(createHash('sha256').update('ping').digest('hex').slice(0, 16), '758d61f26a444483', 'Matches the retained live startup type fingerprint');
    const f = fixture(), deadline = f.relay.deadline, activity = f.relay.lastInputAt;
    const ping = { type: 'ping', event_id: 'heartbeat_1', data: { type: 'session.updated', instructions: 'private' },
        name: 'canvas_update_brief', arguments: '{"private":"must not execute"}', audio: 'AAA=' };
    await f.provider(ping); await f.provider(ping);
    assert.equal(f.relay.active, false); assert.equal(f.relay.configurationSent, false);
    assert.equal(f.upstream.length, 0); assert.equal(f.sent.length, 0); assert.equal(f.calls.length, 0);
    await f.provider({ type: 'session.created' }); f.advance(1000);
    await f.provider({ ...ping, event_id: 'heartbeat_2' });
    assert.equal(f.relay.active, false); assert.equal(f.upstream.length, 1); assert.equal(f.calls.length, 0);
    await f.provider({ type: 'session.updated', session: { instructions: 'trusted' } });
    const prior = JSON.stringify({ sent: f.sent, upstream: f.upstream, calls: f.calls });
    f.advance(59000); await f.provider({ ...ping, event_id: 'heartbeat_3' });
    assert.equal(JSON.stringify({ sent: f.sent, upstream: f.upstream, calls: f.calls }), prior);
    assert.equal(f.relay.active, true); assert.equal(f.relay.lastInputAt, activity);
    assert.equal(f.relay.deadline, deadline); assert.equal(f.timers.length, 1);
    assert.equal(f.relay.inputSamples, 0); assert.equal(f.relay.outputBytes, 0);
    f.timers[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.relay.closed, true); assert.equal(f.calls.at(-1)[1].code, 'canvas_voice_session_limit');
    assert.equal(f.upstream.some(event => event.type === 'pong' || event.type === 'response.create'), false);
    assert.equal(JSON.stringify(f.sent).includes('private'), false);
});
test('pre-ack audio, tools and unknown events remain fenced with content-free diagnostic categories', async () => {
    const cases = [
        [{ type: 'response.output_audio.delta', delta: 'AAA=' }, 'audio_delta'],
        [{ type: 'response.function_call_arguments.done', arguments: '{"private":"do not log"}' }, 'function_call'],
        [{ type: 'input_audio_buffer.cleared' }, 'input_cleared'],
    ];
    for (const [event, category] of cases) {
        const f = fixture(); await f.provider({ type: 'conversation.created', conversation: { id: 'conversation_1' } });
        await f.provider(event);
        assert.equal(f.relay.closed, true); assert.equal(f.relay.active, false);
        assert.equal(f.calls.at(-1)[1].code, 'canvas_voice_provider_not_ready_' + category);
        assert.equal(f.sent.at(-1).code, 'canvas_voice_configuration_unconfirmed');
        assert.equal(f.calls.some(call => ['tool', 'user', 'reply', 'exposure', 'active'].includes(call[0])), false);
        assert.equal(f.sent.some(message => message.type === 'voice.audio'), false);
        assert.equal(JSON.stringify(f.sent).includes('private'), false);
        await f.provider({ type: 'session.updated', session: { instructions: 'trusted' } });
        assert.equal(f.relay.active, false, 'A late acknowledgement cannot resurrect the failed session');
    }
    for (const event of [{ type: 'conversation.created', conversation: { id: 'bad id' } },
        { type: 'session.updated', session: { instructions: 'trusted' } }]) {
        const f = fixture(); await f.provider(event);
        assert.equal(f.relay.closed, true); assert.equal(f.relay.active, false); assert.equal(f.upstream.length, 0);
    }
});
test('unexpected startup frames retain only fixed envelope facts and a type digest, never private fields', async () => {
    const privateType = 'private_provider_token_and_type';
    const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
    const cases = [
        [{ error: { code: 'permission-denied', message: 'private provider detail' } }, 'o_m_k04_n0_rpermission'],
        [{ type: privateType, message: 'private content' }, `o_s_k10_n0_rnone_h${digest(privateType)}`],
        [{ type: '__proto__' }, `o_s_k00_n0_rnone_h${digest('__proto__')}`],
        [{ type: 'pong' }, `o_s_k00_n0_rnone_h${digest('pong')}`],
        [{ type: 'ping.extra' }, `o_s_k00_n0_rnone_h${digest('ping.extra')}`],
        [{ type: ['session.created'], data: { type: 'session.updated', secret: 'private context' } }, 'o_n_k01_n13_rnone'],
        [{ type: null, event: 'session.created' }, 'o_n_k02_n21_rnone'],
        [{ data: { type: 'private nested token' }, event: { type: 'conversation.created' } }, 'o_m_k03_n22_rnone'],
        [{ data: {}, event: {}, error: {}, code: 'private', message: 'private', session: {}, conversation: {} }, 'o_m_k7f_n0_rnone'],
        [JSON.parse('{"__proto__":{"type":"session.created"},"constructor":"private"}'), 'o_m_k00_n0_rnone'],
        [{ type: privateType, error: 'The model private-model does not exist or your team has no access' }, `o_s_k04_n0_rmodel_access_h${digest(privateType)}`],
        [[], 'a_m_k00_n0_rnone'], [null, 'p_m_k00_n0_rnone'], ['private primitive', 'p_m_k00_n0_rnone'], [17, 'p_m_k00_n0_rnone'],
    ];
    for (const configured of [false, true]) for (const [event, suffix] of cases) {
        const f = fixture();
        if (configured) await f.provider({ type: 'session.created' });
        await f.provider(event);
        const code = `canvas_voice_provider_not_ready_u_s${configured ? 1 : 0}a0_${suffix}`;
        assert.equal(f.calls.at(-1)[1].code, code); assert.match(code, /^[a-z0-9_]{1,100}$/);
        assert.equal(f.sent.at(-1).code, 'canvas_voice_configuration_unconfirmed');
        assert.equal(f.relay.closed, true); assert.equal(f.relay.active, false);
        assert.equal(JSON.stringify(f.sent).includes('private'), false); assert.equal(JSON.stringify(f.calls).includes('private'), false);
        assert.equal(f.calls.some(call => ['tool', 'user', 'reply', 'exposure', 'active'].includes(call[0])), false);
        assert.equal(f.upstream.length, configured ? 1 : 0, 'No wrapper is unwrapped into configuration or a paid response');
        await f.provider(event); await f.provider({ type: 'session.updated', session: { instructions: 'trusted' } });
        assert.equal(f.calls.filter(call => call[0] === 'ended').length, 1); assert.equal(f.relay.active, false);
        assert.deepEqual(f.closed, ['provider', 'client']);
    }
});
test('configuration diagnostics retain their safe receipt code while the browser receives the localized category', async () => {
    const code = 'canvas_voice_configuration_unconfirmed_audio_input_format_rate_value';
    const f = fixture({ verifyConfiguration: async () => { throw Object.assign(new Error('private provider detail'), { code }); } });
    await f.provider({ type: 'session.created' }); await f.provider({ type: 'session.updated', session: {} });
    assert.equal(f.relay.closed, true); assert.equal(f.relay.active, false);
    assert.equal(f.calls.at(-1)[1].code, code); assert.equal(f.sent.at(-1).code, 'canvas_voice_configuration_unconfirmed');
    assert.equal(JSON.stringify(f.sent).includes('private'), false);
    assert.equal(f.calls.some(call => ['tool', 'user', 'reply', 'exposure', 'active'].includes(call[0])), false);
});
test('native timer receiver and failed timer cleanup cannot strand accepted sockets or settlement', async () => {
    for (const broken of [false, true]) {
        let called = 0;
        const f = fixture({}, { clearTimer: function () {
            called++; assert.equal(this, undefined, 'Native timer is invoked without the relay receiver');
            if (broken) throw new TypeError('Synthetic native timer cleanup failure');
        } });
        await f.ready(); await f.client({ type: 'voice.stop', sequence: 0 }); await f.relay.stop();
        assert.equal(called, 1); assert.deepEqual(f.closed, ['provider', 'client']);
        assert.equal(f.sent.at(-1).type, 'voice.ended'); assert.equal(f.calls.filter(call => call[0] === 'ended').length, 1);
    }
});
test('server owns configuration; missing ack, forged instructions and changed authority fail closed', async () => {
    const f = fixture(); await f.provider({ type: 'session.created', session: { id: 'session_1' } });
    assert.equal(f.sent.length, 0); assert.equal(f.upstream[0].session.instructions, 'trusted');
    await f.provider({ type: 'session.updated', session: { instructions: 'forged' } });
    assert.deepEqual(f.closed, ['provider', 'client']);
    const g = fixture(); await g.ready(); g.revoke();
    await g.client({ type: 'audio.append', sequence: 0, audio: 'AAA=' });
    assert.equal(g.upstream.filter(e => e.type === 'input_audio_buffer.append').length, 0);
});
test('duplicate sequence is idempotent; conflicting replay cannot forward more audio', async () => {
    const f = fixture(); await f.ready(); const event = { type: 'audio.append', sequence: 0, audio: 'AAA=' };
    await f.client(event); await f.client(event);
    assert.equal(f.upstream.filter(e => e.type === 'input_audio_buffer.append').length, 1);
    await f.client({ ...event, audio: 'AQI=' }); assert.equal(f.relay.closed, true);
});
test('browser cannot set policy/tools, call a tool, or flood unbounded audio', async () => {
    for (const type of ['session.update', 'response.create', 'conversation.item.create', 'tool.call']) {
        const f = fixture(); await f.ready(); await f.client({ type, sequence: 0 });
        assert.equal(f.relay.closed, true); assert.equal(f.calls.some(c => c[0] === 'tool'), false);
    }
    const f = fixture(); await f.ready();
    for (let sequence = 0; sequence < 3; sequence++) await f.client({ type: 'audio.append', sequence, audio: Buffer.alloc(48000).toString('base64') });
    assert.equal(f.relay.closed, true); assert.equal(f.calls.filter(c => c[0] === 'exposure').length, 2);
});
test('cumulative interim transcription replaces rather than appends; replay does not duplicate a saved turn', async () => {
    const f = fixture(); await f.ready(); await f.provider({ type: 'input_audio_buffer.committed', item_id: 'audio_1' });
    for (const transcript of ['Ein', 'Ein Katzenvideo']) await f.provider({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'audio_1', transcript });
    const done = { type: 'conversation.item.input_audio_transcription.completed', event_id: 'event_done', item_id: 'audio_1', transcript: 'Ein Katzenvideo' };
    await f.provider(done); await f.provider(done);
    assert.equal(f.sent.filter(e => e.type === 'voice.transcript').at(-1).text, 'Ein Katzenvideo');
    assert.equal(f.calls.filter(c => c[0] === 'user').length, 1);
});
test('a transcript needs its matching audio commit and latest completion, in either order', async () => {
    for (const order of ['transcript_first', 'commit_first', 'interim_after_completion']) {
        const f = fixture(); await f.ready();
        const final = { type: 'conversation.item.input_audio_transcription.completed', item_id: 'utterance', transcript: 'Ich möchte ein Katzenvideo.' };
        const commit = { type: 'input_audio_buffer.committed', item_id: 'utterance' };
        if (order === 'transcript_first') await f.provider(final);
        else if (order === 'commit_first') await f.provider(commit);
        else {
            await f.provider({ ...final, transcript: 'Ich möch' });
            await f.provider({ ...final, type: 'conversation.item.input_audio_transcription.updated' });
            await f.provider(commit);
        }
        assert.equal(f.calls.some(call => call[0] === 'user'), false, order + ': provisional captions cannot change the conversation');
        assert.equal(f.sent.some(event => event.type === 'voice.changed'), false);
        await f.provider(order === 'transcript_first' ? commit : final);
        await f.provider({ ...commit, event_id: 'duplicate_commit' });
        await f.provider({ ...final, event_id: 'duplicate_final' });
        assert.deepEqual(f.calls.filter(call => call[0] === 'user'), [['user', { itemId: 'utterance', text: 'Ich möchte ein Katzenvideo.' }]]);
        assert.equal(f.sent.filter(event => event.type === 'voice.changed').length, 1);
        assert.equal(f.relay.closed, false); await f.relay.stop();
    }
});
test('abandoned pre-commit captions do not become turns and repeated old commits do not rebind a later response', async () => {
    const f = fixture(); await f.ready();
    await f.provider({ type: 'input_audio_buffer.speech_started', item_id: 'abandoned' });
    await f.provider({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'abandoned', transcript: 'Ich möch' });
    await f.provider({ type: 'input_audio_buffer.speech_stopped', item_id: 'abandoned' });
    await f.provider({ type: 'input_audio_buffer.speech_started', item_id: 'first' });
    await user(f, 'first'); await user(f, 'second');
    await f.provider({ type: 'input_audio_buffer.committed', item_id: 'first', event_id: 'old_commit_replay' });
    await f.provider({ type: 'response.output_item.added', response_id: 'answer', item: { type: 'message', id: 'answer_item' } });
    await f.provider({ type: 'response.output_audio_transcript.delta', response_id: 'answer', delta: 'Welcher Stil?' });
    await f.provider({ type: 'response.done', response: { id: 'answer', status: 'completed' } });
    assert.deepEqual(f.calls.filter(call => call[0] === 'user').map(call => call[1].itemId), ['first', 'second']);
    assert.equal(f.calls.find(call => call[0] === 'reply')[1].turn.id, 'second');
    await f.relay.stop();
});
test('different text after final publication still reaches the immutable canonical replay guard', async () => {
    const saved = new Map(), attempts = [];
    const f = fixture({ userTurn: async input => {
        attempts.push({ ...input });
        if (saved.has(input.itemId) && saved.get(input.itemId) !== input.text) throw Object.assign(new Error('idempotency_conflict'), { code: 'idempotency_conflict' });
        saved.set(input.itemId, input.text); return { id: input.itemId };
    } });
    await f.ready(); await user(f, 'immutable');
    await f.provider({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'immutable', transcript: 'Different private content' });
    assert.equal(attempts.length, 2); assert.equal(saved.get('immutable'), 'Ein Katzenvideo');
    assert.equal(f.relay.closed, true); assert.equal(f.calls.at(-1)[1].code, 'idempotency_conflict');
    assert.equal(f.sent.at(-1).code, 'idempotency_conflict');
    assert.equal(JSON.stringify(f.calls).includes('Different private'), false);
});
test('pending transcript storage stays bounded and stopping cannot publish provisional captions', async () => {
    for (const kind of ['commit', 'transcript']) {
        const f = fixture(); await f.ready();
        for (let index = 0; index < 80; index++) await f.provider(kind === 'commit'
            ? { type: 'input_audio_buffer.committed', item_id: 'item_' + index }
            : { type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_' + index, transcript: 'Provisional' });
        assert.equal(f.relay.closed, false); assert.equal(f.relay.latestTranscript.size, 80);
        await f.provider({ type: 'input_audio_buffer.committed', item_id: 'over_limit' });
        assert.equal(f.relay.closed, true); assert.equal(f.calls.at(-1)[1].code, 'canvas_voice_turn_limit');
        assert.equal(f.relay.latestTranscript.size, 0); assert.equal(f.calls.some(call => call[0] === 'user'), false);
    }
    const f = fixture(); await f.ready();
    await f.provider({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'pending', transcript: 'Not committed' });
    await f.relay.stop(); await f.provider({ type: 'input_audio_buffer.committed', item_id: 'pending' });
    assert.equal(f.relay.latestTranscript.size, 0); assert.equal(f.calls.some(call => call[0] === 'user'), false);
});
test('late input transcription binds the response to its source, never an older user turn', async () => {
    const f = fixture(); await f.ready(); await f.provider({ type: 'input_audio_buffer.committed', item_id: 'audio_2' });
    await f.provider({ type: 'response.output_item.added', response_id: 'response_2', item: { type: 'message', id: 'answer_2' } });
    await f.provider({ type: 'response.output_audio_transcript.delta', response_id: 'response_2', delta: 'Welcher Stil?' });
    await f.provider({ type: 'response.done', response: { id: 'response_2' } });
    assert.equal(f.calls.some(c => c[0] === 'reply'), false);
    await f.provider({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'audio_2', transcript: 'Ein Katzenvideo' });
    assert.equal(f.calls.find(c => c[0] === 'reply')[1].turn.id, 'audio_2');
});
test('timeout_triggered asks rather than terminates; server deadline still closes without browser cooperation', async () => {
    const f = fixture(); await f.ready(); await f.provider({ type: 'input_audio_buffer.timeout_triggered' });
    assert.equal(f.relay.closed, false); assert.equal(f.sent.at(-1).state, 'processing');
    f.advance(60000); f.timers[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.relay.closed, true); assert.equal(f.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_session_limit');
});
test('interrupt truncates only matching response, late audio is dropped, stop is once', async () => {
    const f = fixture(); await f.ready(); await f.provider({ type: 'response.output_item.added', response_id: 'r1', item: { type: 'message', id: 'i1' } });
    await f.client({ type: 'voice.interrupt', sequence: 0, responseId: 'other', itemId: 'i1', audioEndMs: 0 });
    assert.equal(f.calls.some(c => c[0] === 'interrupted'), false);
    await f.client({ type: 'voice.interrupt', sequence: 1, responseId: 'r1', itemId: 'i1', audioEndMs: 200 });
    await f.provider({ type: 'response.output_audio.delta', response_id: 'r1', item_id: 'i1', delta: 'AAA=' });
    assert.equal(f.sent.some(e => e.type === 'voice.audio'), false);
    assert.equal(f.upstream.find(e => e.type === 'conversation.item.truncate').audio_end_ms, 200);
    await f.relay.stop(); await f.relay.stop(); assert.equal(f.calls.filter(c => c[0] === 'ended').length, 1);
    await f.client({ type: 'audio.append', sequence: 2, audio: 'AAA=' });
    assert.equal(f.upstream.some(e => e.type === 'input_audio_buffer.append'), false);
});

async function user(f, itemId) {
    await f.provider({ type: 'input_audio_buffer.committed', item_id: itemId });
    await f.provider({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, transcript: 'Ein Katzenvideo' });
}
const toolCall = (callId, responseId, eventId = callId) => ({ type: 'response.function_call_arguments.done',
    event_id: eventId, response_id: responseId, call_id: callId, name: 'canvas_update_brief', arguments: '{}' });

test('parallel tools complete once before one continuation; call replay has no new action or response', async () => {
    const f = fixture(); await f.ready(); await user(f, 'u1');
    await f.provider({ type: 'response.created', response: { id: 'r1' } });
    await f.provider(toolCall('c1', 'r1', 'e1')); await f.provider(toolCall('c1', 'r1', 'e2'));
    await f.provider(toolCall('c2', 'r1', 'e3'));
    assert.equal(f.calls.filter(c => c[0] === 'tool').length, 2);
    assert.equal(f.upstream.filter(e => e.type === 'response.create').length, 0);
    await f.provider({ type: 'response.done', event_id: 'done1', response: { id: 'r1', status: 'completed' } });
    const outputs = f.upstream.filter(e => e.item?.type === 'function_call_output');
    assert.deepEqual(outputs.map(e => e.item.call_id), ['c1', 'c2']);
    assert.equal(f.upstream.filter(e => e.type === 'response.create').length, 1);
    assert.ok(f.upstream.indexOf(outputs[1]) < f.upstream.findIndex(e => e.type === 'response.create'));
    await f.provider(toolCall('c1', 'r1', 'late_replay'));
    await f.provider({ type: 'response.done', event_id: 'done2', response: { id: 'r1', status: 'completed' } });
    assert.equal(f.calls.filter(c => c[0] === 'tool').length, 2);
    assert.equal(f.upstream.filter(e => e.type === 'response.create').length, 1);
    assert.equal(f.relay.closed, false);
});

test('late function call retains the original response source, and conflicting call replay fails closed', async () => {
    const f = fixture(); await f.ready(); await user(f, 'u1');
    await f.provider({ type: 'response.created', response: { id: 'r1' } });
    await user(f, 'u2'); await f.provider(toolCall('c1', 'r1'));
    assert.equal(f.calls.find(c => c[0] === 'tool')[1].turn.id, 'u1');
    await f.provider({ ...toolCall('c1', 'r1', 'e_conflict'), arguments: '{"changed":true}' });
    assert.equal(f.calls.filter(c => c[0] === 'tool').length, 1);
    assert.equal(f.relay.closed, true);
});

test('queued traffic is bounded before asynchronous authority checks finish', async () => {
    for (const source of ['client', 'provider']) {
        let release; const wait = new Promise(resolve => { release = resolve; });
        const f = fixture({ authorize: () => wait });
        const pending = Array.from({ length: 65 }, (_, sequence) => source === 'client'
            ? f.client({ type: 'voice.mute', sequence, muted: true }) : f.provider({ type: 'ping', event_id: 'heartbeat_' + sequence }));
        assert.equal(f.relay.closed, true);
        assert.equal(f.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_backpressure_count');
        assert.equal(f.sent.at(-1).code, 'canvas_voice_backpressure');
        release(true); await Promise.all(pending);
        assert.equal(f.upstream.length, 0);
        const g = fixture();
        await g.relay[source + 'Message']('x'.repeat(280001));
        assert.equal(g.relay.closed, true);
        assert.equal(g.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_backpressure_frame');
        assert.equal(g.sent.at(-1).code, 'canvas_voice_backpressure');
        const h = fixture({ authorize: () => wait });
        const frames = Array.from({ length: 9 }, () => h.relay[source + 'Message']('x'.repeat(130000)));
        assert.equal(h.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_backpressure_bytes');
        assert.equal(h.sent.at(-1).code, 'canvas_voice_backpressure');
        await Promise.all(frames);
    }
});

test('cancelled or incomplete responses are never persisted as fully heard completion', async () => {
    for (const status of ['cancelled', 'incomplete', 'failed']) {
        const f = fixture(); await f.ready(); await user(f, 'u1');
        await f.provider({ type: 'response.output_item.added', response_id: 'r1', item: { type: 'message', id: 'a1' } });
        await f.provider({ type: 'response.output_audio_transcript.delta', response_id: 'r1', delta: 'Unfinished answer' });
        await f.provider({ type: 'response.done', response: { id: 'r1', status } });
        assert.equal(f.calls.find(c => c[0] === 'reply')[1].interrupted, true, status);
    }
});

test('late acknowledged truncation remains correlated after reply persistence and excludes unheard text', async () => {
    const f = fixture(); await f.ready(); await user(f, 'u1');
    await f.provider({ type: 'response.output_item.added', response_id: 'r1', item: { type: 'message', id: 'a1' } });
    await f.provider({ type: 'response.output_audio_transcript.delta', response_id: 'r1', delta: 'Heard introduction and unheard tail' });
    await f.provider({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    const original = structuredClone(f.calls.find(c => c[0] === 'reply')[1]);
    await f.client({ type: 'voice.interrupt', sequence: 0, responseId: 'r1', itemId: 'a1', audioEndMs: 200 });
    const acknowledged = { type: 'conversation.item.truncated', event_id: 'truncate_ack', item_id: 'a1', content_index: 0,
        audio_end_ms: 200, transcript: 'Heard introduction' };
    await f.provider(acknowledged); await f.provider(acknowledged);
    const projection = f.calls.filter(c => c[0] === 'interrupted' && c[1].transcript !== undefined);
    assert.equal(projection.length, 1);
    assert.equal(projection[0][1].responseId, 'r1');
    assert.equal(projection[0][1].transcript, 'Heard introduction');
    assert.equal(projection[0][1].audioEndMs, 200);
    assert.deepEqual(f.calls.find(c => c[0] === 'reply')[1], original, 'original received response remains immutable');
});

test('stopping during asynchronous configuration acknowledgement cannot reactivate a session', async () => {
    let release; const wait = new Promise(resolve => { release = resolve; });
    const f = fixture({ verifyConfiguration: () => wait });
    await f.provider({ type: 'session.created', session: { id: 'session_1' } });
    const pending = f.provider({ type: 'session.updated', session: { instructions: 'trusted' } });
    await new Promise(resolve => setImmediate(resolve));
    await f.relay.stop('canvas_voice_stopped'); release(); await pending;
    assert.equal(f.calls.some(c => c[0] === 'active'), false);
    assert.equal(f.relay.active, false);
    assert.deepEqual(f.upstream.map(event => event.type), ['session.update']);
});

test('documented audio and text aliases follow the same associated-response validation', async () => {
    const f = fixture(); await f.ready(); await user(f, 'u1');
    await f.provider({ type: 'response.output_item.added', response_id: 'r1', item: { type: 'message', id: 'a1' } });
    await f.provider({ type: 'response.audio.delta', response_id: 'r1', item_id: 'a1', delta: 'AAA=' });
    await f.provider({ type: 'response.output_text.delta', response_id: 'r1', delta: 'Welcher Stil?' });
    await f.provider({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    assert.equal(f.sent.find(event => event.type === 'voice.audio')?.audio, 'AAA=');
    assert.equal(f.calls.find(call => call[0] === 'reply')?.[1].text, 'Welcher Stil?');
    await f.provider({ type: 'response.audio.delta', response_id: 'foreign', item_id: 'a1', delta: 'AAA=' });
    assert.equal(f.relay.closed, true);
    assert.equal(f.sent.filter(event => event.type === 'voice.audio').length, 1);
});

test('manual commits require new audio and cannot multiply responses while the same turn is pending', async () => {
    const empty = fixture(); empty.relay.session.settings.turn_detection.type = null; await empty.ready();
    await empty.client({ type: 'audio.commit', sequence: 0 });
    assert.equal(empty.upstream.filter(event => event.type === 'response.create').length, 0, 'empty commit creates no paid response');
    assert.deepEqual(empty.sent.at(-1), { type: 'voice.turn', state: 'ready', reason: 'no_new_audio' });
    const f = fixture(); f.relay.session.settings.turn_detection.type = null; await f.ready();
    await f.client({ type: 'audio.append', sequence: 0, audio: Buffer.alloc(4800).toString('base64') });
    await f.client({ type: 'audio.commit', sequence: 1 });
    assert.deepEqual(f.sent.at(-1), { type: 'voice.turn', state: 'pending' });
    assert.equal(f.upstream.filter(event => event.type === 'response.create').length, 0, 'provider must acknowledge committed audio first');
    await f.provider({ type: 'input_audio_buffer.committed', item_id: 'u1' });
    assert.equal(f.upstream.filter(event => event.type === 'response.create').length, 1);
    await f.client({ type: 'audio.commit', sequence: 2 });
    assert.equal(f.upstream.filter(event => event.type === 'response.create').length, 1, 'new sequence does not imply a new user turn');
    await f.provider({ type: 'response.created', response: { id: 'r1' } });
    await f.provider({ type: 'response.done', response: { id: 'unrelated', status: 'completed' } });
    assert.notEqual(f.relay.manualPending, null, 'An unrelated terminal event cannot unlock the current manual turn');
    await f.provider({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
    assert.deepEqual(f.sent.filter(event => event.type === 'voice.turn').at(-1), { type: 'voice.turn', state: 'ready' });
    await f.client({ type: 'audio.commit', sequence: 3 });
    assert.equal(f.upstream.filter(event => event.type === 'response.create').length, 1, 'terminal response does not make old audio new input');
});

test('manual turn remains pending across a tool continuation and unlocks only at its final response', async () => {
    const f = fixture(); f.relay.session.settings.turn_detection.type = null; await f.ready();
    await f.client({ type: 'audio.append', sequence: 0, audio: 'AAA=' });
    await f.client({ type: 'audio.commit', sequence: 1 }); await user(f, 'manual_tool_input');
    await f.provider({ type: 'response.created', response: { id: 'manual_tool' } });
    await f.provider({ type: 'response.function_call_arguments.done', response_id: 'manual_tool', call_id: 'read_context', name: 'canvas_context', arguments: '{}' });
    await f.provider({ type: 'response.done', response: { id: 'manual_tool', status: 'completed' } });
    assert.notEqual(f.relay.manualPending, null);
    assert.equal(f.sent.filter(event => event.type === 'voice.turn' && event.state === 'ready').length, 0);
    await f.provider({ type: 'response.created', response: { id: 'manual_final' } });
    await f.provider({ type: 'response.done', response: { id: 'manual_final', status: 'completed' } });
    assert.equal(f.relay.manualPending, null);
    assert.equal(f.sent.filter(event => event.type === 'voice.turn' && event.state === 'ready').length, 1);
});

test('metering uses server-decoded samples and retains interrupted received audio without playback', async () => {
    const f = fixture(); await f.ready(); await user(f, 'cost_input');
    await f.client({ type: 'audio.append', sequence: 0, audio: Buffer.alloc(480).toString('base64') });
    await f.provider({ type: 'response.output_item.added', response_id: 'cost_reply', item: { type: 'message', id: 'cost_audio' } });
    await f.provider({ type: 'response.audio.delta', response_id: 'cost_reply', item_id: 'cost_audio', delta: Buffer.alloc(960).toString('base64') });
    await f.client({ type: 'voice.interrupt', sequence: 1, responseId: 'cost_reply', itemId: 'cost_audio', audioEndMs: 0 });
    await f.provider({ type: 'response.audio.delta', response_id: 'cost_reply', item_id: 'cost_audio', delta: Buffer.alloc(480).toString('base64') });
    const measured = f.calls.filter(call => call[0] === 'exposure').at(-1)[1];
    assert.equal(measured.inputSamples, 240); assert.equal(measured.outputSamples, 720);
    assert.equal(measured.inputRate, 24000); assert.equal(measured.outputRate, 24000);
    assert.equal(f.sent.filter(event => event.type === 'voice.audio').length, 1, 'Late audio is counted but never played');
    await f.provider({ type: 'response.audio.delta', response_id: 'cost_reply', item_id: 'cost_audio', delta: 'AA==' });
    assert.equal(f.relay.closed, true, 'Malformed PCM has no invented duration');
});
