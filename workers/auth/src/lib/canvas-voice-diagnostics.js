// Content-free terminal evidence. No provider message, argument, transcript,
// socket reason, exception message/stack or arbitrary property reaches storage.
const codes = new Set(`admission_denied admission_expired admission_failed audio_invalid audio_limit audio_rate_exceeded audio_unassociated auth_session_required authority_changed
backpressure_frame backpressure_count backpressure_bytes billing_review_required command_forbidden configuration_unconfirmed
brief_invalid connection_failed consent_required context_changed disabled disconnected duration_unconfirmed ended event_limit exposure_changed exposure_exceeded exposure_invalid
format_ambiguous format_invalid format_unavailable frame_invalid internal_failed interruption_invalid late_close manual_turn_unavailable metadata_invalid not_ready outcome_invalid outcome_unknown owner_interrupted owner_unavailable policy_missing
protocol_failed provider_connection_unknown provider_error provider_event_invalid provider_identity_invalid provider_not_configured
provider_unavailable quote_changed quote_expired quote_invalid read_only_turn replay_conflict reply_invalid resource_invalid resumption_changed resumption_invalid retained_text_unverified scope_invalid sequence_gap session_already_connected session_expired
session_invalid session_limit session_not_found session_unavailable settings_changed settings_invalid source_changed stopped tool_arguments_invalid tool_failed
tool_forbidden tool_limit tool_response_unknown tools_invalid transcript_invalid transcript_pending truncation_unconfirmed turn_limit turn_unavailable`
    .split(/\s+/).map(value => 'canvas_voice_' + value));
for (const code of ['canvas_agent_conversation_changed', 'canvas_agent_conversation_stopped', 'canvas_agent_conversation_allowance_required',
    'canvas_agent_dialogue_context_limit', 'idempotency_conflict']) codes.add(code);
const events = new Set(`audio.append audio.commit voice.stop voice.mute voice.interrupt voice.playback ping session.created conversation.created session.updated
conversation.item.created conversation.item.added conversation.item.deleted conversation.item.truncated
input_audio_buffer.speech_started input_audio_buffer.speech_stopped input_audio_buffer.committed input_audio_buffer.cleared input_audio_buffer.timeout_triggered
conversation.item.input_audio_transcription.updated conversation.item.input_audio_transcription.completed
response.created response.done response.output_item.added response.output_item.done response.output_audio.delta response.audio.delta
response.output_audio.done response.output_audio_transcript.delta response.output_audio_transcript.done response.function_call_arguments.done
error close message binary stop_request timer alarm`.split(/\s+/));
const stages = new Set(['authority', 'client_frame', 'provider_frame', 'user_turn', 'reply_projection', 'tool', 'response', 'configuration',
    'exposure', 'queue', 'socket', 'connect', 'settlement', 'recovery', 'deadline', 'checkpoint', 'stop', 'playback']);
const directions = new Set(['browser_to_server', 'provider_to_server', 'server_internal']);
const reasons = new Set(['payload_type', 'payload_size', 'json', 'payload_shape', 'sequence_value', 'muted_type', 'interruption_time',
    'frame', 'count', 'bytes', 'normal_close', 'abnormal_close', 'playback_time']);
const exceptionTypes = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError']);
const ackFields = 'event|session|model|instructions|voice|reasoning(?:_effort)?|turn_detection(?:_type|_idle_timeout_ms)?|resumption(?:_enabled)?|replace|audio(?:_input(?:_format(?:_type|_rate)?|_transport|_transcription(?:_model|_language_hint|_keyterms)?)?|_output(?:_format(?:_type|_rate)?|_transport|_speed)?)?';
const ackCode = new RegExp('^canvas_voice_configuration_unconfirmed_(?:' + ackFields + ')_(?:missing|type|value)$');
const toolAckCode = /^canvas_voice_configuration_unconfirmed_tools_(?:missing|type|value)_i[a-f0-9]{2}_q[swel]_p[a-f0-9]{2}_(?:missing|type|value|mixed|extra|duplicate|identity|length)_a[zaosnbux]e[zaosnbux]_k[a-f0-9]{2}u[a-f0-9]{2}(?:_c[a-f0-9]{2}d[a-f0-9]{2})?$/;
const startupCode = /^canvas_voice_provider_not_ready_(?:session_updated|speech_started|speech_stopped|input_committed|input_cleared|idle_timeout|dtmf|item_deleted|item_truncated|input_transcript|input_transcript_done|response_created|response_done|output_item|output_item_done|content_part|content_done|audio_delta|audio_done|transcript_delta|transcript_done|text_delta|function_delta|function_call|mcp_discovery|mcp_discovered|mcp_failed|mcp_arguments|mcp_arguments_done|mcp_call|mcp_completed|mcp_call_failed)$/;
const startupShape = /^canvas_voice_provider_not_ready_u_s[01]a0_[oap]_[msn]_k[a-f0-9]{2}_n(?:0|[1-7][a-z0-9]{1,2})_r(?:none|invalid_key|auth|permission|quota|not_found|argument|rate_limit|model_access|handshake)(?:_h[a-f0-9]{16})?$/;
const rejectionCode = /^canvas_voice_provider_connection_rejected_[1-5][0-9]{2}(?:_(?:invalid_key|auth|permission|quota|not_found|argument|rate_limit|model_access|handshake))?$/;
const bounded = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined;
export function canvasVoiceDiagnosticCode(value) {
    return typeof value === 'string' && value.length <= 180 && (codes.has(value) || ackCode.test(value) || toolAckCode.test(value)
        || startupCode.test(value) || startupShape.test(value) || rejectionCode.test(value)) ? value : 'canvas_voice_internal_failed';
}
export function canvasVoiceTerminalDiagnostic(error, input = {}) {
    const code = canvasVoiceDiagnosticCode(typeof error === 'string' ? error : error?.code);
    const output = { version: 1, code, stage: stages.has(input.stage) ? input.stage : 'stop',
        direction: directions.has(input.direction) ? input.direction : 'server_internal',
        event: events.has(input.event) ? input.event : 'unknown' };
    const reason = error?.diagnosticReason || input.reason;
    if (reasons.has(reason)) output.reason = reason;
    const exceptionType = error?.name || input.exceptionType;
    if (exceptionTypes.has(exceptionType)) output.exceptionType = exceptionType;
    for (const [key, maximum] of Object.entries({ occurredAtMs: 8640000000000000, elapsedMs: 86400000,
        inputSamples: 3456000000, outputSamples: 3456000000, queuedCount: 65, queuedBytes: 4194304, frameBytes: 1048576 })) {
        const value = bounded(input[key], maximum); if (value !== undefined) output[key] = value;
    }
    return output;
}
export function firstCanvasVoiceTerminalDiagnostic(prior, error, input) {
    return prior?.version === 1 ? canvasVoiceTerminalDiagnostic(prior.code, prior) : canvasVoiceTerminalDiagnostic(error, input);
}
