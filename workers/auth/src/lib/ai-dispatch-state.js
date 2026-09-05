import { BillingError } from './billing.js';
import { nowIso, randomTokenHex } from './tokens.js';

const TABLES = new Set(['member_ai_usage_attempts_v2', 'ai_usage_attempts_v2']);
function tableName(table) {
  if (!TABLES.has(table)) throw new Error('Unsupported AI attempt table.');
  return table;
}
function unresolved(code = 'ai_usage_outcome_unknown') {
  return new BillingError('This operation has an unresolved provider outcome. Reuse its existing operation key; do not resubmit it.', { status: 409, code });
}
const text = (value, limit = 160) => String(value || '').slice(0, limit) || null;

// The row is the durable identity. The 30-minute reservation/replay window is
// never permission to dispatch that identity again. No receipt TTL deletion.
export function classifyDispatchAttempt(attempt, now) {
  if (attempt.status === 'succeeded' && attempt.billingStatus === 'finalized') {
    return attempt.expiresAt <= now ? 'completed_expired' : 'completed';
  }
  if (attempt.providerOutcome === 'unknown') return 'unresolved';
  if (attempt.providerOutcome === 'dispatched' && attempt.expiresAt <= now) return 'unresolved';
  if (attempt.status === 'billing_failed' || attempt.billingStatus === 'failed') return 'billing_failed';
  if (attempt.providerOutcome === 'failed') return 'confirmed_failed';
  if (attempt.expiresAt <= now) return 'key_expired';
  if (attempt.providerOutcome === 'not_dispatched' && attempt.billingStatus === 'released') return 'retryable';
  return 'in_progress';
}

export async function claimAiDispatch(env, table, id, { signal } = {}) {
  tableName(table);
  if (signal?.aborted) {
    await failAiDispatch(env, table, id, { definitelyNotDispatched: true, code: 'caller_cancelled_before_dispatch' });
    throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
  const now = nowIso();
  const token = randomTokenHex(16);
  const result = await env.DB.prepare(`UPDATE ${table}
    SET status = 'provider_running', provider_status = 'running',
        provider_outcome = 'dispatched', dispatch_token = ?, dispatched_at = ?, updated_at = ?
    WHERE id = ? AND status = 'reserved' AND billing_status = 'reserved'
      AND provider_outcome = 'not_dispatched' AND expires_at > ?`).bind(token, now, now, id, now).run();
  if (!result?.meta?.changes) throw unresolved('ai_usage_dispatch_not_claimed');
  // Abort after the durable claim is conservatively unknown; the caller may
  // have crossed its dispatch boundary. It cannot authorize a fresh attempt.
  return token;
}

export async function recordAiLateOutcome(env, table, id, { dispatchToken, outcome, code } = {}) {
  tableName(table);
  if (!dispatchToken || !['succeeded', 'failed'].includes(outcome)) return false;
  const now = nowIso();
  const evidence = JSON.stringify({ observed_at: now, code: text(code, 80), source: 'late_local_completion', provider_cost: 'unreconciled' });
  const result = await env.DB.prepare(`UPDATE ${table}
    SET late_outcome = ?, late_evidence_json = ?
    WHERE id = ? AND dispatch_token = ? AND provider_outcome = 'unknown' AND late_outcome IS NULL`)
    .bind(outcome, evidence, id, dispatchToken).run();
  return Boolean(result?.meta?.changes);
}

export async function markAiDispatchUnknown(env, table, id, { dispatchToken, code = 'provider_outcome_unknown', message = null } = {}) {
  tableName(table);
  const now = nowIso();
  const result = await env.DB.prepare(`UPDATE ${table}
    SET provider_outcome = 'unknown', unknown_at = COALESCE(unknown_at, ?),
        error_code = ?, error_message = ?, updated_at = ?
    WHERE id = ? AND dispatch_token = ? AND provider_outcome = 'dispatched'`)
    .bind(now, text(code, 80), text(message), now, id, dispatchToken || null).run();
  return Boolean(result?.meta?.changes);
}

export async function failAiDispatch(env, table, id, {
  dispatchToken, code = 'provider_failed', message = null,
  definitelyNotDispatched = false, confirmedOutcome = false,
} = {}) {
  tableName(table);
  if (!definitelyNotDispatched && !confirmedOutcome) {
    return markAiDispatchUnknown(env, table, id, { dispatchToken, code, message });
  }
  const now = nowIso();
  const expected = definitelyNotDispatched ? 'not_dispatched' : 'dispatched';
  const outcome = definitelyNotDispatched ? 'not_dispatched' : 'failed';
  const result = await env.DB.prepare(`UPDATE ${table}
    SET status = 'provider_failed', provider_status = 'failed', provider_outcome = ?,
        billing_status = 'released', reservation_released_at = COALESCE(reservation_released_at, ?),
        result_status = 'none', error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND provider_outcome = ? AND billing_status = 'reserved'
      AND (? = 'not_dispatched' OR dispatch_token = ?)`)
    .bind(outcome, now, text(code, 80), text(message), now, now, id, expected, expected, dispatchToken || null).run();
  if (!result?.meta?.changes && confirmedOutcome) {
    await recordAiLateOutcome(env, table, id, { dispatchToken, outcome: 'failed', code });
  }
  return Boolean(result?.meta?.changes);
}

export async function confirmAiDispatchSuccess(env, table, id, { dispatchToken } = {}) {
  tableName(table);
  const now = nowIso();
  const result = await env.DB.prepare(`UPDATE ${table}
    SET status = 'finalizing', provider_status = 'succeeded', provider_outcome = 'succeeded', updated_at = ?
    WHERE id = ? AND dispatch_token = ? AND provider_outcome = 'dispatched'
      AND billing_status = 'reserved' AND reservation_released_at IS NULL AND expires_at > ?`)
    .bind(now, id, dispatchToken || null, now).run();
  if (!result?.meta?.changes) {
    await markAiDispatchUnknown(env, table, id, { dispatchToken, code: 'provider_result_after_deadline' });
    await recordAiLateOutcome(env, table, id, { dispatchToken, outcome: 'succeeded', code: 'provider_result_after_deadline' });
    throw unresolved();
  }
}

export async function releaseExpiredAiDispatch(env, table, id, now = nowIso()) {
  tableName(table);
  const result = await env.DB.prepare(`UPDATE ${table}
    SET status = 'expired', billing_status = 'released', result_status = 'none',
        provider_outcome = CASE WHEN provider_outcome = 'dispatched' THEN 'unknown' ELSE provider_outcome END,
        unknown_at = CASE WHEN provider_outcome = 'dispatched' THEN COALESCE(unknown_at, ?) ELSE unknown_at END,
        reservation_released_at = ?, updated_at = ?, completed_at = ?,
        error_code = 'ai_usage_reservation_expired'
    WHERE id = ? AND billing_status = 'reserved' AND expires_at <= ?
      AND provider_outcome IN ('not_dispatched', 'dispatched', 'unknown', 'failed')
      AND reservation_released_at IS NULL`).bind(now, now, now, now, id, now).run();
  return Number(result?.meta?.changes || 0);
}

// A committed ledger debit is authoritative after a crash between charging and
// result publication. Reconcile it without charging again or fabricating replay.
export async function reconcileAiDispatchDebit(env, table, id, { dispatchToken, now = nowIso() } = {}) {
  tableName(table);
  const member = table === 'member_ai_usage_attempts_v2';
  const ledger = member ? 'member_credit_ledger' : 'credit_ledger';
  const owner = member ? 'user_id' : 'organization_id';
  const result = await env.DB.prepare(`UPDATE ${table}
    SET status = 'succeeded', billing_status = 'finalized',
        result_status = CASE WHEN result_status = 'stored' THEN 'stored' ELSE 'unavailable' END,
        balance_after = (SELECT l.balance_after FROM ${ledger} l WHERE l.${owner} = ${table}.${owner}
          AND l.idempotency_key = ${table}.idempotency_key AND l.amount < 0 LIMIT 1),
        error_code = 'ai_usage_result_unavailable_after_debit', error_message = NULL,
        completed_at = COALESCE(completed_at, ?), updated_at = ?
    WHERE id = ? AND dispatch_token = ? AND provider_outcome = 'succeeded'
      AND ((status = 'finalizing' AND billing_status = 'reserved')
        OR (status = 'billing_failed' AND billing_status = 'failed')) AND reservation_released_at IS NULL
      AND EXISTS (SELECT 1 FROM ${ledger} l WHERE l.${owner} = ${table}.${owner}
        AND l.idempotency_key = ${table}.idempotency_key AND l.amount < 0)`)
    .bind(now, now, id, dispatchToken || null).run();
  return Number(result?.meta?.changes || 0);
}
