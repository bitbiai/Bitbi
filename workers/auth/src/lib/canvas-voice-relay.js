// Relay core for one admitted session. Its server owner must supply durable
// admission, accounting and lifecycle services; this core does not reserve
// credits. Browser messages are NOT arbitrary xAI messages.
import { opusPacketDuration } from '../../../../js/shared/canvas-voice-audio.mjs';
import { canvasVoiceProviderRejectionCategory } from './canvas-voice-provider.js';
import { sha256Hex } from './tokens.js';
const parse = value => { if (typeof value !== 'string' || value.length > 280000) throw new Error('canvas_voice_frame_invalid'); return JSON.parse(value); };
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
// Diagnostic categories are fixed protocol names, never provider payloads or IDs.
const beforeReadyEvents = Object.freeze({
    'input_audio_buffer.speech_started': 'speech_started', 'input_audio_buffer.speech_stopped': 'speech_stopped',
    'input_audio_buffer.committed': 'input_committed', 'input_audio_buffer.cleared': 'input_cleared',
    'input_audio_buffer.timeout_triggered': 'idle_timeout', 'input_audio_buffer.dtmf_event_received': 'dtmf',
    'conversation.item.deleted': 'item_deleted', 'conversation.item.truncated': 'item_truncated',
    'conversation.item.input_audio_transcription.updated': 'input_transcript',
    'conversation.item.input_audio_transcription.completed': 'input_transcript_done',
    'response.created': 'response_created', 'response.done': 'response_done',
    'response.output_item.added': 'output_item', 'response.output_item.done': 'output_item_done',
    'response.content_part.added': 'content_part', 'response.content_part.done': 'content_done',
    'response.output_audio.delta': 'audio_delta', 'response.audio.delta': 'audio_delta', 'response.output_audio.done': 'audio_done',
    'response.output_audio_transcript.delta': 'transcript_delta', 'response.output_audio_transcript.done': 'transcript_done',
    'response.text.delta': 'text_delta', 'response.output_text.delta': 'text_delta',
    'response.function_call_arguments.delta': 'function_delta', 'response.function_call_arguments.done': 'function_call',
    'mcp_list_tools.in_progress': 'mcp_discovery', 'mcp_list_tools.completed': 'mcp_discovered', 'mcp_list_tools.failed': 'mcp_failed',
    'response.mcp_call_arguments.delta': 'mcp_arguments', 'response.mcp_call_arguments.done': 'mcp_arguments_done',
    'response.mcp_call.in_progress': 'mcp_call', 'response.mcp_call.completed': 'mcp_completed', 'response.mcp_call.failed': 'mcp_call_failed',
});
const startupKeys = Object.freeze(['data', 'event', 'error', 'code', 'message', 'session', 'conversation']);
// Positional diagnostic IDs only: append new names without renumbering existing entries.
const startupTypes = Object.freeze(['session.created', 'conversation.created', 'session.updated',
    'conversation.item.created', 'conversation.item.added', 'error', ...Object.keys(beforeReadyEvents)]);
async function startupFrameCode(event, configured) {
    const object = event !== null && typeof event === 'object' && !Array.isArray(event);
    const shape = object ? 'o' : Array.isArray(event) ? 'a' : 'p';
    const type = object && Object.hasOwn(event, 'type') ? event.type : undefined;
    const kind = !object || !Object.hasOwn(event, 'type') ? 'm' : typeof type === 'string' ? 's' : 'n';
    let mask = 0, nested = '0';
    if (object) startupKeys.forEach((key, i) => {
        if (!Object.hasOwn(event, key)) return;
        mask |= 1 << i;
        const value = event[key], candidate = typeof value === 'string' ? value : value?.type;
        const known = typeof candidate === 'string' ? startupTypes.indexOf(candidate) : -1;
        if (nested === '0' && known >= 0) nested = `${i + 1}${(known + 1).toString(36)}`;
    });
    const reason = canvasVoiceProviderRejectionCategory(event) || 'none';
    const digest = kind === 's' ? '_h' + (await sha256Hex(type)).slice(0, 16) : '';
    return `canvas_voice_provider_not_ready_u_s${configured ? 1 : 0}a0_${shape}_${kind}_k${mask.toString(16).padStart(2, '0')}_n${nested}_r${reason}${digest}`;
}
const bytesOf = value => {
    if (typeof value !== 'string' || value.length > 256000 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('canvas_voice_audio_invalid');
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
};
const base64 = bytes => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); };

export class CanvasVoiceRelay {
    constructor({ client, provider, session, services, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
        this.client = client; this.provider = provider; this.session = session; this.services = services; this.now = now;
        // Native workerd timer functions must not receive this relay as their
        // receiver. Closure invocation also keeps injected test clocks faithful.
        this.setTimer = (...args) => setTimer(...args); this.clearTimer = value => clearTimer(value);
        this.closed = false; this.active = false; this.muted = false; this.configurationSent = false;
        this.nextSequence = 0; this.sequences = new Map(); this.providerEvents = new Set(); this.inputSamples = 0;
        this.outputBytes = 0; this.outputSamples = 0; this.startedAt = now(); this.lastInputAt = now(); this.turn = null; this.output = null;
        this.queue = Promise.resolve(); this.queuedBytes = 0; this.queuedCount = 0; this.latestTranscript = new Map(); this.responses = new Map(); this.turns = new Map(); this.sourceItemId = null;
        this.functionResponses = new Map(); this.functionCalls = new Map();
        this.manualPending = null; this.committedSamples = 0;
        const remaining = new Date(session.expiresAt).getTime() - now();
        if (!Number.isFinite(remaining) || remaining <= 0) fail('canvas_voice_session_expired');
        this.deadline = setTimer(() => void this.stop('canvas_voice_session_limit'), remaining);
    }
    send(message) { if (!this.closed) this.client.send(JSON.stringify(message)); }
    upstream(message) { if (!this.closed) this.provider.send(typeof message === 'string' || message instanceof ArrayBuffer ? message : JSON.stringify(message)); }
    configure() {
        if (this.closed || this.configurationSent) return;
        const configuration = this.services.configuration();
        this.configurationSent = true; this.upstream(configuration);
    }
    async authorize() { if (this.closed || !await this.services.authorize(this.session)) fail('canvas_voice_authority_changed'); }
    transcript(itemId) {
        if (!this.latestTranscript.has(itemId)) {
            if (this.latestTranscript.size >= 80) fail('canvas_voice_turn_limit');
            this.latestTranscript.set(itemId, { committed: false, completed: false });
        }
        return this.latestTranscript.get(itemId);
    }
    async publishTranscript(itemId) {
        const transcript = this.latestTranscript.get(itemId);
        if (!transcript?.committed || !transcript.completed || transcript.text === transcript.persistedText) return;
        // A provisional ASR completion is not yet a committed user message.
        // After publication, the canonical service still rejects changed text
        // for the same immutable item; only exact repeats are skipped here.
        const turn = await this.services.userTurn({ itemId, text: transcript.text });
        if (this.closed) return;
        transcript.persistedText = transcript.text; this.turns.set(itemId, turn);
        if (itemId === this.sourceItemId) this.turn = turn;
        for (const response of this.functionResponses.values()) if (response.sourceItemId === itemId) response.turn = turn;
        for (const response of this.responses.values()) if (response.sourceItemId === itemId) {
            response.turn = turn;
            if (response.done && response.text && !response.persisted) { await this.services.reply(response); response.persisted = true; }
        }
        this.send({ type: 'voice.changed' });
    }
    enqueue(work, size = 0) {
        if (this.closed) return Promise.resolve();
        const pressure = size > 280000 ? 'frame' : this.queuedCount >= 64 ? 'count' : this.queuedBytes + size > 2 * 1024 * 1024 ? 'bytes' : null;
        if (pressure) return this.stop('canvas_voice_backpressure_' + pressure);
        this.queuedCount++; this.queuedBytes += size;
        this.queue = this.queue.then(async () => { if (!this.closed) await work(); }).catch(error => this.stop(error.code || 'canvas_voice_protocol_failed'))
            .finally(() => { this.queuedCount--; this.queuedBytes -= size; });
        return this.queue;
    }
    clientMessage(raw) { return this.enqueue(async () => {
        await this.authorize();
        const event = parse(raw);
        if (!exact(event, ['type', 'sequence', 'audio', 'muted', 'responseId', 'itemId', 'audioEndMs']) || !Number.isSafeInteger(event.sequence) || event.sequence < 0) fail('canvas_voice_frame_invalid');
        const prior = this.sequences.get(event.sequence);
        if (prior !== undefined) { if (prior !== raw) fail('canvas_voice_replay_conflict'); return; }
        if (event.sequence !== this.nextSequence) fail('canvas_voice_sequence_gap');
        this.sequences.set(event.sequence, raw); this.nextSequence++;
        if (this.sequences.size > 32) this.sequences.delete(this.sequences.keys().next().value);
        if (event.type === 'voice.stop') { await this.stop('canvas_voice_stopped'); return; }
        if (!this.active) fail('canvas_voice_not_ready');
        if (event.type === 'voice.mute') {
            if (typeof event.muted !== 'boolean') fail('canvas_voice_frame_invalid');
            this.muted = event.muted; this.send({ type: 'voice.state', state: this.muted ? 'muted' : 'listening' }); return;
        }
        if (event.type === 'audio.append') {
            if (this.muted) return;
            const bytes = bytesOf(event.audio), format = this.session.settings.audio.input.format;
            if (!bytes.length || format.type === 'audio/pcm' && bytes.length % 2) fail('canvas_voice_audio_invalid');
            const count = format.type === 'audio/opus' ? opusPacketDuration(bytes) * format.rate / 1000 : bytes.length / (format.type === 'audio/pcm' ? 2 : 1);
            if (count > format.rate || (this.inputSamples + count) / format.rate > (this.now() - this.startedAt) / 1000 + 2) fail('canvas_voice_audio_rate_exceeded');
            // Enforce the reserved maximum before forwarding. The owner checkpoints
            // actually forwarded input, so a simultaneous Stop cannot bill this proposal.
            const proposed = this.inputSamples + count;
            await this.services.recordExposure({ ...this.exposure(), inputSamples: proposed });
            if (this.closed) return;
            this.inputSamples = proposed; this.lastInputAt = this.now();
            if (this.session.settings.audio.input.transport === 'binary') this.upstream(bytes.buffer);
            else this.upstream({ type: 'input_audio_buffer.append', audio: event.audio });
            return;
        }
        if (event.type === 'audio.commit') {
            if (this.session.settings.turn_detection.type !== null) fail('canvas_voice_manual_turn_unavailable');
            if (this.manualPending) { this.send({ type: 'voice.turn', state: 'pending' }); return; }
            if (this.inputSamples <= this.committedSamples) { this.send({ type: 'voice.turn', state: 'ready', reason: 'no_new_audio' }); return; }
            this.committedSamples = this.inputSamples; this.manualPending = { sent: false };
            this.send({ type: 'voice.turn', state: 'pending' });
            this.upstream({ type: 'input_audio_buffer.commit' }); return;
        }
        if (event.type === 'voice.interrupt') {
            if (!this.output || event.responseId !== this.output.responseId || event.itemId !== this.output.itemId) return;
            if (!Number.isSafeInteger(event.audioEndMs) || event.audioEndMs < 0 || event.audioEndMs > 7200000) fail('canvas_voice_frame_invalid');
            this.output.interrupted = true;
            this.output.truncationRequested = event.audioEndMs;
            this.upstream({ type: 'response.cancel', response_id: event.responseId });
            this.upstream({ type: 'conversation.item.truncate', item_id: event.itemId, content_index: 0, audio_end_ms: event.audioEndMs });
            await this.services.interrupted({ ...this.output, audioEndMs: event.audioEndMs });
            this.send({ type: 'voice.interrupted', responseId: event.responseId }); return;
        }
        fail('canvas_voice_command_forbidden');
    }, typeof raw === 'string' ? raw.length * 2 : 280001); }
    providerMessage(raw) { return this.enqueue(async () => {
        await this.authorize();
        if (raw instanceof ArrayBuffer) {
            if (!this.active || !this.output || this.session.settings.audio.output.transport !== 'binary') fail('canvas_voice_audio_unassociated');
            await this.audio(new Uint8Array(raw)); return;
        }
        const event = parse(raw), type = event?.type;
        if (event?.event_id) {
            if (!id(event.event_id)) fail('canvas_voice_provider_event_invalid');
            if (this.providerEvents.has(event.event_id)) return;
            if (this.providerEvents.size >= 20000) fail('canvas_voice_event_limit');
            this.providerEvents.add(event.event_id);
        }
        // Observed xAI JSON heartbeat: no reply, readiness, activity or deadline effect.
        if (type === 'ping') return;
        if (type === 'session.created') { this.configure(); return; }
        if (type === 'conversation.created') {
            if (!id(event.conversation?.id)) fail('canvas_voice_provider_identity_invalid');
            await this.services.conversation?.(event.conversation.id); this.configure(); return;
        }
        // Opt-in resumption replays historical items, including tool calls and
        // outputs. They condition the provider, never create a fresh local turn,
        // execute a tool or resend a chargeable conversation.item.create.
        if (type === 'conversation.item.created' || type === 'conversation.item.added') return;
        if (type === 'session.updated') {
            if (!this.configurationSent) fail('canvas_voice_provider_not_ready_session_updated');
            await this.services.verifyConfiguration(event.session);
            if (this.closed) return;
            if (!this.active) {
                await this.services.active(); if (this.closed) return; this.active = true;
                const seed = await this.services.seedContext(); if (seed) this.upstream(seed);
            }
            this.send({ type: 'voice.state', state: this.muted ? 'muted' : 'listening' }); return;
        }
        if (type === 'error') fail('canvas_voice_provider_error');
        if (!this.active) fail(typeof type === 'string' && Object.hasOwn(beforeReadyEvents, type)
            ? 'canvas_voice_provider_not_ready_' + beforeReadyEvents[type] : await startupFrameCode(event, this.configurationSent));
        if (event.type === 'input_audio_buffer.timeout_triggered') {
            this.send({ type: 'voice.state', state: 'processing' }); return; // Provider follow-up, not a local session expiry.
        }
        if (event.type === 'input_audio_buffer.speech_started') {
            this.turn = null; // An incomplete new utterance must not edit the previous user's turn.
            this.send({ type: 'voice.speech_started', responseId: this.output?.responseId, itemId: this.output?.itemId }); return;
        }
        if (event.type === 'input_audio_buffer.committed') {
            if (!id(event.item_id)) fail('canvas_voice_provider_event_invalid');
            const transcript = this.transcript(event.item_id);
            if (transcript.committed) return;
            transcript.committed = true;
            this.sourceItemId = event.item_id; this.turn = this.turns.get(event.item_id) || null;
            await this.publishTranscript(event.item_id);
            if (this.manualPending && !this.manualPending.sent) {
                this.manualPending.sent = true; this.manualPending.itemId = event.item_id; this.upstream(await this.services.response());
            }
            return;
        }
        if (event.type === 'response.created') {
            if (!id(event.response?.id)) fail('canvas_voice_provider_event_invalid');
            if (!this.functionResponses.has(event.response.id)) this.functionResponses.set(event.response.id,
                { sourceItemId: this.sourceItemId, turn: this.turn, calls: [], continued: false });
            if (this.functionResponses.size > 160) fail('canvas_voice_turn_limit');
            return;
        }
        if (event.type === 'conversation.item.input_audio_transcription.updated' || event.type === 'conversation.item.input_audio_transcription.completed') {
            if (!id(event.item_id) || typeof event.transcript !== 'string' || event.transcript.length > 6000) fail('canvas_voice_transcript_invalid');
            const transcript = this.transcript(event.item_id);
            transcript.text = event.transcript; // Cumulative, never appended as a delta.
            transcript.completed = event.type.endsWith('.completed'); // A newer interim invalidates a provisional final.
            if (transcript.completed) await this.publishTranscript(event.item_id);
            if (!transcript.completed || !this.turns.has(event.item_id)) this.send({ type: 'voice.transcript', itemId: event.item_id, text: event.transcript });
            return;
        }
        if (event.type === 'response.output_item.added' && event.item?.type === 'message') {
            if (!id(event.response_id) || !id(event.item.id)) fail('canvas_voice_provider_event_invalid');
            this.output = { responseId: event.response_id, itemId: event.item.id, text: '', interrupted: false, turn: this.turn, sourceItemId: this.sourceItemId };
            this.responses.set(event.response_id, this.output); if (this.responses.size > 160) fail('canvas_voice_turn_limit'); return;
        }
        if (event.type === 'response.output_audio.delta' || event.type === 'response.audio.delta') {
            if (!this.output || event.response_id !== this.output.responseId || event.item_id !== this.output.itemId) fail('canvas_voice_audio_unassociated');
            await this.audio(bytesOf(event.delta)); return;
        }
        if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.text.delta' || event.type === 'response.output_text.delta') {
            const response = this.responses.get(event.response_id);
            if (!response || typeof event.delta !== 'string' || response.text.length + event.delta.length > 8000) fail('canvas_voice_transcript_invalid');
            response.text += event.delta; return;
        }
        if (event.type === 'response.function_call_arguments.done') {
            if (!id(event.call_id) || !['canvas_context', 'canvas_update_brief', 'canvas_prepare_next_step'].includes(event.name)
                || typeof event.arguments !== 'string' || event.arguments.length > 24000 || !this.session.settings.tools.canvas.enabled) fail('canvas_voice_tool_forbidden');
            const response = this.functionResponses.get(event.response_id);
            const fingerprint = JSON.stringify([event.response_id, event.name, event.arguments]);
            const previous = this.functionCalls.get(event.call_id);
            if (previous) { if (previous.fingerprint !== fingerprint) fail('canvas_voice_replay_conflict'); return; }
            if (!response || response.continued) fail('canvas_voice_tool_response_unknown');
            if (this.functionCalls.size >= 80) fail('canvas_voice_tool_limit');
            const result = !response.turn && event.name === 'canvas_update_brief' ? { ok: false, code: 'canvas_voice_transcript_pending', retry: false }
                : await this.services.tool({ callId: event.call_id, turn: response.turn, name: event.name, arguments: JSON.parse(event.arguments) });
            this.functionCalls.set(event.call_id, { fingerprint, result });
            response.calls.push({ callId: event.call_id, result }); this.send({ type: 'voice.changed' }); return;
        }
        if (event.type === 'conversation.item.truncated') {
            if (!id(event.item_id)) fail('canvas_voice_provider_event_invalid');
            const response = [...this.responses.values()].find(value => value.itemId === event.item_id);
            if (!response || response.truncationRequested === undefined || event.audio_end_ms !== response.truncationRequested) fail('canvas_voice_truncation_unconfirmed');
            if (event.transcript !== undefined && (typeof event.transcript !== 'string' || event.transcript.length > 8000)) fail('canvas_voice_transcript_invalid');
            response.interrupted = true;
            await this.services.interrupted({ responseId: response.responseId, itemId: response.itemId, audioEndMs: event.audio_end_ms,
                ...(event.transcript !== undefined ? { transcript: event.transcript } : {}) });
            return;
        }
        if (event.type === 'response.done') {
            const response = this.responses.get(event.response?.id);
            if (response) { response.done = true; response.interrupted ||= event.response.status !== 'completed'; }
            if (response && response.text && response.turn && !response.persisted) {
                await this.services.reply(response); response.persisted = true; this.send({ type: 'voice.changed' });
            }
            const functions = this.functionResponses.get(event.response?.id);
            if (functions && !functions.continued && functions.calls.length) {
                functions.continued = true;
                if (event.response.status === 'completed') {
                    for (const call of functions.calls) this.upstream({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.callId, output: JSON.stringify(call.result) } });
                    this.upstream(await this.services.response());
                }
            }
            if (this.manualPending && functions?.sourceItemId === this.manualPending.itemId
                && (!functions.calls.length || event.response.status !== 'completed')) {
                this.manualPending = null; this.send({ type: 'voice.turn', state: 'ready' });
            }
            this.send({ type: 'voice.state', state: this.muted ? 'muted' : 'listening' });
        }
    }, typeof raw === 'string' ? raw.length * 2 : raw instanceof ArrayBuffer ? raw.byteLength : 280001); }
    async audio(bytes) {
        if (!bytes.length || bytes.length > 192000) fail('canvas_voice_audio_limit');
        const format = this.session.settings.audio.output.format;
        if (format.type === 'audio/pcm' && bytes.length % 2) fail('canvas_voice_audio_invalid');
        const count = format.type === 'audio/opus' ? opusPacketDuration(bytes) * format.rate / 1000 : bytes.length / (format.type === 'audio/pcm' ? 2 : 1);
        if (this.outputSamples + count > format.rate * 7200) fail('canvas_voice_audio_limit');
        this.outputBytes += bytes.length; this.outputSamples += count;
        // Received provider audio remains billable evidence even when the user
        // has interrupted playback. Never count compressed bytes as seconds.
        await this.services.recordExposure(this.exposure());
        if (this.output.interrupted) return;
        this.send({ type: 'voice.audio', audio: base64(bytes), itemId: this.output.itemId, responseId: this.output.responseId });
    }
    exposure() { return { inputSamples: this.inputSamples, outputSamples: this.outputSamples, outputBytes: this.outputBytes,
        inputRate: this.session.settings.audio.input.format.rate, outputRate: this.session.settings.audio.output.format.rate,
        elapsedMs: Math.max(0, this.now() - this.startedAt) }; }
    async stop(code = 'canvas_voice_disconnected') {
        if (this.closed) return;
        this.closed = true;
        const publicCode = typeof code === 'string' && (code.startsWith('canvas_voice_configuration_unconfirmed_')
            || code.startsWith('canvas_voice_provider_not_ready_')) ? 'canvas_voice_configuration_unconfirmed'
            : ['canvas_voice_backpressure_frame', 'canvas_voice_backpressure_count', 'canvas_voice_backpressure_bytes'].includes(code) ? 'canvas_voice_backpressure' : code;
        try { this.clearTimer(this.deadline); } catch { /* Timer cleanup cannot block socket close or durable settlement. */ }
        try { this.provider.close(1000, 'session ended'); } catch { /* Already closed; the outcome is still recorded below. */ }
        try { this.client.send(JSON.stringify({ type: 'voice.ended', code: publicCode })); this.client.close(1000, 'session ended'); } catch { /* Disconnected browser cannot acknowledge termination. */ }
        this.latestTranscript.clear(); this.sequences.clear(); this.providerEvents.clear(); this.turns.clear();
        await this.services.ended({ code, ...this.exposure(),
            incompleteResponses: [...this.responses.values()].filter(value => !value.persisted).map(value => ({ ...value, interrupted: true })) });
        this.responses.clear();
        this.functionResponses.clear(); this.functionCalls.clear();
    }
}
