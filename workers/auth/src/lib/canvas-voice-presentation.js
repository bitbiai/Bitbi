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
    sameAnswer(input) {
        return Boolean(this.source?.itemId && input.sourceItemId === this.source.itemId
            && this.source.key && this.source.key === this.proof?.key && this.source.afterPlayback);
    }
    output(input) {
        this.latestOutput = input.responseId;
        // Acknowledging an already committed answer cannot revoke its question.
        // Still record this output: a subsequent answer cannot borrow that proof.
        if (this.proof?.responseId !== input.responseId && !this.sameAnswer(input)) this.proof = null;
    }
    revision(before, after, projection) {
        if (!projection || this.knownRevision !== undefined && this.knownRevision !== before) this.proof = null;
        this.knownRevision = after;
    }
    replied(input) {
        this.lastReply = input.responseId;
        if (input.interrupted || this.proof?.responseId !== input.responseId
            && !(this.sameAnswer(input) && input.turn?.turnId === this.source.turnId)) this.proof = null;
    }
    interrupted(responseId) { if (this.proof?.responseId === responseId) this.proof = null; this.responses.delete(responseId); }
    user(turn, timing, revision) {
        const current = this.proof && this.latestOutput === this.proof.responseId && this.lastReply === this.proof.responseId;
        this.source = { turnId: turn.turnId, itemId: turn.itemId, key: current ? this.proof.key : null,
            questionResponseId: current ? this.proof.responseId : null,
            afterPlayback: Number.isFinite(timing?.startedAt) && timing.startedAt >= (this.proof?.playedAt ?? Infinity), revision };
    }
    canUse(proof, turn, revision) {
        return Boolean(this.proof && this.source?.key === proof.key && this.proof.key === proof.key
            && this.source.afterPlayback && this.source.turnId === turn?.turnId && this.source.questionResponseId === proof.responseId
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
