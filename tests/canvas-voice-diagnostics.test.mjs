import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasVoiceTerminalDiagnostic, canvasVoiceDiagnosticCode, firstCanvasVoiceTerminalDiagnostic } from '../workers/auth/src/lib/canvas-voice-diagnostics.js';

test('terminal diagnostics retain bounded protocol evidence without private exception or provider data', () => {
    const error = Object.assign(new TypeError('private provider response'), { code: 'canvas_voice_frame_invalid', diagnosticReason: 'interruption_time',
        stack: 'private stack', cause: { token: 'private token' } });
    const result = canvasVoiceTerminalDiagnostic(error, { stage: 'client_frame', direction: 'browser_to_server', event: 'voice.interrupt',
        occurredAtMs: 100000, elapsedMs: 22466, inputSamples: 496800, outputSamples: 176160, queuedCount: 1, queuedBytes: 120, frameBytes: 60,
        responseId: 'private identity', payload: 'private audio', transcript: 'private transcript', closeReason: 'private close reason' });
    assert.deepEqual(result, { version: 1, code: 'canvas_voice_frame_invalid', stage: 'client_frame', direction: 'browser_to_server', event: 'voice.interrupt',
        reason: 'interruption_time', exceptionType: 'TypeError', occurredAtMs: 100000, elapsedMs: 22466, inputSamples: 496800, outputSamples: 176160,
        queuedCount: 1, queuedBytes: 120, frameBytes: 60 });
    assert.equal(JSON.stringify(result).includes('private'), false);
});

test('unknown diagnostic values and unbounded or fractional counts cannot become telemetry', () => {
    const result = canvasVoiceTerminalDiagnostic({ name: 'private', code: 'canvas_voice_private_key', diagnosticReason: 'private' },
        { stage: 'private', direction: 'private', event: 'private', elapsedMs: 1.5, outputSamples: Infinity, queuedCount: 900,
            frameBytes: -1, occurredAtMs: NaN });
    assert.deepEqual(result, { version: 1, code: 'canvas_voice_internal_failed', stage: 'stop', direction: 'server_internal', event: 'unknown' });
    assert.equal(canvasVoiceDiagnosticCode('canvas_voice_configuration_unconfirmed_private_key_value'), 'canvas_voice_internal_failed');
    assert.equal(canvasVoiceDiagnosticCode('canvas_voice_provider_connection_rejected_401_private_key'), 'canvas_voice_internal_failed');
});

test('existing fixed configuration and redacted startup diagnostics retain their exact safe codes', () => {
    for (const code of ['canvas_voice_configuration_unconfirmed_audio_input_transcription_language_hint_value',
        'canvas_voice_configuration_unconfirmed_tools_value_i00_qe_p00_extra_aseu_k0fu01',
        'canvas_voice_provider_not_ready_u_s0a0_o_s_k04_n0_rmodel_access_h08d76598cb3be33a',
        'canvas_voice_provider_connection_rejected_400_invalid_key', 'canvas_voice_provider_not_ready_function_call'])
        assert.equal(canvasVoiceDiagnosticCode(code), code);
});

test('first terminal cause survives Stop, late close, recovery and secondary settlement errors', () => {
    const first = canvasVoiceTerminalDiagnostic('canvas_voice_frame_invalid', { stage: 'client_frame', direction: 'browser_to_server',
        event: 'voice.interrupt', reason: 'interruption_time', occurredAtMs: 100000, elapsedMs: 22466 });
    for (const code of ['canvas_voice_stopped', 'canvas_voice_late_close', 'canvas_voice_owner_interrupted', 'canvas_voice_internal_failed'])
        assert.deepEqual(firstCanvasVoiceTerminalDiagnostic(first, code, { stage: 'settlement', occurredAtMs: 900000 }), first);
    assert.equal(firstCanvasVoiceTerminalDiagnostic(null, 'canvas_voice_owner_interrupted', { stage: 'recovery' }).stage, 'recovery');
});
