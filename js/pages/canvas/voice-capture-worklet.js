// Audio stays in memory and is sent only through the authenticated Canvas relay.
class CanvasVoiceCapture extends AudioWorkletProcessor {
    constructor() {
        super(); this.samples = new Float32Array(1024); this.used = 0; this.enabled = true; this.paused = false;
        this.port.onmessage = event => {
            if (event.data?.type === 'stop') this.enabled = false;
            if (event.data?.type === 'resume') this.paused = false;
            if (event.data?.type === 'flush') {
                this.paused = true;
                if (this.used) { const tail = this.samples.slice(0, this.used); this.port.postMessage(tail, [tail.buffer]); this.used = 0; }
                this.port.postMessage({ type: 'flushed', id: event.data.id });
            }
        };
    }
    process(inputs) {
        if (!this.enabled) return false;
        if (this.paused) return true;
        const channel = inputs[0]?.[0];
        if (channel) for (let i = 0; i < channel.length; i++) {
            this.samples[this.used++] = channel[i];
            if (this.used === this.samples.length) {
                this.port.postMessage(this.samples, [this.samples.buffer]);
                this.samples = new Float32Array(1024); this.used = 0;
            }
        }
        return true;
    }
}
registerProcessor('canvas-voice-capture', CanvasVoiceCapture);
