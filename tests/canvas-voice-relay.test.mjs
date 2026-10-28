import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasVoiceRelay } from '../workers/auth/src/lib/canvas-voice-relay.js';
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
test('pre-ack audio, tools and unknown events remain fenced with content-free diagnostic categories', async () => {
    const cases = [
        [{ type: 'response.output_audio.delta', delta: 'AAA=' }, 'audio_delta'],
        [{ type: 'response.function_call_arguments.done', arguments: '{"private":"do not log"}' }, 'function_call'],
        [{ type: 'input_audio_buffer.cleared' }, 'input_cleared'],
        [{ type: 'synthetic_private_event', private: 'do not log' }, 'unknown_event'],
        [{ type: '__proto__' }, 'unknown_event'],
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
    let release; const wait = new Promise(resolve => { release = resolve; });
    const f = fixture({ authorize: () => wait });
    const pending = Array.from({ length: 65 }, (_, sequence) => f.client({ type: 'voice.mute', sequence, muted: true }));
    assert.equal(f.relay.closed, true);
    assert.equal(f.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_backpressure');
    release(true); await Promise.all(pending);
    assert.equal(f.upstream.length, 0);
    const g = fixture();
    await g.relay.clientMessage('x'.repeat(280001));
    assert.equal(g.relay.closed, true);
    assert.equal(g.calls.find(c => c[0] === 'ended')[1].code, 'canvas_voice_backpressure');
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
