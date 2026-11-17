import { MINIMAX_CONSENT_TEXT_VERSION, effectiveMinimaxConsent, isMinimaxConsentModel, minimaxConsentLocale } from '../../../../js/shared/minimax-consent.mjs';
import { nowIso } from './tokens.js';
import { logUserActivity } from './activity.js';
import { logDiagnostic } from '../../../../js/shared/worker-observability.mjs';

export async function getMinimaxConsent(env,userId) {
  const row = await env.DB.prepare('SELECT * FROM minimax_consent_current WHERE user_id=?').bind(userId).first();
  return {granted:effectiveMinimaxConsent(row),grantedAt:row?.granted_at||null,revokedAt:row?.revoked_at||null,
    textVersion:row?.text_version||null,currentTextVersion:MINIMAX_CONSENT_TEXT_VERSION,locale:row?.locale||null,source:row?.source||null};
}
export async function assertMinimaxConsent(env,userId,model) {
  if (!isMinimaxConsentModel(model)) return;
  if (!(await getMinimaxConsent(env,userId)).granted) throw Object.assign(new Error('MiniMax consent is required.'),{status:403,code:'consent_required',definitelyNotDispatched:true});
}
export function minimaxGrantStatements(env,userId,{locale='en',source='first_use',at=nowIso()}={}) {
  locale=minimaxConsentLocale(locale);
  return [env.DB.prepare(`INSERT INTO minimax_consent_events(id,user_id,action,text_version,locale,source,created_at)
    VALUES(?,?,'grant',?,?,?,?)`).bind(crypto.randomUUID(),userId,MINIMAX_CONSENT_TEXT_VERSION,locale,source,at),
    env.DB.prepare(`INSERT INTO minimax_consent_current(user_id,granted_at,revoked_at,text_version,locale,source,updated_at)
    VALUES(?,?,NULL,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET granted_at=excluded.granted_at,revoked_at=NULL,
    text_version=excluded.text_version,locale=excluded.locale,source=excluded.source,updated_at=excluded.updated_at`)
    .bind(userId,at,MINIMAX_CONSENT_TEXT_VERSION,locale,source,at)];
}
export async function recordMinimaxActivity(ctx,userId,action,status) {
  const meta={text_version:status.textVersion,locale:status.locale,source:status.source,[action==='grant'?'granted_at':'revoked_at']:action==='grant'?status.grantedAt:status.revokedAt};
  logDiagnostic({service:'bitbi-auth',component:'minimax-consent',event:`minimax_consent_${action}`,user_id:userId,...meta});
  await logUserActivity(ctx.env,userId,`minimax_consent_${action}`,meta,null,{correlationId:ctx.correlationId,requestInfo:ctx});
}
export async function revokeMinimaxConsent(env,userId) {
  const at=nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO minimax_consent_events(id,user_id,action,text_version,locale,source,created_at)
      SELECT ?,user_id,'revoke',text_version,locale,'settings',? FROM minimax_consent_current
      WHERE user_id=? AND granted_at IS NOT NULL AND revoked_at IS NULL`).bind(crypto.randomUUID(),at,userId),
    env.DB.prepare(`UPDATE minimax_consent_current SET revoked_at=?,source='settings',updated_at=? WHERE user_id=? AND revoked_at IS NULL`).bind(at,at,userId),
  ]);
  return getMinimaxConsent(env,userId);
}
export async function purgeExpiredMinimaxProof(env) {
  // Existing scheduled lifecycle, bounded per invocation; DB trigger independently
  // refuses active or not-yet-expired evidence even if a caller's clock is wrong.
  return env.DB.batch([env.DB.prepare(`DELETE FROM minimax_consent_events WHERE id IN
    (SELECT event_id FROM minimax_consent_retention WHERE retain_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY retain_until LIMIT 500)`),
    env.DB.prepare(`DELETE FROM minimax_consent_current WHERE revoked_at IS NOT NULL
      AND strftime('%Y-01-01T00:00:00.000Z',revoked_at,'start of year','+4 years')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM minimax_consent_events e WHERE e.user_id=minimax_consent_current.user_id)`)]);
}
