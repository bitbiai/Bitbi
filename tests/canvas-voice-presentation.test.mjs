import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasVoicePresentation } from '../workers/auth/src/lib/canvas-voice-presentation.js';

function heardQuestion() {
    const p = new CanvasVoicePresentation({}, {});
    p.proof = { key: 'server-proof', responseId: 'question', playedAt: 1000 };
    p.lastReply = 'question'; p.knownRevision = 4;
    return p;
}
test('only a new final source after the complete current question can use its receipt', () => {
    const p = heardQuestion(), proof = { key: 'server-proof', responseId: 'question' }, turn = { turnId: 'new-answer' };
    p.revision(4, 5, true); p.user(turn, { startedAt: 1001 }, 5);
    assert.equal(p.canUse(proof, turn, 5), true);
    assert.equal(p.canUse(proof, { turnId: 'other-input' }, 5), false);
    assert.equal(p.canUse({ ...proof, key: 'old-proof' }, turn, 5), false);
    assert.equal(p.canUse(proof, turn, 6), false, 'Untracked revisions are not silently adopted');
    p.revision(5, 6, true); assert.equal(p.canUse(proof, turn, 6), true);
    p.revision(6, 7, false); assert.equal(p.canUse(proof, turn, 7), false, 'A creative/decision change invalidates older questions');
});
test('early speech, missing timing, interrupted question and intervening assistant reply never authorize', () => {
    for (const timing of [undefined, {}, { startedAt: 999 }]) {
        const p = heardQuestion(), turn = { turnId: 'answer' };
        p.revision(4, 5, true); p.user(turn, timing, 5);
        assert.equal(p.canUse({ key: 'server-proof', responseId: 'question' }, turn, 5), false);
    }
    for (const change of [p => p.interrupted('question'), p => p.replied({ responseId: 'music-question' }), p => p.revision(9, 10, true)]) {
        const p = heardQuestion(), turn = { turnId: 'answer' };
        p.revision(4, 5, true); p.user(turn, { startedAt: 1001 }, 5); change(p);
        assert.equal(p.canUse({ key: 'server-proof', responseId: 'question' }, turn, p.knownRevision), false);
    }
});
test('the exact application question binds once to the next requested response without replacing canonical policy', () => {
    const p = new CanvasVoicePresentation({}, {}), proposal = { targetId: 'decision', prompt: 'Maximum 3000 credits. Start this film?' };
    p.propose(proposal); const trusted = { instructions: 'Server Canvas policy', tools: [] }, response = p.response(trusted);
    assert.ok(response.instructions.startsWith(trusted.instructions)); assert.ok(response.instructions.includes(JSON.stringify(proposal.prompt)));
    assert.equal(trusted.instructions, 'Server Canvas policy');
    p.created({ responseId: 'question' }); p.created({ responseId: 'another' });
    assert.equal(p.responses.get('question'), proposal); assert.equal(p.responses.has('another'), false);
    assert.equal(p.response(trusted), trusted);
    p.interrupted('question'); assert.equal(p.responses.has('question'), false);
});

test('idle or intervening speech invalidates assent while the current answer tool response retains it', () => {
    const p = heardQuestion(), proof = { key: 'server-proof', responseId: 'question' }, turn = { turnId: 'answer' };
    p.revision(4, 5, true); p.user(turn, { startedAt: 1001 }, 5);
    p.created({ responseId: 'answer-tools', sourceItemId: 'current-answer' });
    assert.equal(p.canUse(proof, turn, 5), true, 'The actual confirmation tool can execute before any new speech');
    p.output({ responseId: 'question' });
    assert.equal(p.canUse(proof, turn, 5), true, 'A duplicate of the same question does not invalidate it');
    p.output({ responseId: 'music-question' });
    assert.equal(p.canUse(proof, turn, 5), false, 'An intervening spoken question cannot borrow the earlier budget assent');
    const idle = heardQuestion();
    idle.created({ responseId: 'idle-prompt', sourceItemId: null });
    idle.revision(4, 5, true); idle.user(turn, { startedAt: 1001 }, 5);
    assert.equal(idle.canUse(proof, turn, 5), false, 'An unbound response is not persisted as a reply but still invalidates the question');
});
