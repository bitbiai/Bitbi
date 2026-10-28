import { createCanvasVoiceOpus } from './voice-opus.js?v=__ASSET_VERSION__';
import { VoiceResampler, encodeVoiceAudio, decodeVoiceAudio } from '../../shared/canvas-voice-audio.mjs?v=__ASSET_VERSION__';
const fail = code => Object.assign(new Error(code), { code });
// Bound retained decoded PCM, independently of faster-than-realtime delivery.
const playbackMemoryLimit = 8 * 1024 * 1024;
// A broken native resource must not prevent releasing the remaining resources.
const release = action => { try { action(); } catch { /* Cleanup is independent and idempotent. */ } };
function fromBase64(value) {
    if (typeof value !== 'string' || value.length > 256000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw fail('canvas_voice_audio_invalid');
    const raw = atob(value), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
}
function toBase64(bytes) {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
}
// Each instance belongs to one session epoch. Late permissions cannot reopen it.
export function createCanvasVoiceAudio({ settings, onAudio, onError, onState = () => {} }) {
    let epoch = 0, closed = false, context = null, stream = null, source = null, capture = null, sink = null;
    let muted = false, ready = false, resampler = null, queued = [], buffered = 0, playAt = 0, item = null, playbackBytes = 0;
    let opus = null, flush = null, flushId = 0, inputEpoch = 0, packetUsed = 0, capturePaused = false;
    const packet = new Float32Array(Math.ceil(settings.audio.input.format.rate / 10));
    const nodes = new Map(), seenAudio = new Set();
    function stopped() { return closed; }
    function playing() { return !closed && (nodes.size > 0 || opus?.outputPending() === true); }
    function releasePlayback(node) {
        if (!nodes.has(node)) return false;
        playbackBytes -= nodes.get(node); nodes.delete(node); node.onended = null;
        release(() => node.disconnect()); release(() => { node.buffer = null; }); return true;
    }
    function stopPlayback(resetDecoder = true) {
        const heard = item ? { itemId: item.itemId, responseId: item.responseId,
            audioEndMs: Math.max(0, Math.min(item.durationMs, Math.floor(((context?.currentTime || 0) - item.startedAt) * 1000))) } : null;
        for (const node of nodes.keys()) { node.onended = null; release(() => node.stop()); releasePlayback(node); }
        playAt = 0; item = null; if (resetDecoder) opus?.resetOutput(); return heard;
    }
    function stop() {
        if (closed) return; closed = true; epoch++; inputEpoch++; ready = false; queued = []; buffered = 0; packetUsed = 0;
        stopPlayback(false); release(() => opus?.close()); opus = null;
        if (flush) { clearTimeout(flush.timer); flush.reject(fail('canvas_voice_stopped')); flush = null; }
        if (capture) { const old = capture; capture = null; old.port.onmessage = null; old.onprocessorerror = null; release(() => old.port.postMessage({ type: 'stop' })); release(() => old.port.close()); release(() => old.disconnect()); }
        for (const node of [source, sink]) release(() => node?.disconnect()); source = sink = null;
        for (const track of stream?.getTracks() || []) release(() => track.stop()); stream = null;
        const old = context; context = null; if (old) release(() => { void old.close().catch(() => {}); });
    }
    function error(error) { if (closed) return; stop(); onError(error); }
    function sendSamples(samples) {
        if (closed || muted || !samples.length) return;
        if (!ready) { queued.push(samples); buffered += samples.length;
            if (buffered > settings.audio.input.format.rate * 2) error(fail('canvas_voice_capture_backpressure'));
            return;
        }
        if (settings.audio.input.format.type === 'audio/opus') { opus.append(samples); return; }
        // Bound transport cadence independently of the device's render quanta.
        for (let at = 0; at < samples.length && !closed && !muted;) {
            const count = Math.min(packet.length - packetUsed, samples.length - at);
            packet.set(samples.subarray(at, at + count), packetUsed); packetUsed += count; at += count;
            if (packetUsed === packet.length) sendPacket();
        }
    }
    function sendPacket() {
        if (closed || muted || !packetUsed) return;
        const bytes = encodeVoiceAudio(packet.subarray(0, packetUsed), settings.audio.input.format.type); packetUsed = 0;
        if (onAudio(toBase64(bytes)) === false) error(fail('canvas_voice_transport_backpressure'));
    }
    async function open() {
        const current = ++epoch;
        if (closed) throw fail('canvas_voice_stopped');
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio || !navigator.mediaDevices?.getUserMedia || !globalThis.AudioWorkletNode) throw fail('canvas_voice_browser_unsupported');
        context = new Audio();
        const unlocking = context.resume(); unlocking.catch(failure => { if (!closed) error(failure); });
        if (closed || current !== epoch) return;
        if (settings.audio.input.format.type === 'audio/opus' || settings.audio.output.format.type === 'audio/opus') {
            const codec = await createCanvasVoiceOpus({ encode: settings.audio.input.format.type === 'audio/opus', decode: settings.audio.output.format.type === 'audio/opus',
                onPacket: bytes => { if (!closed && !muted && onAudio(toBase64(bytes)) === false) error(fail('canvas_voice_transport_backpressure')); },
                onSamples: schedule, onError: error });
            if (closed || current !== epoch) { codec.close(); return; } opus = codec;
        }
        onState('permission');
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...settings.browser }, video: false });
        if (closed || current !== epoch) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired; await unlocking;
        if (closed || current !== epoch) return;
        if (!context.audioWorklet) throw fail('canvas_voice_browser_unsupported');
        await context.audioWorklet.addModule(new URL('./voice-capture-worklet.js?v=__ASSET_VERSION__', import.meta.url));
        if (closed || current !== epoch) return;
        resampler = new VoiceResampler(context.sampleRate, settings.audio.input.format.rate);
        source = context.createMediaStreamSource(stream); sink = context.createGain(); sink.gain.value = 0;
        capture = new AudioWorkletNode(context, 'canvas-voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, processorOptions: { generationEnvelope: true } });
        capture.port.onmessage = event => {
            if (closed || event.data?.generation !== inputEpoch) return;
            if (event.data?.type === 'flushed') { if (flush?.id === event.data.id) { clearTimeout(flush.timer); flush.resolve(); flush = null; } return; }
            if (closed || muted || !ready || !stream?.active) return;
            try { sendSamples(resampler.push(event.data.samples)); } catch (failure) { error(failure); }
        };
        capture.onprocessorerror = () => error(fail('canvas_voice_capture_failed'));
        for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (!closed) error(fail('canvas_voice_microphone_ended')); }, { once: true });
        source.connect(capture); capture.connect(sink); sink.connect(context.destination);
        onState('connecting');
    }
    function play(event) {
        if (closed || !context) return;
        const id = event.event_id || event.eventId;
        if (id && seenAudio.has(id)) return;
        if (id) { seenAudio.add(id); if (seenAudio.size > 2048) seenAudio.delete(seenAudio.values().next().value); }
        try {
            const bytes = fromBase64(event.audio || event.delta);
            if (settings.audio.output.format.type === 'audio/opus') opus.play(bytes, event);
            else schedule(decodeVoiceAudio(bytes, settings.audio.output.format.type), settings.audio.output.format.rate, event);
        } catch (failure) { error(failure); }
    }
    function schedule(floats, rate, event) {
        if (closed || !context) return;
        try {
            if (!(floats instanceof Float32Array) || !Number.isFinite(rate) || rate <= 0) throw fail('canvas_voice_audio_invalid');
            if (!floats.length) return;
            if (playbackBytes + floats.byteLength > playbackMemoryLimit || nodes.size >= 512) throw fail('canvas_voice_playback_backpressure');
            const duration = floats.length / rate, now = context.currentTime;
            const buffer = context.createBuffer(1, floats.length, rate); buffer.copyToChannel(floats, 0);
            const node = context.createBufferSource(); nodes.set(node, floats.byteLength); playbackBytes += floats.byteLength;
            node.buffer = buffer; node.connect(context.destination);
            const start = Math.max(playAt, now), itemId = event.itemId || event.item_id, responseId = event.responseId || event.response_id;
            if (!item || item.itemId !== itemId) item = { itemId, responseId, startedAt: start, durationMs: 0 };
            item.durationMs += duration * 1000; playAt = start + duration;
            node.onended = () => { if (!releasePlayback(node)) return; if (!playing() && !closed) onState(muted ? 'muted' : 'listening'); };
            node.start(start); onState('speaking');
        } catch (failure) { error(failure); }
    }
    async function finishTurn() {
        if (closed || muted || !capture || !ready || flush) throw fail('canvas_voice_capture_unavailable');
        const generation = inputEpoch; capturePaused = true;
        await new Promise((resolve, reject) => { const id = ++flushId; flush = { id, resolve, reject, timer: setTimeout(() => { flush = null; reject(fail('canvas_voice_capture_flush_timeout')); }, 1000) }; capture.port.postMessage({ type: 'flush', id }); });
        if (closed || generation !== inputEpoch) throw fail('canvas_voice_stopped');
        sendSamples(resampler.push(new Float32Array(0), true)); resampler = new VoiceResampler(context.sampleRate, settings.audio.input.format.rate);
        sendPacket();
        await opus?.flush({ pad: true });
        if (closed || generation !== inputEpoch) throw fail('canvas_voice_stopped');
    }
    return { open, stop, stopped, playing, play, finishTurn, continueCapture() { if (closed) return; capturePaused = false; if (!muted) capture?.port.postMessage({ type: 'resume' }); }, interrupt: stopPlayback,
        ready() { if (closed) return; ready = true; const pending = queued; queued = []; buffered = 0; for (const samples of pending) sendSamples(samples); },
        mute(value) {
            if (closed || muted === Boolean(value)) return;
            muted = Boolean(value); inputEpoch++; queued = []; buffered = 0; packetUsed = 0;
            if (context) resampler = new VoiceResampler(context.sampleRate, settings.audio.input.format.rate);
            opus?.resetInput(); capture?.port.postMessage({ type: 'reset', generation: inputEpoch, paused: muted || capturePaused });
            if (flush) { clearTimeout(flush.timer); flush.reject(fail('canvas_voice_stopped')); flush = null; }
            for (const track of stream?.getAudioTracks() || []) track.enabled = !muted; onState(muted ? 'muted' : 'listening');
        },
        async resume() { if (!closed && context?.state === 'suspended') await context.resume(); },
    };
}
