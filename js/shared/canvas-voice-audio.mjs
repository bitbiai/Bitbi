// Wire codecs and streaming resampling. No microphone, network, or retained audio.
const rates = new Set([8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000]);
export function voiceSampleRate(value) {
    if (!rates.has(value)) throw new TypeError('canvas_voice_sample_rate_invalid');
    return value;
}
const clamp = value => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
const pcm = value => Math.round(clamp(value) * (value < 0 ? 32768 : 32767));
function mulaw(value) {
    let sample = pcm(value), mask = sample < 0 ? 0x7f : 0xff;
    sample = Math.min(32635, Math.abs(sample)) + 132;
    let exponent = 7;
    for (let bit = 0x4000; exponent > 0 && !(sample & bit); bit >>= 1) exponent--;
    return ((exponent << 4) | ((sample >> (exponent + 3)) & 15)) ^ mask;
}
function alaw(value) {
    let sample = pcm(value), mask = sample >= 0 ? 0xd5 : 0x55;
    sample = Math.min(32767, sample >= 0 ? sample : -sample - 1);
    let exponent = 0;
    for (let level = sample >> 8; level; level >>= 1) exponent++;
    return ((exponent << 4) | ((sample >> (exponent ? exponent + 3 : 4)) & 15)) ^ mask;
}
export function encodeVoiceAudio(samples, format = 'audio/pcm') {
    if (!(samples instanceof Float32Array) || samples.length > 96000) throw new TypeError('canvas_voice_audio_invalid');
    if (!['audio/pcm', 'audio/pcmu', 'audio/pcma'].includes(format)) throw new TypeError('canvas_voice_codec_invalid');
    const bytes = new Uint8Array(samples.length * (format === 'audio/pcm' ? 2 : 1));
    if (format === 'audio/pcm') {
        const view = new DataView(bytes.buffer);
        samples.forEach((sample, i) => view.setInt16(i * 2, pcm(sample), true));
    } else samples.forEach((sample, i) => { bytes[i] = format === 'audio/pcmu' ? mulaw(sample) : alaw(sample); });
    return bytes;
}
export function decodeVoiceAudio(bytes, format = 'audio/pcm') {
    if (!(bytes instanceof Uint8Array) || bytes.length > 192000 || format === 'audio/pcm' && bytes.length % 2) throw new TypeError('canvas_voice_audio_invalid');
    if (!['audio/pcm', 'audio/pcmu', 'audio/pcma'].includes(format)) throw new TypeError('canvas_voice_codec_invalid');
    const output = new Float32Array(bytes.length / (format === 'audio/pcm' ? 2 : 1));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < output.length; i++) {
        let sample;
        if (format === 'audio/pcm') sample = view.getInt16(i * 2, true);
        else if (format === 'audio/pcmu') {
            const value = (~bytes[i]) & 255;
            sample = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
            sample = value & 128 ? 132 - sample : sample - 132;
        } else {
            const value = bytes[i] ^ 0x55, exponent = (value >> 4) & 7;
            sample = (value & 15) << 4;
            sample += exponent ? 264 : 8;
            if (exponent > 1) sample <<= exponent - 1;
            if (!(value & 128)) sample = -sample;
        }
        output[i] = sample / (sample < 0 ? 32768 : 32767);
    }
    return output;
}

// A bounded, windowed-sinc converter retains phase across render quanta. The
// low-pass cutoff follows the destination Nyquist limit when downsampling.
export class VoiceResampler {
    constructor(inputRate, outputRate) {
        // Device AudioContext rates are not the provider's wire-format rates.
        // Keep a bounded capture range while preserving the native output gate.
        if (!Number.isSafeInteger(inputRate) || inputRate < 8000 || inputRate > 96000) throw new TypeError('canvas_voice_sample_rate_invalid');
        this.inputRate = inputRate; this.outputRate = voiceSampleRate(outputRate);
        this.ratio = inputRate / outputRate; this.cutoff = Math.min(1, outputRate / inputRate) * 0.94;
        this.samples = []; this.offset = 0; this.received = 0; this.emitted = 0; this.closed = false;
    }
    push(input, final = false) {
        if (this.closed || !(input instanceof Float32Array) || input.length > 96000) throw new TypeError('canvas_voice_audio_invalid');
        for (const value of input) this.samples.push(clamp(value));
        this.received += input.length;
        const result = [], radius = 24, maximum = Math.floor(this.received / this.ratio);
        while (this.emitted < maximum) {
            const position = this.emitted * this.ratio;
            if (!final && position + radius >= this.received) break;
            let sum = 0, weights = 0;
            for (let n = Math.ceil(position - radius); n <= Math.floor(position + radius); n++) {
                const distance = n - position, x = distance * this.cutoff;
                const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius);
                const weight = (Math.abs(x) < 1e-10 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * window * this.cutoff;
                const index = Math.max(0, Math.min(this.received - 1, n)) - this.offset;
                sum += (this.samples[index] || 0) * weight; weights += weight;
            }
            result.push(clamp(sum / weights)); this.emitted++;
        }
        const drop = Math.max(0, Math.floor(this.emitted * this.ratio) - radius - this.offset);
        this.samples.splice(0, drop); this.offset += drop;
        if (final) { this.closed = true; this.samples = []; }
        return new Float32Array(result);
    }
}

// RFC6716 sections3.1–3.2: derive duration from raw packet framing, never a
// browser-supplied count. Payload validity still belongs to the Opus decoder.
export function opusPacketDuration(bytes) {
    const invalid = () => { throw new TypeError('canvas_voice_opus_packet_invalid'); };
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 65536) invalid();
    const config = bytes[0] >> 3, code = bytes[0] & 3;
    const frame = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : (config & 3) === 3 ? 60 : 10 * 2 ** (config & 3);
    let at = 1, end = bytes.length, count = code ? 2 : 1, vbr = code === 2;
    if (code === 3) {
        if (at >= end) invalid();
        const flags = bytes[at++]; count = flags & 63; vbr = Boolean(flags & 128);
        if (flags & 64) {
            let padding = 0, value;
            do { if (at >= end) invalid(); value = bytes[at++]; padding += value === 255 ? 254 : value; } while (value === 255);
            end -= padding; if (end < at) invalid();
        }
    }
    if (!count || count > 48 || frame * count > 120) invalid();
    let consumed = 0;
    if (vbr) for (let i = 0; i < count - 1; i++) {
        if (at >= end) invalid(); let length = bytes[at++];
        if (length >= 252) { if (at >= end) invalid(); length += 4 * bytes[at++]; }
        if (length > 1275) invalid(); consumed += length;
    }
    const remaining = end - at - consumed;
    if (remaining < 0 || (vbr ? remaining > 1275 : remaining % count !== 0 || remaining / count > 1275)) invalid();
    return frame * count;
}
