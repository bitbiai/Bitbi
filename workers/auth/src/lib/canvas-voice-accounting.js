import { stablePricingJson } from '../../../../js/shared/model-tariff.mjs';
import { canvasVoiceSettings } from '../../../../js/shared/canvas-voice-settings.mjs';
import { canvasVoicePrice, canvasVoiceExposure } from './canvas-voice-pricing.js';
import { readCanvasVoiceSettings, requireCanvasVoiceOwner } from './canvas-voice-settings.js';
import { conversationRow, conversationCosts } from './canvas-agent-conversation.js';
import { getModelTariff } from './model-tariffs.js';
import { beginMemberAiUsageAttempt, markMemberAiUsageAttemptProviderRunning,
    markMemberAiUsageAttemptProviderFailed, markMemberAiUsageAttemptSucceeded } from './member-ai-usage-attempts.js';
import { markAiDispatchUnknown } from './ai-dispatch-state.js';
import { consumeMemberCredits } from './billing.js';
import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';
import { findCanvasVoiceResumption, validateCanvasVoiceResumption } from './canvas-voice-resumption.js';
import { firstCanvasVoiceTerminalDiagnostic } from './canvas-voice-diagnostics.js';

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const table = 'member_ai_usage_attempts_v2', feature = 'ai.voice.realtime';
const revisionKeys = ['settingsRevision', 'expectedConversationRevision', 'expectedBriefRevision', 'expectedProjectRevision'];
const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const usageKey = id => 'canvas-voice-' + id;
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function scopeValid(scope) {
    if (!scope || !validId(scope.sessionId) || !validId(scope.projectId) || typeof scope.userId !== 'string' || !scope.userId || scope.userId.length > 180) fail('canvas_voice_scope_invalid', 400);
}
function quoteInput(input) {
    if (!exact(input, ['maxDurationSeconds', ...revisionKeys]) || !revisionKeys.every(key => Number.isSafeInteger(input[key]) && input[key] >= 0)
        || !Number.isSafeInteger(input.maxDurationSeconds)) fail('canvas_voice_quote_invalid', 400);
    return input;
}
function publicQuote(row, remaining) {
    const price = JSON.parse(row.pricing_json), input = JSON.parse(row.input_json);
    return { id: row.id, capCredits: price.maxCredits, maxDurationSeconds: price.maxWallSeconds, maxBillableSeconds: price.maxBillableSeconds,
        expiresAt: row.expires_at, settingsRevision: input.settingsRevision, creditsPerBlock: price.creditsPerBlock,
        unitSeconds: price.unitSeconds, billingMode: price.billingMode, remainingConversationCredits: remaining,
        resumption: { enabled: JSON.parse(row.settings_json).resumption.enabled, resuming: Boolean(row.resume_session_id), expiresAt: row.resume_expires_at || null } };
}
async function expireUndispatched(env, userId) {
    const now = nowIso(), orphanCutoff = new Date(Date.now() - 60000).toISOString();
    const rows = (await env.DB.prepare(`SELECT a.id,s.id AS session_id FROM ${table} a LEFT JOIN canvas_voice_sessions s ON s.usage_attempt_id=a.id
        WHERE a.user_id=? AND json_extract(a.metadata_json,'$.canvas_voice.version')=1 AND a.provider_outcome='not_dispatched'
        AND a.billing_status='reserved' AND ((s.state='admitted' AND s.admit_by<=?) OR s.id IS NULL AND a.created_at<=?) LIMIT 8`)
        .bind(userId, now, orphanCutoff).all()).results;
    for (const row of rows) if (await markMemberAiUsageAttemptProviderFailed(env, row.id, { definitelyNotDispatched: true, code: 'canvas_voice_admission_expired' })) {
        if (row.session_id) await env.DB.prepare("UPDATE canvas_voice_sessions SET state='rejected',updated_at=? WHERE id=? AND state='admitted'").bind(now, row.session_id).run();
    }
}
async function currentQuoteState(env, userId, projectId, input) {
    const project = await requireCanvasVoiceOwner(env, userId, projectId), conversation = await conversationRow(env, projectId, userId);
    const config = await readCanvasVoiceSettings(env, userId, projectId), tariff = await getModelTariff(env), costs = await conversationCosts(env, projectId);
    if (!conversation || conversation.state !== 'active') fail('canvas_agent_conversation_stopped');
    if (project.revision !== input.expectedProjectRevision || conversation.revision !== input.expectedConversationRevision
        || conversation.brief_revision !== input.expectedBriefRevision) fail('canvas_agent_conversation_changed');
    if (config.revision !== input.settingsRevision) fail('canvas_voice_settings_changed');
    if (conversation.allowance_tariff !== tariff.revision) fail('canvas_agent_conversation_allowance_required');
    const price = canvasVoicePrice(config.settings, input.maxDurationSeconds, tariff.revision), remaining = Math.max(0, conversation.allowance_credits - costs.committed);
    if (price.maxCredits > remaining) fail('canvas_agent_conversation_allowance_required', 402);
    return { price, config, remaining };
}
export async function quoteCanvasVoiceSession(env, { userId, projectId, input }) {
    quoteInput(input);
    await requireCanvasVoiceOwner(env, userId, projectId);
    await expireUndispatched(env, userId);
    const { price, config, remaining } = await currentQuoteState(env, userId, projectId, input), now = nowIso();
    const resume = await findCanvasVoiceResumption(env, { userId, projectId }, config.settings);
    const row = { id: randomTokenHex(16), input_json: stablePricingJson(input), pricing_json: stablePricingJson(price),
        settings_json: stablePricingJson(config.settings), created_at: now, expires_at: new Date(Math.min(Date.now() + 120000, resume ? Date.parse(resume.expiresAt) : Infinity)).toISOString(),
        resume_session_id: resume?.sessionId || null, resume_conversation_id: resume?.conversationId || null, resume_expires_at: resume?.expiresAt || null };
    await env.DB.prepare(`INSERT INTO canvas_voice_quotes(id,project_id,user_id,input_json,settings_json,pricing_json,created_at,expires_at,resume_session_id,resume_conversation_id,resume_expires_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id, projectId, userId, row.input_json, row.settings_json, row.pricing_json, now, row.expires_at,
            row.resume_session_id, row.resume_conversation_id, row.resume_expires_at).run();
    return publicQuote(row, remaining);
}
function publicSession(row) {
    return { id: row.id, state: row.state, settings: canvasVoiceSettings(JSON.parse(row.settings_json)), expiresAt: row.expires_at,
        maxDurationSeconds: row.max_seconds, socketPath: `/api/account/canvas/projects/${row.project_id}/agent/voice/sessions/${row.id}/socket` };
}
async function usage(env, scope) {
    scopeValid(scope);
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id=? AND idempotency_key=?
        AND json_extract(metadata_json,'$.canvas_voice.session_id')=? AND json_extract(metadata_json,'$.canvas_voice.project_id')=?`)
        .bind(scope.userId, usageKey(scope.sessionId), scope.sessionId, scope.projectId).first();
    if (!row) fail('canvas_voice_session_unavailable');
    return { ...row, metadata: JSON.parse(row.metadata_json) };
}
export async function admitCanvasVoiceSession(env, { userId, projectId, authSessionId, input, idempotencyKey }) {
    if (!exact(input, ['requestId', 'quoteId', 'capCredits', 'maxDurationSeconds', 'consent', ...revisionKeys])
        || input.consent !== true || !validId(input.requestId) || !validId(input.quoteId) || idempotencyKey !== input.requestId
        || !Number.isSafeInteger(input.capCredits) || input.capCredits < 1) fail('canvas_voice_consent_required', 400);
    const pinnedInput = quoteInput(Object.fromEntries(['maxDurationSeconds', ...revisionKeys].map(key => [key, input[key]])));
    const serialized = stablePricingJson(input), scope = { userId, projectId, sessionId: input.requestId };
    await requireCanvasVoiceOwner(env, userId, projectId);
    if (typeof authSessionId !== 'string' || !authSessionId || authSessionId.length > 180
        || !await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?').bind(authSessionId, userId, nowIso()).first()) fail('canvas_voice_auth_session_required', 401);
    const existing = await env.DB.prepare('SELECT * FROM canvas_voice_sessions WHERE id=? AND project_id=? AND user_id=?').bind(input.requestId, projectId, userId).first();
    if (existing) {
        if (existing.request_json !== serialized) fail('idempotency_conflict');
        if (existing.auth_session_id !== authSessionId) fail('canvas_voice_authority_changed');
        return { session: publicSession(existing), replay: true };
    }
    const quote = await env.DB.prepare('SELECT * FROM canvas_voice_quotes WHERE id=? AND project_id=? AND user_id=?').bind(input.quoteId, projectId, userId).first();
    if (!quote || quote.expires_at <= nowIso() || quote.input_json !== stablePricingJson(pinnedInput)) fail('canvas_voice_quote_expired');
    const price = JSON.parse(quote.pricing_json), current = await currentQuoteState(env, userId, projectId, pinnedInput);
    if (input.capCredits !== price.maxCredits || stablePricingJson(current.price) !== quote.pricing_json
        || stablePricingJson(current.config.settings) !== quote.settings_json) fail('canvas_voice_quote_changed');
    await validateCanvasVoiceResumption(env, scope, quote);
    const metadata = { canvas_voice: { version: 1, session_id: input.requestId, project_id: projectId, quote_id: quote.id, auth_session_id: authSessionId, pricing: price } };
    const fingerprint = await sha256Hex(stablePricingJson({ userId, projectId, authSessionId, input }));
    let attempt;
    try {
        // Insertion's SQL trigger atomically compares BOTH text and Voice
        // commitments before the existing wallet reservation can commit.
        const reserved = await beginMemberAiUsageAttempt({ env, userId, featureKey: feature, operationKey: 'canvas_voice_session',
            route: `/api/account/canvas/projects/${projectId}/agent/voice/sessions`, idempotencyKey: usageKey(input.requestId),
            requestFingerprint: fingerprint, creditCost: price.maxCredits, metadata });
        attempt = reserved.attempt;
        if (!attempt || attempt.providerOutcome !== 'not_dispatched' || attempt.billingStatus !== 'reserved') fail('canvas_voice_outcome_unknown');
        const now = nowIso(), admitBy = new Date(Date.now() + 60000).toISOString(), expires = new Date(Date.now() + (price.maxWallSeconds + 60) * 1000).toISOString();
        await env.DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,request_key,request_json,state,
            conversation_revision,brief_revision,project_revision,settings_revision,settings_json,usage_attempt_id,max_seconds,created_at,updated_at,expires_at,admit_by,
            auth_session_id,resume_session_id,resume_conversation_id,resume_expires_at)
            VALUES(?,?,?,?,?,'admitted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(input.requestId, projectId, userId, input.requestId, serialized,
            input.expectedConversationRevision, input.expectedBriefRevision, input.expectedProjectRevision, input.settingsRevision, quote.settings_json,
            attempt.id, price.maxWallSeconds, now, now, expires, admitBy, authSessionId, quote.resume_session_id, quote.resume_conversation_id, quote.resume_expires_at).run();
    } catch (error) {
        const replay = await env.DB.prepare('SELECT * FROM canvas_voice_sessions WHERE id=? AND project_id=? AND user_id=?').bind(input.requestId, projectId, userId).first();
        if (replay && replay.request_json === serialized && replay.auth_session_id === authSessionId) return { session: publicSession(replay), replay: true };
        if (attempt?.providerOutcome === 'not_dispatched') await markMemberAiUsageAttemptProviderFailed(env, attempt.id, { definitelyNotDispatched: true, code: 'canvas_voice_admission_failed' });
        if (String(error?.message).includes('canvas_voice_admission_denied')) fail('canvas_voice_admission_denied');
        throw error;
    }
    return { session: publicSession(await readOwnedCanvasVoiceSession(env, scope)), replay: false };
}
export async function readOwnedCanvasVoiceSession(env, scope, { allowTerminal = false, expectedProjectRevision } = {}) {
    scopeValid(scope);
    if (expectedProjectRevision !== undefined && (!Number.isSafeInteger(expectedProjectRevision) || expectedProjectRevision < 0)) fail('canvas_voice_scope_invalid', 400);
    const row = await env.DB.prepare(`SELECT s.*,c.state AS conversation_state,p.revision AS current_project_revision,
        COALESCE(v.revision,0) AS current_settings_revision FROM canvas_voice_sessions s JOIN canvas_projects p ON p.id=s.project_id
        JOIN canvas_agent_conversations c ON c.project_id=s.project_id JOIN users u ON u.id=s.user_id LEFT JOIN canvas_voice_settings v ON v.project_id=s.project_id
        WHERE s.id=? AND s.project_id=? AND s.user_id=? AND p.user_id=s.user_id AND p.deleted_at IS NULL AND u.status='active'`)
        .bind(scope.sessionId, scope.projectId, scope.userId).first();
    if (!row) fail('canvas_voice_session_unavailable');
    if (!allowTerminal && (!['admitted', 'connecting', 'active'].includes(row.state) || row.stop_requested || row.expires_at <= nowIso()
        || row.conversation_state !== 'active' || row.current_project_revision !== (expectedProjectRevision ?? row.project_revision)
        || row.state === 'admitted' && (row.current_settings_revision !== row.settings_revision || !row.admit_by || row.admit_by <= nowIso())
        || !row.auth_session_id || !await env.DB.prepare('SELECT id FROM sessions WHERE id=? AND user_id=? AND expires_at>?').bind(row.auth_session_id, scope.userId, nowIso()).first()
        || row.state === 'admitted' && row.resume_expires_at && row.resume_expires_at <= nowIso()
        || await env.DB.prepare('SELECT session_id FROM canvas_voice_stop_requests WHERE session_id=?').bind(scope.sessionId).first())) fail('canvas_voice_authority_changed');
    return { ...row, settings: canvasVoiceSettings(JSON.parse(row.settings_json)), maxWallSeconds: row.max_seconds, expiresAt: row.expires_at };
}
export async function dispatchCanvasVoiceSession(env, scope) {
    const session = await readOwnedCanvasVoiceSession(env, scope), row = await usage(env, scope);
    if (session.state !== 'admitted' || row.provider_outcome !== 'not_dispatched' || row.reservation_released_at) fail('canvas_voice_outcome_unknown');
    const dispatchToken = await markMemberAiUsageAttemptProviderRunning(env, row.id);
    await env.DB.prepare("UPDATE canvas_voice_sessions SET state='connecting',updated_at=? WHERE id=? AND state='admitted' AND usage_attempt_id=?")
        .bind(nowIso(), scope.sessionId, row.id).run();
    return { usageAttemptId: row.id, dispatchToken };
}
export async function acceptCanvasVoiceSession(env, scope, { providerIdentity }) {
    if (providerIdentity !== null && (typeof providerIdentity !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(providerIdentity))) fail('canvas_voice_provider_identity_invalid');
    const row = await usage(env, scope);
    if (row.provider_outcome !== 'dispatched') fail('canvas_voice_outcome_unknown');
    const now = nowIso();
    const result = await env.DB.batch([env.DB.prepare(`UPDATE ${table} SET metadata_json=json_set(metadata_json,'$.canvas_voice_acceptance',
        COALESCE(json_extract(metadata_json,'$.canvas_voice_acceptance'),json(?))) WHERE id=? AND provider_outcome='dispatched'`)
        .bind(stablePricingJson({ acceptedAt: now, providerIdentity, evidence: 'server_observed_websocket_101' }), row.id),
        env.DB.prepare(`UPDATE canvas_voice_sessions SET provider_identity=COALESCE(provider_identity,?),accepted_at=COALESCE(accepted_at,?),updated_at=?
        WHERE id=? AND user_id=? AND project_id=? AND usage_attempt_id=? AND state='connecting'
        AND (provider_identity IS NULL OR provider_identity=?)`).bind(providerIdentity, now, now, scope.sessionId, scope.userId, scope.projectId, row.id, providerIdentity)]);
    if (result[1].meta?.changes !== 1) fail('canvas_voice_provider_identity_invalid');
    return { accepted: true };
}
export async function activateCanvasVoiceSession(env, scope) {
    await readOwnedCanvasVoiceSession(env, scope);
    const result = await env.DB.prepare(`UPDATE canvas_voice_sessions SET state='active',active_at=COALESCE(active_at,?),updated_at=?
        WHERE id=? AND user_id=? AND project_id=? AND state IN ('connecting','active') AND accepted_at IS NOT NULL AND stop_requested=0`)
        .bind(nowIso(), nowIso(), scope.sessionId, scope.userId, scope.projectId).run();
    if (result.meta?.changes !== 1) fail('canvas_voice_authority_changed');
    return { active: true };
}
export async function recordCanvasVoiceExposure(env, scope, input, { expectedProjectRevision } = {}) {
    const session = await readOwnedCanvasVoiceSession(env, scope, { expectedProjectRevision }), row = await usage(env, scope);
    if (row.provider_outcome !== 'dispatched' || !session.accepted_at) fail('canvas_voice_exposure_invalid');
    const measured = canvasVoiceExposure(row.metadata.canvas_voice.pricing, session.settings, input, JSON.parse(session.exposure_json));
    const result = await env.DB.prepare(`UPDATE canvas_voice_sessions SET exposure_json=?,started_blocks=?,updated_at=?
        WHERE id=? AND user_id=? AND project_id=? AND exposure_json=? AND state IN ('connecting','active') AND stop_requested=0
        AND EXISTS(SELECT 1 FROM canvas_projects p WHERE p.id=canvas_voice_sessions.project_id AND p.user_id=canvas_voice_sessions.user_id
            AND p.deleted_at IS NULL AND p.revision=?)`)
        .bind(stablePricingJson(measured), measured.startedBlocks, nowIso(), scope.sessionId, scope.userId, scope.projectId, session.exposure_json, session.current_project_revision).run();
    if (result.meta?.changes !== 1) fail('canvas_voice_exposure_changed');
    if (measured.exceeded) {
        await markAiDispatchUnknown(env, table, row.id, { dispatchToken: row.dispatch_token, code: 'canvas_voice_exposure_exceeded' });
        await env.DB.prepare("UPDATE canvas_voice_sessions SET state='unknown',stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=?")
            .bind(nowIso(), scope.sessionId, scope.userId, scope.projectId).run();
        fail('canvas_voice_exposure_exceeded');
    }
    return measured;
}
// Only the server-owned relay calls this function. A browser stop/request or a
// timer by itself is not proof of a provider's completed/zero-cost outcome.
export async function finishCanvasVoiceSession(env, scope, { outcome, exposure, code = 'canvas_voice_ended', diagnostic }) {
    if (!['completed', 'rejected', 'not_submitted', 'unknown'].includes(outcome) || !/^[a-z0-9_]{1,100}$/.test(code)) fail('canvas_voice_outcome_invalid');
    let row = await usage(env, scope);
    if (diagnostic && !row.metadata.canvas_voice_terminal_diagnostic) {
        // This first-cause record is separate from the immutable provider/billing
        // receipt. A later Stop, close acknowledgement or recovery cannot replace it.
        const first = firstCanvasVoiceTerminalDiagnostic(null, diagnostic.code, diagnostic);
        await env.DB.prepare(`UPDATE ${table} SET metadata_json=json_set(metadata_json,'$.canvas_voice_terminal_diagnostic',json(?))
            WHERE id=? AND user_id=? AND json_extract(metadata_json,'$.canvas_voice.project_id')=?
            AND json_extract(metadata_json,'$.canvas_voice.session_id')=? AND json_type(metadata_json,'$.canvas_voice_terminal_diagnostic') IS NULL`)
            .bind(stablePricingJson(first), row.id, scope.userId, scope.projectId, scope.sessionId).run();
        row = await usage(env, scope);
    }
    if (row.metadata.canvas_voice_terminal_diagnostic) code = firstCanvasVoiceTerminalDiagnostic(row.metadata.canvas_voice_terminal_diagnostic).code;
    const session = await env.DB.prepare('SELECT * FROM canvas_voice_sessions WHERE id=? AND user_id=? AND project_id=?').bind(scope.sessionId, scope.userId, scope.projectId).first();
    if (row.billing_status === 'finalized') {
        const receipt = row.metadata.canvas_voice_receipt;
        if (row.provider_outcome !== 'succeeded' || receipt?.outcome !== 'completed'
            || !Number.isSafeInteger(receipt.credits) || receipt.credits < 0 || receipt.credits > row.credit_cost) fail('canvas_voice_billing_review_required');
        // Final accounting may have committed before the session projection or
        // its acknowledgement. Reconcile that same identity without another debit.
        await env.DB.prepare("UPDATE canvas_voice_sessions SET state='completed',stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=? AND usage_attempt_id=?")
            .bind(nowIso(), scope.sessionId, scope.userId, scope.projectId, row.id).run();
        return { completed: true, chargedCredits: receipt.credits, startedBlocks: receipt.startedBlocks, replay: true };
    }
    if (row.billing_status === 'released') {
        if (!['not_dispatched','failed'].includes(row.provider_outcome) || row.metadata.canvas_voice_acceptance || row.metadata.canvas_voice_receipt) fail('canvas_voice_billing_review_required');
        await env.DB.prepare("UPDATE canvas_voice_sessions SET state='rejected',stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=? AND usage_attempt_id=?")
            .bind(nowIso(), scope.sessionId, scope.userId, scope.projectId, row.id).run();
        return { completed: false, released: true, chargedCredits: 0, replay: true };
    }
    if (outcome === 'unknown') {
        await markAiDispatchUnknown(env, table, row.id, { dispatchToken: row.dispatch_token, code });
        await env.DB.prepare("UPDATE canvas_voice_sessions SET state='unknown',updated_at=? WHERE id=? AND user_id=? AND project_id=? AND state!='completed'").bind(nowIso(), scope.sessionId, scope.userId, scope.projectId).run();
        return { completed: false, unknown: true, reservedCredits: row.credit_cost };
    }
    if (outcome === 'not_submitted' || outcome === 'rejected') {
        if (row.provider_outcome === 'unknown' || row.metadata.canvas_voice_acceptance || row.metadata.canvas_voice_receipt) fail('canvas_voice_outcome_unknown');
        const notDispatched = row.provider_outcome === 'not_dispatched';
        if (outcome === 'not_submitted' && !notDispatched) fail('canvas_voice_outcome_unknown');
        const released = await markMemberAiUsageAttemptProviderFailed(env, row.id, { dispatchToken: row.dispatch_token,
            definitelyNotDispatched: notDispatched, confirmedOutcome: !notDispatched, code });
        if (!released) fail('canvas_voice_outcome_unknown');
        await env.DB.prepare("UPDATE canvas_voice_sessions SET state='rejected',stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=? AND usage_attempt_id=?")
            .bind(nowIso(), scope.sessionId, scope.userId, scope.projectId, row.id).run();
        return { completed: false, released: true, chargedCredits: 0 };
    }
    let receipt = row.metadata.canvas_voice_receipt;
    if (!receipt) {
        if (!row.metadata.canvas_voice_acceptance || !['dispatched','unknown'].includes(row.provider_outcome)) fail('canvas_voice_outcome_unknown');
        const measured = canvasVoiceExposure(row.metadata.canvas_voice.pricing, session ? canvasVoiceSettings(JSON.parse(session.settings_json)) : null,
            exposure, session ? JSON.parse(session.exposure_json) : {});
        if (measured.exceeded) fail('canvas_voice_exposure_exceeded');
        receipt = { version: 1, outcome: 'completed', code, ...measured, credits: measured.accruedCredits, recordedAt: nowIso() };
        const result = await env.DB.prepare(`UPDATE ${table} SET metadata_json=json_set(metadata_json,'$.canvas_voice_receipt',json(?)),
            provider_outcome='succeeded',provider_status='succeeded',status='finalizing',updated_at=?
            WHERE id=? AND dispatch_token=? AND provider_outcome IN ('dispatched','unknown') AND billing_status='reserved'
            AND reservation_released_at IS NULL AND json_type(metadata_json,'$.canvas_voice_receipt') IS NULL`)
            .bind(stablePricingJson(receipt), nowIso(), row.id, row.dispatch_token).run();
        if (result.meta?.changes !== 1) { row = await usage(env, scope); receipt = row.metadata.canvas_voice_receipt; if (!receipt) fail('canvas_voice_outcome_unknown'); }
    }
    row = await usage(env, scope);
    if (row.provider_outcome !== 'succeeded' || !Number.isSafeInteger(receipt.credits) || receipt.credits < 0 || receipt.credits > row.credit_cost) fail('canvas_voice_billing_review_required');
    if (receipt.credits === 0) {
        await env.DB.prepare(`UPDATE ${table} SET status='succeeded',billing_status='finalized',result_status='unavailable',completed_at=COALESCE(completed_at,?),updated_at=?
            WHERE id=? AND dispatch_token=? AND provider_outcome='succeeded' AND billing_status='reserved' AND reservation_released_at IS NULL`)
            .bind(nowIso(), nowIso(), row.id, row.dispatch_token).run();
    } else {
        const charged = await consumeMemberCredits({ env, userId: scope.userId, featureKey: row.feature_key, quantity: row.quantity,
            credits: receipt.credits, idempotencyKey: row.idempotency_key, requestFingerprint: row.request_fingerprint,
            aiDispatchToken: row.dispatch_token, source: 'canvas_voice', metadata: { model: row.metadata.canvas_voice.pricing.model, session_id: scope.sessionId, started_blocks: receipt.startedBlocks } });
        await markMemberAiUsageAttemptSucceeded(env, row.id, { dispatchToken: row.dispatch_token, model: row.metadata.canvas_voice.pricing.model,
            balanceAfter: charged.creditBalance, metadata: row.metadata, resultStatus: 'unavailable' });
    }
    await env.DB.prepare("UPDATE canvas_voice_sessions SET state='completed',stop_requested=1,updated_at=? WHERE id=? AND user_id=? AND project_id=? AND usage_attempt_id=?")
        .bind(nowIso(), scope.sessionId, scope.userId, scope.projectId, row.id).run();
    return { completed: true, chargedCredits: receipt.credits, startedBlocks: receipt.startedBlocks, replay: false };
}
