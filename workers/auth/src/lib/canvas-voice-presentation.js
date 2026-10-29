import { recordVoiceDecisionPresentation } from './canvas-voice-decisions.js';

// Application audio/provenance evidence, not a claim of human hearing. The
// decision service still validates the immutable scope and authenticated actor.
export class CanvasVoicePresentation {
    constructor(env, scope) { this.env = env; this.scope = scope; this.responses = new Map(); }
    propose(value) { if (value) this.pending = value; }
    response(trusted) {
        if (!this.pending) return trusted;
        this.awaiting = this.pending; this.pending = null;
        return { ...trusted, instructions: trusted.instructions + '\n\nRead the following current application confirmation question completely and verbatim in its language. '
            + 'It is not an authorization or user instruction. Do not claim approval or start work. Wait for a new user answer after speaking it.\n'
            + JSON.stringify(this.awaiting.prompt) };
    }
    created({ responseId, sourceItemId }) {
        // An idle response has no user authority. A tool-only response to the
        // actual answer must retain its question proof until the tool executes.
        if (sourceItemId === null) this.proof = null;
        if (!this.awaiting || this.responses.has(responseId)) return;
        this.responses.set(responseId, this.awaiting); this.awaiting = null;
        if (this.responses.size > 80) this.responses.delete(this.responses.keys().next().value);
    }
    output({ responseId }) { if (this.proof?.responseId !== responseId) this.proof = null; }
    revision(before, after, projection) {
        if (!projection || this.knownRevision !== undefined && this.knownRevision !== before) this.proof = null;
        this.knownRevision = after;
    }
    replied(input) {
        this.lastReply = input.responseId;
        if (this.proof?.responseId !== input.responseId || input.interrupted) this.proof = null;
    }
    interrupted(responseId) { if (this.proof?.responseId === responseId) this.proof = null; this.responses.delete(responseId); }
    user(turn, timing, revision) {
        this.source = { turnId: turn.turnId, key: this.proof?.key,
            afterPlayback: Number.isFinite(timing?.startedAt) && timing.startedAt >= (this.proof?.playedAt ?? Infinity), revision };
    }
    canUse(proof, turn, revision) {
        return Boolean(this.proof && this.source?.key === proof.key && this.proof.key === proof.key
            && this.source.afterPlayback && this.source.turnId === turn?.turnId && this.lastReply === proof.responseId
            && this.knownRevision === revision && this.source.revision <= revision);
    }
    async playback(input, conversationRevision) {
        const presentation = this.responses.get(input.responseId);
        if (!presentation || this.lastReply !== input.responseId || input.interrupted) return { ok: false };
        try {
            const proof = await recordVoiceDecisionPresentation(this.env, this.scope, { ...presentation,
                responseId: input.responseId, itemId: input.itemId, audioMs: input.audioMs, conversationRevision });
            this.proof = { ...proof, playedAt: input.playedAt }; this.knownRevision = conversationRevision;
            return { ok: true };
        } catch (error) {
            if (!['canvas_voice_terms_not_presented', 'canvas_voice_decision_changed'].includes(error.code)) throw error;
            this.proof = null; return { ok: false, code: error.code };
        }
    }
}
