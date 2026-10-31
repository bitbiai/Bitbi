import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasVoicePresentation } from '../workers/auth/src/lib/canvas-voice-presentation.js';

function heardQuestion() {
    const p = new CanvasVoicePresentation({}, {});
    p.proof = { key: 'server-proof', responseId: 'question', playedAt: 1000 };
    p.lastReply = 'question'; p.latestOutput = 'question'; p.knownRevision = 4;
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

test('a prelude to the committed answer preserves only that answer’s question proof', () => {
    for (const completed of [false, true]) {
        const p = heardQuestion(), proof = { key: 'server-proof', responseId: 'question' };
        const turn = { turnId: 'answer', itemId: 'input-answer' };
        p.revision(4, 5, true); p.user(turn, { startedAt: 1001 }, 5);
        p.output({ responseId: 'acknowledgement', sourceItemId: 'input-answer' });
        if (completed) {
            p.revision(5, 6, true);
            p.replied({ responseId: 'acknowledgement', sourceItemId: 'input-answer', turn });
        }
        assert.equal(p.canUse(proof, turn, p.knownRevision), true, 'The final answer preceded its own spoken acknowledgement');
        p.user({ turnId: 'next-answer', itemId: 'next-input' }, { startedAt: 2000 }, p.knownRevision);
        assert.equal(p.canUse(proof, { turnId: 'next-answer' }, p.knownRevision), false, 'A new answer to the prelude cannot borrow the older question');
    }
    for (const sourceItemId of [undefined, null, '', 'foreign-input']) {
        const p = heardQuestion(), turn = { turnId: 'answer', itemId: 'input-answer' };
        p.revision(4, 5, true); p.user(turn, { startedAt: 1001 }, 5);
        p.output({ responseId: 'other-question', sourceItemId });
        assert.equal(p.canUse({ key: 'server-proof', responseId: 'question' }, turn, 5), false);
    }
    const uncommitted = heardQuestion();
    uncommitted.output({ responseId: 'early-prelude', sourceItemId: 'input-answer' });
    uncommitted.revision(4, 5, true); uncommitted.user({ turnId: 'answer', itemId: 'input-answer' }, { startedAt: 1001 }, 5);
    assert.equal(uncommitted.canUse({ key: 'server-proof', responseId: 'question' }, { turnId: 'answer' }, 5), false);
});
