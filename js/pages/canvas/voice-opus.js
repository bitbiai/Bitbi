import { opusPacketDuration } from '../../shared/canvas-voice-audio.mjs?v=__ASSET_VERSION__';
export { opusPacketDuration };
const frameSamples = 1440, frameDuration = 60000;
const encoderConfig = () => ({ codec: 'opus', sampleRate: 24000, numberOfChannels: 1, bitrate: 32000, opus: { frameDuration, format: 'opus' } });
// WebCodecs uses raw Opus packets (not an Ogg container). Keep packet ownership
// and queue limits local; the relay retains the provider transport framing.
export async function canvasVoiceOpusSupport() {
    if (typeof globalThis.AudioEncoder !== 'function' || typeof globalThis.AudioDecoder !== 'function' || typeof globalThis.AudioData !== 'function') return false;
    try {
        const [encoder, decoder] = await Promise.all([
            AudioEncoder.isConfigSupported(encoderConfig()),
            AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: 24000, numberOfChannels: 1 }),
        ]);
        return encoder.supported && encoder.config?.opus?.frameDuration === frameDuration && decoder.supported;
    } catch { return false; }
}
export async function createCanvasVoiceOpus({ encode, decode, onPacket, onSamples, onError }) {
    if (!await canvasVoiceOpusSupport()) throw Object.assign(new Error('canvas_voice_opus_unavailable'), { code: 'canvas_voice_opus_unavailable' });
    let closed = false, encoder = null, decoder = null, inputTime = 0, outputTime = 0, pending = [], used = 0, inputEpoch = 0;
    const contexts = new Map();
    function startEncoder() {
        const generation = inputEpoch;
        encoder = new AudioEncoder({ output(chunk) {
            if (closed || generation !== inputEpoch) return;
            const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
            try { if (opusPacketDuration(bytes) !== frameDuration / 1000) throw new Error('canvas_voice_opus_unavailable'); onPacket(bytes); } catch (failure) { onError(failure); }
        }, error(failure) { if (!closed && generation === inputEpoch) onError(failure); } });
        encoder.configure(encoderConfig());
    }
    try {
        if (encode) startEncoder();
        if (decode) {
            decoder = new AudioDecoder({ output(data) {
                try {
                    if (closed) return;
                    const samples = new Float32Array(data.numberOfFrames); data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
                    const context = contexts.get(data.timestamp); contexts.delete(data.timestamp); onSamples(samples, data.sampleRate, context || {});
                } finally { data.close(); }
            }, error: onError });
            decoder.configure({ codec: 'opus', sampleRate: 24000, numberOfChannels: 1 });
        }
    } catch (failure) { close(); throw failure; }
    function append(samples) {
        if (closed || !encoder) return;
        for (const sample of samples) pending.push(sample);
        while (pending.length - used >= frameSamples) {
            // Eight 60 ms frames retain the former roughly half-second queue bound.
            if (encoder.encodeQueueSize >= 8) throw new Error('canvas_voice_opus_backpressure');
            const data = new AudioData({ format: 'f32-planar', sampleRate: 24000, numberOfFrames: frameSamples, numberOfChannels: 1, timestamp: inputTime, data: new Float32Array(pending.slice(used, used + frameSamples)) });
            try { encoder.encode(data); } finally { data.close(); } used += frameSamples; inputTime += frameDuration;
        }
        if (used) { pending = pending.slice(used); used = 0; }
    }
    function play(bytes, context) {
        if (closed || !decoder) return;
        if (bytes.length > 65536 || decoder.decodeQueueSize > 50 || contexts.size > 100) throw new Error('canvas_voice_opus_backpressure');
        contexts.set(outputTime, context); decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: outputTime, data: bytes })); outputTime += opusPacketDuration(bytes) * 1000;
    }
    function resetOutput() {
        if (!decoder || closed || decoder.state === 'closed') return;
        try { decoder.reset(); contexts.clear(); decoder.configure({ codec: 'opus', sampleRate: 24000, numberOfChannels: 1 }); } catch (failure) { onError(failure); }
    }
    function resetInput() {
        if (!encoder || closed) return;
        inputEpoch++; pending = []; used = 0; inputTime = 0;
        try { if (encoder.state !== 'closed') encoder.close(); startEncoder(); } catch (failure) { onError(failure); }
    }
    function close() {
        if (closed) return; closed = true; pending = []; contexts.clear();
        for (const codec of [encoder, decoder]) { try { if (codec && codec.state !== 'closed') codec.close(); } catch { /* Still close the other partial native resource. */ } }
        encoder = decoder = null;
    }
    return { append, play, resetInput, resetOutput, outputPending: () => !closed && (contexts.size > 0 || (decoder?.decodeQueueSize || 0) > 0), async flush({ pad = false } = {}) { if (!closed && encoder) { if (pad && pending.length) append(new Float32Array(frameSamples - pending.length)); await encoder.flush(); } },
        close,
    };
}
