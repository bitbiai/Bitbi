import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { VoiceResampler, encodeVoiceAudio, decodeVoiceAudio } from '../js/shared/canvas-voice-audio.mjs';
import { canvasVoiceSettings } from '../js/shared/canvas-voice-settings.mjs';

// Browser .js modules are ESM, although the repository package is CommonJS.
// Load their actual source as ESM under Node and Playwright discovery alike;
// only exact dependency URLs and the original asset URL base are substituted.
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const wireUrl = new URL('../js/shared/canvas-voice-audio.mjs', import.meta.url).href;
function browserSource(name, imports) {
    const url = new URL('../js/pages/canvas/' + name, import.meta.url);
    let source = fs.readFileSync(url, 'utf8');
    for (const [specifier, target] of Object.entries(imports)) {
        const literal = `'${specifier}'`;
        assert.equal(source.split(literal).length, 2, `Exactly one expected browser import: ${specifier}`);
        source = source.replace(literal, JSON.stringify(target));
    }
    assert.doesNotMatch(source, /\bfrom\s+['"]\./, 'Unmapped browser dependency must fail explicitly');
    return source.replaceAll('import.meta.url', JSON.stringify(url.href));
}
const wireImports = { '../../shared/canvas-voice-audio.mjs?v=__ASSET_VERSION__': wireUrl };
const opusSource = browserSource('voice-opus.js', wireImports), opusUrl = moduleUrl(opusSource);
const { createCanvasVoiceOpus, canvasVoiceOpusSupport } = await import(opusUrl);
const { createCanvasVoiceAudio } = await import(moduleUrl(browserSource('voice-audio.js', { ...wireImports, './voice-opus.js?v=__ASSET_VERSION__': opusUrl })));

test('browser audio loader preserves actual module linkage and rejects an incompatible dependency', async () => {
    assert.equal(typeof createCanvasVoiceAudio, 'function'); assert.equal(typeof createCanvasVoiceOpus, 'function');
    const brokenOpus = moduleUrl(opusSource.replace('export async function createCanvasVoiceOpus(', 'export async function missingCanvasVoiceOpus('));
    const brokenAudio = browserSource('voice-audio.js', { ...wireImports, './voice-opus.js?v=__ASSET_VERSION__': brokenOpus });
    await assert.rejects(import(moduleUrl(brokenAudio)), /does not provide an export named 'createCanvasVoiceOpus'/);
    assert.throws(() => browserSource('voice-audio.js', wireImports), /Unmapped browser dependency/);
});

// The real worklet, controller, resampler and encoder run together; only browser
// resource allocation is synthetic. Transfer/delivery can be delayed explicitly.
async function captureHarness(t, deviceRate = 48000, format = { type: 'audio/pcm', rate: 24000 }, accept = () => true) {
    const packets = [], errors = [], delayed = []; let capture, processor, hold = false;
    const descriptors = new Map(['AudioContext', 'AudioWorkletNode', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const track = { enabled: true, stopped: false, addEventListener() {}, stop() { this.stopped = true; } };
    const stream = { active: true, getTracks: () => [track], getAudioTracks: () => [track] };
    let Processor;
    vm.runInNewContext(fs.readFileSync(new URL('../js/pages/canvas/voice-capture-worklet.js', import.meta.url), 'utf8'), {
        Float32Array,
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage(message, transfer) {
            const data = structuredClone(message, { transfer }); if (hold) delayed.push(data); else capture.port.onmessage?.({ data });
        } }; } },
        registerProcessor(name, value) { assert.equal(name, 'canvas-voice-capture'); Processor = value; },
    });
    const node = () => ({ connect() {}, disconnect() {} });
    class AudioContext {
        sampleRate = deviceRate; state = 'running'; destination = {}; audioWorklet = { async addModule() {} };
        async resume() {} async close() { this.state = 'closed'; }
        createMediaStreamSource() { return node(); } createGain() { return { ...node(), gain: {} }; }
    }
    class AudioWorkletNode {
        constructor(context, name, options) { capture = this; processor = new Processor(options); this.port = { onmessage: null, postMessage: data => processor.port.onmessage({ data }), close() {} }; }
        connect() {} disconnect() {}
    }
    for (const [key, value] of Object.entries({ AudioContext, AudioWorkletNode, navigator: { mediaDevices: { async getUserMedia() { return stream; } } } })) Object.defineProperty(globalThis, key, { configurable: true, value });
    const audio = createCanvasVoiceAudio({ settings: canvasVoiceSettings({ audio: { input: { format } } }), onAudio(value) { packets.push(new Uint8Array(Buffer.from(value, 'base64'))); return accept(value); }, onError: error => errors.push(error.code || error.message) });
    t.after(() => { audio.stop(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
    await audio.open(); audio.ready();
    return { audio, packets, errors, track, feed(samples) { for (let at = 0; at < samples.length; at += 128) processor.process([[samples.slice(at, at + 128)]]); },
        hold(value) { hold = value; }, deliver() { const handler = capture.port.onmessage; for (const data of delayed.splice(0)) handler?.({ data }); },
        lateHandler: () => capture.port.onmessage, flushEvent: data => capture.port.onmessage?.({ data }), processor: () => processor,
    };
}

test('PCM16 is signed little endian; G.711 wire silence and polarity match independent vectors', () => {
    assert.deepEqual([...encodeVoiceAudio(new Float32Array([-1, 0, 1]))], [0, 128, 0, 0, 255, 127]);
    assert.deepEqual([...decodeVoiceAudio(new Uint8Array([0, 128, 0, 0, 255, 127]))], [-1, 0, 1]);
    assert.equal(encodeVoiceAudio(new Float32Array([0]), 'audio/pcmu')[0], 255);
    assert.equal(encodeVoiceAudio(new Float32Array([0]), 'audio/pcma')[0], 213);
    assert.equal(decodeVoiceAudio(new Uint8Array([255]), 'audio/pcmu')[0], 0);
    assert.ok(decodeVoiceAudio(new Uint8Array([0]), 'audio/pcmu')[0] < -0.97);
    assert.ok(decodeVoiceAudio(new Uint8Array([128]), 'audio/pcmu')[0] > 0.97);
    assert.ok(decodeVoiceAudio(new Uint8Array([0x2a]), 'audio/pcma')[0] < -0.97);
    assert.ok(decodeVoiceAudio(new Uint8Array([0xaa]), 'audio/pcma')[0] > 0.97);
});
test('wire bounds and incomplete PCM fail, unsupported formats never masquerade as PCM', () => {
    assert.throws(() => decodeVoiceAudio(new Uint8Array([1])));
    assert.throws(() => encodeVoiceAudio(new Float32Array(1), 'opus'));
    assert.throws(() => decodeVoiceAudio(new Uint8Array(192001)));
    assert.throws(() => new VoiceResampler(0, 24000));
    assert.throws(() => new VoiceResampler(96001, 24000));
    assert.throws(() => new VoiceResampler(48000, 96000));
});
for (const rate of [44100, 48000, 96000]) test(`${rate} Hz resampling preserves phase across irregular chunks and exact sample count`, () => {
    const signal = Float32Array.from({length:rate}, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate) * 0.6);
    const whole = new VoiceResampler(rate, 24000).push(signal, true);
    const stream = new VoiceResampler(rate, 24000), pieces = [];
    for (let n = 0; n < signal.length; n += 137) pieces.push(...stream.push(signal.slice(n, n + 137)));
    pieces.push(...stream.push(new Float32Array(0), true));
    assert.equal(whole.length, 24000); assert.equal(pieces.length, 24000);
    for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(whole[i] - pieces[i]) < 1e-7);
    const error = whole.slice(100, -100).reduce((sum, v, i) => sum + (v - Math.sin(2 * Math.PI * 440 * (i + 100) / 24000) * 0.6) ** 2, 0);
    assert.ok(error / 23800 < 1e-5);
    assert.throws(() => stream.push(signal));
});
test('downsampling filters above destination Nyquist instead of aliasing it into speech', () => {
    for (const rate of [48000, 96000]) {
        const input = Float32Array.from({length:rate}, (_, i) => Math.sin(2 * Math.PI * 18000 * i / rate));
        const output = new VoiceResampler(rate, 24000).push(input, true).slice(100, -100);
        const rms = Math.sqrt(output.reduce((sum, v) => sum + v * v, 0) / output.length);
        assert.ok(rms < 0.01, `${rate} Hz alias RMS ${rms}`);
    }
});
test('G.711 encode/decode preserves speech amplitude with bounded quantization', () => {
    const signal = Float32Array.from({length:8000}, (_, i) => Math.sin(2 * Math.PI * 440 * i / 8000) * 0.8);
    for (const codec of ['audio/pcmu', 'audio/pcma']) {
        const output = decodeVoiceAudio(encodeVoiceAudio(signal, codec), codec);
        for (let i = 0; i < output.length; i++) assert.ok(Math.abs(output[i] - signal[i]) < 0.04);
    }
});
const inputFormats = [8000, 16000, 22050, 24000, 32000, 44100, 48000].map(rate => ({ type: 'audio/pcm', rate }));
inputFormats.push({ type: 'audio/pcmu', rate: 8000 }, { type: 'audio/pcma', rate: 8000 });
for (const deviceRate of [44100, 48000, 96000]) for (const format of inputFormats) test(`capture ${deviceRate} → ${format.type}/${format.rate} batches ~100ms without loss and flushes its exact tail`, async t => {
    const h = await captureHarness(t, deviceRate, format);
    const signal = Float32Array.from({ length: Math.floor(deviceRate * .257) }, (_, i) => Math.sin(2 * Math.PI * 440 * i / deviceRate) * .6);
    h.feed(signal); assert.equal(h.packets.length, 2, 'render quanta must not each become a network message');
    await h.audio.finishTurn(); assert.equal(h.packets.length, 3);
    const bytesPerSample = format.type === 'audio/pcm' ? 2 : 1, packetSamples = Math.ceil(format.rate / 10);
    assert.equal(h.packets[0].length, packetSamples * bytesPerSample); assert.equal(h.packets[1].length, packetSamples * bytesPerSample);
    const actual = Buffer.concat(h.packets), expected = encodeVoiceAudio(new VoiceResampler(deviceRate, format.rate).push(signal, true), format.type);
    assert.deepEqual(actual, Buffer.from(expected)); assert.equal(actual.length / bytesPerSample, Math.floor(signal.length * format.rate / deviceRate));
    assert.notDeepEqual(Buffer.concat(h.packets.slice(1)), Buffer.from(expected), 'a dropped packet is detected independently');
    h.feed(new Float32Array(deviceRate)); assert.equal(h.packets.length, 3, 'manual completion pauses capture');
    h.audio.continueCapture(); h.feed(signal); await h.audio.finishTurn(); assert.equal(h.packets.length, 6);
    assert.deepEqual(Buffer.concat(h.packets.slice(3)), Buffer.from(expected)); assert.deepEqual(h.errors, []);
});
test('mute discards resampler, worklet and packet tails, including already posted stale frames after unmute', async t => {
    const h = await captureHarness(t);
    h.feed(new Float32Array(1800).fill(.7)); assert.equal(h.packets.length, 0);
    h.hold(true); h.feed(new Float32Array(1300).fill(.7));
    h.audio.mute(true); assert.equal(h.track.enabled, false); h.audio.mute(false); assert.equal(h.track.enabled, true);
    h.hold(false); h.deliver();
    const fresh = new Float32Array(700).fill(-.3); h.feed(fresh); await h.audio.finishTurn();
    const expected = encodeVoiceAudio(new VoiceResampler(48000, 24000).push(fresh, true));
    assert.deepEqual(Buffer.concat(h.packets), Buffer.from(expected)); assert.deepEqual(h.errors, []);
});
test('stop and mute during a pending flush cannot send a tail or revive capture', async t => {
    const h = await captureHarness(t); h.feed(new Float32Array(1700).fill(.5)); h.hold(true);
    const handler = h.lateHandler(), pending = h.audio.finishTurn();
    h.audio.mute(true); await assert.rejects(pending, /canvas_voice_stopped/);
    h.audio.stop(); h.audio.continueCapture(); h.audio.ready(); h.audio.mute(false); h.hold(false); h.deliver();
    handler({ data: { generation: 0, samples: new Float32Array(1024).fill(.5) } });
    assert.equal(h.packets.length, 0); assert.equal(h.track.stopped, true); assert.equal(h.audio.stopped(), true); assert.deepEqual(h.errors, []);
});
test('unmuting preserves the independent manual-turn pause until continueCapture', async t => {
    const h = await captureHarness(t); const signal = new Float32Array(700).fill(.4);
    h.feed(signal); await h.audio.finishTurn(); assert.equal(h.packets.length, 1);
    h.audio.mute(true); h.audio.mute(false); h.feed(new Float32Array(12000).fill(.4)); assert.equal(h.packets.length, 1);
    h.audio.continueCapture(); h.feed(signal); await h.audio.finishTurn(); assert.equal(h.packets.length, 2);
    assert.deepEqual(h.packets[0], h.packets[1]); assert.deepEqual(h.errors, []);
});
test('transport refusal stops at the first packet instead of draining more capture', async t => {
    const h = await captureHarness(t, 48000, { type: 'audio/pcm', rate: 24000 }, () => false);
    h.feed(new Float32Array(12000).fill(.5));
    assert.equal(h.packets.length, 1); assert.equal(h.audio.stopped(), true); assert.equal(h.track.stopped, true);
    assert.deepEqual(h.errors, ['canvas_voice_transport_backpressure']);
});
test('new worklet retains raw Float32Array and flush acknowledgement for a cached legacy controller', () => {
    const messages = []; let Processor;
    vm.runInNewContext(fs.readFileSync(new URL('../js/pages/canvas/voice-capture-worklet.js', import.meta.url), 'utf8'), {
        Float32Array, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (message, transfer) => messages.push(structuredClone(message, { transfer })) }; } },
        registerProcessor(name, value) { Processor = value; },
    });
    const processor = new Processor(); processor.process([[new Float32Array(1200).fill(.4)]]);
    processor.port.onmessage({ data: { type: 'flush', id: 7 } });
    assert.equal(messages.length, 3); assert.ok(messages[0] instanceof Float32Array); assert.ok(messages[1] instanceof Float32Array);
    assert.equal(messages[0].length, 1024); assert.equal(messages[1].length, 176); assert.deepEqual(messages[2], { type: 'flushed', id: 7 });
    assert.ok([...messages[0], ...messages[1]].every(sample => Math.abs(sample - .4) < 1e-6));
});
function opusHarness(t) {
    const encoders = [], frames = [], packets = [], errors = [];
    const descriptors = new Map(['AudioEncoder', 'AudioDecoder', 'AudioData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    class AudioEncoder {
        static async isConfigSupported(config) { return { supported: true, config }; }
        constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0; encoders.push(this); }
        configure(config) { this.config = config; this.state = 'configured'; }
        encode(data) { frames.push(data); this.encodeQueueSize++; }
        async flush() { this.encodeQueueSize = 0; }
        close() { this.state = 'closed'; }
    }
    class AudioDecoder { static async isConfigSupported(config) { return { supported: true, config }; } }
    class AudioData { constructor(data) { Object.assign(this, data); } close() {} }
    for (const [key, value] of Object.entries({ AudioEncoder, AudioDecoder, AudioData })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
    const chunk = duration => ({ byteLength: 2, copyTo(bytes) { bytes.set([duration === 60 ? 24 : 8, 1]); } });
    return { encoders, frames, packets, errors, chunk, async create() { const codec = await createCanvasVoiceOpus({ encode: true, decode: false, onPacket: bytes => packets.push(bytes), onSamples() {}, onError: error => errors.push(error.message) }); t.after(() => codec.close()); return codec; } };
}
test('Opus emits individual60ms packets, clears unsent input on reset and rejects ignored frame configuration', async t => {
    const h = opusHarness(t), codec = await h.create();
    codec.append(new Float32Array(1000).fill(.6)); assert.equal(h.frames.length, 0);
    const old = h.encoders[0]; codec.resetInput(); codec.append(new Float32Array(440).fill(-.3)); assert.equal(h.frames.length, 0);
    codec.append(new Float32Array(1000).fill(-.3)); assert.equal(h.frames.length, 1); assert.equal(h.frames[0].numberOfFrames, 1440); assert.equal(h.frames[0].timestamp, 0);
    assert.ok([...h.frames[0].data].every(sample => Math.abs(sample + .3) < 1e-6));
    old.callbacks.output(h.chunk(60)); old.callbacks.error(new Error('stale')); assert.equal(h.packets.length, 0); assert.deepEqual(h.errors, []);
    h.encoders[1].callbacks.output(h.chunk(60)); assert.equal(h.packets.length, 1);
    h.encoders[1].callbacks.output(h.chunk(20)); assert.equal(h.packets.length, 1); assert.deepEqual(h.errors, ['canvas_voice_opus_unavailable']);
    AudioEncoder.isConfigSupported = async () => ({ supported: true, config: { codec: 'opus' } }); assert.equal(await canvasVoiceOpusSupport(), false);
});
test('Opus retains a bounded encode queue and pads only an explicitly flushed partial frame', async t => {
    const h = opusHarness(t), codec = await h.create();
    codec.append(new Float32Array(319).fill(.2)); await codec.flush({ pad: true });
    assert.equal(h.frames.length, 1); assert.equal(h.frames[0].data.length, 1440); assert.ok(h.frames[0].data.slice(319).every(sample => sample === 0));
    codec.resetInput(); assert.throws(() => codec.append(new Float32Array(1440 * 9)), /canvas_voice_opus_backpressure/);
    assert.equal(h.encoders.at(-1).encodeQueueSize, 8); assert.equal(h.frames.length, 9);
});
test('mute during asynchronous Opus flush rejects completion and drops late native output', async t => {
    const h = opusHarness(t), capture = await captureHarness(t, 48000, { type: 'audio/opus', rate: 24000 });
    const old = h.encoders[0]; let resolveFlush; old.flush = () => new Promise(resolve => { resolveFlush = resolve; });
    capture.feed(new Float32Array(3500).fill(.5)); const pending = capture.audio.finishTurn(); await Promise.resolve();
    assert.equal(typeof resolveFlush, 'function'); capture.audio.mute(true); capture.audio.mute(false);
    old.callbacks.output(h.chunk(60)); resolveFlush(); await assert.rejects(pending, /canvas_voice_stopped/);
    assert.equal(capture.packets.length, 0); assert.deepEqual(capture.errors, []); capture.audio.stop();
    h.encoders.at(-1).callbacks.output(h.chunk(60)); assert.equal(capture.packets.length, 0);
});
