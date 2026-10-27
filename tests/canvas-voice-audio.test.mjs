import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceResampler, encodeVoiceAudio, decodeVoiceAudio } from '../js/shared/canvas-voice-audio.mjs';

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
