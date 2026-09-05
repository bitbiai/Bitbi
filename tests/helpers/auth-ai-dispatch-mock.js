// Legacy route harness adapter. SQL transition correctness is separately tested
// against real disposable SQLite; this adapter keeps existing route fixtures usable.
function handleAiDispatchQuery(state, query, bindings) {
  const match = query.match(/(?:UPDATE|FROM) (member_ai_usage_attempts|ai_usage_attempts)\b/);
  if (!match) return undefined;
  const rows = state[match[1] === 'member_ai_usage_attempts' ? 'memberAiUsageAttempts' : 'aiUsageAttempts'];
  for (const row of rows) {
    if (row.provider_outcome === undefined) {
      row.provider_outcome = row.provider_status === 'succeeded' ? 'succeeded'
        : row.provider_status === 'not_started' ? 'not_dispatched' : 'unknown';
      row.reservation_released_at = row.billing_status === 'released' ? row.updated_at : null;
      row.dispatch_token = row.provider_outcome === 'not_dispatched' ? null : `legacy:${row.id}`;
    }
  }
  const result = (changed) => ({ success: true, meta: { changes: changed ? 1 : 0 } });
  if (!query.startsWith('UPDATE ') || !query.includes('provider_outcome')) return undefined;
  if (query.includes("SET status = 'provider_running'")) {
    const [token, dispatchedAt, updatedAt, id, now] = bindings;
    const row = rows.find(r => r.id === id && r.status === 'reserved' && r.billing_status === 'reserved' && r.provider_outcome === 'not_dispatched' && r.expires_at > now);
    if (row) Object.assign(row, { status: 'provider_running', provider_status: 'running', provider_outcome: 'dispatched', dispatch_token: token, dispatched_at: dispatchedAt, updated_at: updatedAt });
    return result(row);
  }
  if (query.includes("SET provider_outcome = 'unknown'")) {
    const [now, code, message, updatedAt, id, token] = bindings;
    const row = rows.find(r => r.id === id && r.dispatch_token === token && r.provider_outcome === 'dispatched');
    if (row) Object.assign(row, { provider_outcome: 'unknown', unknown_at: row.unknown_at || now, error_code: code, error_message: message, updated_at: updatedAt });
    return result(row);
  }
  if (query.includes('SET late_outcome = ?')) {
    const [outcome, evidence, id, token] = bindings;
    const row = rows.find(r => r.id === id && r.dispatch_token === token && r.provider_outcome === 'unknown' && !r.late_outcome);
    if (row) Object.assign(row, { late_outcome: outcome, late_evidence_json: evidence });
    return result(row);
  }
  if (query.includes("SET status = 'provider_failed'")) {
    const [outcome, now, code, message, updatedAt, completedAt, id, expected, guard, token] = bindings;
    const row = rows.find(r => r.id === id && r.provider_outcome === expected && r.billing_status === 'reserved' && (guard === 'not_dispatched' || r.dispatch_token === token));
    if (row) Object.assign(row, { status: 'provider_failed', provider_status: 'failed', provider_outcome: outcome, billing_status: 'released', reservation_released_at: row.reservation_released_at || now, result_status: 'none', error_code: code, error_message: message, updated_at: updatedAt, completed_at: completedAt });
    return result(row);
  }
  if (query.includes("SET status = 'finalizing'")) {
    const [now, id, token, expiresAfter] = bindings;
    const row = rows.find(r => r.id === id && r.dispatch_token === token && r.provider_outcome === 'dispatched' && r.billing_status === 'reserved' && !r.reservation_released_at && r.expires_at > expiresAfter);
    if (row) Object.assign(row, { status: 'finalizing', provider_status: 'succeeded', provider_outcome: 'succeeded', updated_at: now });
    return result(row);
  }
  if (query.includes("SET status = 'expired', billing_status = 'released'")) {
    const [unknownAt, releasedAt, updatedAt, completedAt, id, now] = bindings;
    const row = rows.find(r => r.id === id && r.billing_status === 'reserved' && r.expires_at <= now && !r.reservation_released_at && ['not_dispatched','dispatched','unknown','failed'].includes(r.provider_outcome));
    if (row) {
      if (row.provider_outcome === 'dispatched') { row.provider_outcome = 'unknown'; row.unknown_at = row.unknown_at || unknownAt; }
      Object.assign(row, { status: 'expired', billing_status: 'released', result_status: 'none', reservation_released_at: releasedAt, updated_at: updatedAt, completed_at: completedAt, error_code: 'ai_usage_reservation_expired' });
    }
    return result(row);
  }
  if (query.includes("error_code = 'ai_usage_result_unavailable_after_debit'")) {
    const [completedAt, updatedAt, id, token] = bindings;
    const member = match[1] === 'member_ai_usage_attempts';
    const owner = member ? 'user_id' : 'organization_id';
    const ledger = state[member ? 'memberCreditLedger' : 'creditLedger'];
    const row = rows.find(r => r.id === id && r.dispatch_token === token && r.provider_outcome === 'succeeded'
      && ((r.status === 'finalizing' && r.billing_status === 'reserved') || (r.status === 'billing_failed' && r.billing_status === 'failed')) && !r.reservation_released_at
      && ledger.some(l => l[owner] === r[owner] && l.idempotency_key === r.idempotency_key && l.amount < 0));
    if (row) Object.assign(row, { status: 'succeeded', billing_status: 'finalized', result_status: row.result_status === 'stored' ? 'stored' : 'unavailable',
      balance_after: ledger.find(l => l[owner] === row[owner] && l.idempotency_key === row.idempotency_key && l.amount < 0).balance_after,
      error_code: 'ai_usage_result_unavailable_after_debit', error_message: null, completed_at: row.completed_at || completedAt, updated_at: updatedAt });
    return result(row);
  }
  if (query.includes("SET status = 'billing_failed'") || query.includes("SET status = 'succeeded'")) {
    const success = query.includes("SET status = 'succeeded'");
    const id = bindings[success ? 12 : bindings.length - 2], token = bindings[success ? 13 : bindings.length - 1];
    const row = rows.find(r => r.id === id && r.dispatch_token === token && r.provider_outcome === 'succeeded' && !r.reservation_released_at && (r.billing_status === 'reserved' || (success && r.billing_status === 'finalized')));
    const upgrade = row && row.status === 'succeeded' && row.result_status === 'unavailable' && bindings[14] === 'stored' && row.expires_at > bindings[15];
    if (!row || (success && row.status !== 'finalizing' && !upgrade)) return result(false);
    // Let the established result-field handler execute after enforcing the new predicate.
    return undefined;
  }
  return undefined;
}
module.exports = { handleAiDispatchQuery };
