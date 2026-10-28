// Audio stays in memory and is sent only through the authenticated Canvas relay.
class CanvasVoiceCapture extends AudioWorkletProcessor {
    constructor(options) {
        super(); this.samples = new Float32Array(1024); this.used = 0; this.enabled = true; this.paused = false; this.generation = 0;
        // A cached controller can load this path later; only new callers opt
        // into generation-tagged frames. Legacy callers retain raw samples.
        this.envelope = options?.processorOptions?.generationEnvelope === true;
        this.port.onmessage = event => {
            if (event.data?.type === 'stop') this.enabled = false;
            if (event.data?.type === 'resume') this.paused = false;
            if (event.data?.type === 'reset') { this.used = 0; this.generation = event.data.generation; this.paused = event.data.paused; }
            if (event.data?.type === 'flush') {
                this.paused = true;
                if (this.used) { const tail = this.samples.slice(0, this.used); this.sendSamples(tail); this.used = 0; }
                this.port.postMessage({ type: 'flushed', id: event.data.id, ...(this.envelope ? { generation: this.generation } : {}) });
            }
        };
    }
    sendSamples(samples) { this.port.postMessage(this.envelope ? { samples, generation: this.generation } : samples, [samples.buffer]); }
    process(inputs) {
        if (!this.enabled) return false;
        if (this.paused) return true;
        const channel = inputs[0]?.[0];
        if (channel) for (let i = 0; i < channel.length; i++) {
            this.samples[this.used++] = channel[i];
            if (this.used === this.samples.length) {
                this.sendSamples(this.samples);
                this.samples = new Float32Array(1024); this.used = 0;
            }
        }
        return true;
    }
}
registerProcessor('canvas-voice-capture', CanvasVoiceCapture);
