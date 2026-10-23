import { nowIso, randomTokenHex, sha256Hex } from './tokens.js';

const SEND_WINDOW_MS = 23 * 60 * 60_000; // Resend retains keys for 24 hours; keep a safety margin.
const MAX_ATTEMPTS = 5;
const PROVIDER_ID = /^[A-Za-z0-9_-]{8,128}$/;
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
export const messageHtml = text => `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</pre>`;

export async function prepareTransactionalMessage(env, { id, sourceId, kind, recipientEmail, subject, text, now = nowIso() }) {
  if (!safeId(id) || !safeId(sourceId) || !['contract_confirmation', 'withdrawal_acknowledgement', 'cancellation_acknowledgement', 'cancellation_confirmation'].includes(kind)
    || !email(recipientEmail) || typeof subject !== 'string' || /[\r\n]/.test(subject) || subject.length > 180
    || typeof text !== 'string' || !text || text.length > 150_000) throw new Error('transactional_message_invalid');
  // Pin the entire request, including sender: retry must never change a body under an accepted key.
  const payload = { from: env.RESEND_FROM_EMAIL || null, to: [recipientEmail], subject, text, html: messageHtml(text) };
  const json = JSON.stringify(payload), hash = await sha256Hex(json);
  return { id, statement: env.DB.prepare(`INSERT INTO transactional_messages
    (id,source_id,kind,payload_json,payload_hash,state,attempt_count,next_attempt_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'queued',0,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,sourceId,kind,json,hash,now,now,now) };
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('mail_response_invalid');
  let size = 0, text = ''; const decoder = new TextDecoder();
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 200_000) throw new Error('mail_response_oversized'); text += decoder.decode(next.value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

async function updateOwned(env, row, { state, code = null, providerId = null, next = null, now }) {
  await env.DB.prepare(`UPDATE transactional_messages SET state=?, error_code=?, next_attempt_at=?,
    provider_message_id=COALESCE(provider_message_id,?), accepted_at=CASE WHEN ? IS NOT NULL THEN COALESCE(accepted_at,?) ELSE accepted_at END,
    lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_token=?`)
    .bind(state,code,next,providerId,providerId,now,now,row.id,row.lease_token).run();
}

async function sendClaimed(env, row, now) {
  const age = Date.parse(now) - Date.parse(row.first_attempt_at);
  if (age >= SEND_WINDOW_MS || row.attempt_count > MAX_ATTEMPTS) {
    await updateOwned(env,row,{state:'review_required',code:'mail_outcome_requires_review',now}); return;
  }
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { /* retain immutable evidence for review */ }
  if (!payload?.from || !env.RESEND_API_KEY) {
    await updateOwned(env,row,{state:'review_required',code:'mail_config_unavailable',now}); return;
  }
  if (await sha256Hex(row.payload_json) !== row.payload_hash) {
    await updateOwned(env,row,{state:'review_required',code:'mail_payload_integrity',now}); return;
  }
  const retry = async code => updateOwned(env,row,{state:row.attempt_count >= MAX_ATTEMPTS ? 'review_required' : 'queued', code,
    next:row.attempt_count >= MAX_ATTEMPTS ? null : new Date(Date.parse(now) + Math.min(30, 2 ** row.attempt_count) * 60_000).toISOString(), now});
  try {
    const response = await fetch('https://api.resend.com/emails', { method:'POST',
      headers:{ Authorization:`Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':`bitbi/${row.id}` },
      body:row.payload_json, signal:AbortSignal.timeout(15_000), redirect:'error' });
    if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); await retry('mail_transient_or_unknown'); return; }
    if (!response.ok) { await response.body?.cancel(); await updateOwned(env,row,{state:'review_required',code:`mail_http_${response.status}`,now}); return; }
    const body = await boundedJson(response);
    if (!PROVIDER_ID.test(body?.id || '')) { await retry('mail_acceptance_unknown'); return; }
    await updateOwned(env,row,{state:'accepted',providerId:body.id,now,next:new Date(Date.parse(now)+5*60_000).toISOString()});
  } catch { await retry('mail_acceptance_unknown'); }
}

async function observeAccepted(env, row, now) {
  if (!env.RESEND_API_KEY || !PROVIDER_ID.test(row.provider_message_id || '')) return;
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_message_id)}`, {
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`}, signal:AbortSignal.timeout(10_000), redirect:'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error('mail_observation_failed'); }
    const data = await boundedJson(response);
    if (data.id !== row.provider_message_id) throw new Error('mail_observation_mismatch');
    const event = data.last_event;
    const state = event === 'delivered' || event === 'opened' || event === 'clicked' ? 'delivered'
      : ['bounced','complained','failed','suppressed'].includes(event) ? 'bounced' : 'accepted';
    const old = Date.parse(now) - Date.parse(row.accepted_at) > 48*60*60_000;
    await env.DB.prepare(`UPDATE transactional_messages SET state=?,delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
      error_code=?,last_checked_at=?,next_attempt_at=?,updated_at=? WHERE id=? AND state='accepted' AND provider_message_id=?`)
      .bind(state,state,now,state==='bounced' ? 'mail_delivery_failed' : old && state==='accepted' ? 'mail_delivery_unconfirmed' : null,
        now,old || state!=='accepted' ? null : new Date(Date.parse(now)+30*60_000).toISOString(),now,row.id,row.provider_message_id).run();
  } catch {
    await env.DB.prepare(`UPDATE transactional_messages SET last_checked_at=?,error_code='mail_observation_unavailable',next_attempt_at=?,updated_at=? WHERE id=? AND state='accepted'`)
      .bind(now,Date.parse(now)-Date.parse(row.accepted_at)>48*60*60_000 ? null : new Date(Date.parse(now)+30*60_000).toISOString(),now,row.id).run();
  }
}

// Called by the existing cron, never by a download/read endpoint. Small serial
// batches respect the shared account; a lease and the same provider key fence replay.
export async function processTransactionalMessages(env, { limit = 10, now = nowIso() } = {}) {
  await env.DB.prepare(`UPDATE transactional_messages SET state='review_required',error_code='mail_outcome_requires_review',
    lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE state='sending' AND lease_expires_at<=? AND attempt_count>=?`)
    .bind(now,now,MAX_ATTEMPTS).run();
  const rows = await env.DB.prepare(`SELECT * FROM transactional_messages WHERE
    (state='queued' AND next_attempt_at<=?) OR (state='sending' AND lease_expires_at<=?)
    OR (state='accepted' AND next_attempt_at IS NOT NULL AND next_attempt_at<=?) ORDER BY created_at,id LIMIT ?`)
    .bind(now,now,now,Math.min(20,Math.max(1,limit))).all();
  let processed=0;
  for (const item of rows.results || []) {
    if (item.state==='accepted') { await observeAccepted(env,item,now); processed++; continue; }
    const token=randomTokenHex(16), lease=new Date(Date.parse(now)+60_000).toISOString();
    const claimed=await env.DB.prepare(`UPDATE transactional_messages SET state='sending',lease_token=?,lease_expires_at=?,
      attempt_count=attempt_count+1,first_attempt_at=COALESCE(first_attempt_at,?),updated_at=? WHERE id=?
      AND ((state='queued' AND next_attempt_at<=?) OR (state='sending' AND lease_expires_at<=?)) RETURNING *`)
      .bind(token,lease,now,now,item.id,now,now).first();
    if (claimed) { await sendClaimed(env,claimed,now); processed++; }
  }
  return {processed};
}
