// Increment only for a material change to MiniMax recipients, purpose, data or terms.
export const MINIMAX_CONSENT_TEXT_VERSION = 'minimax-consent-v3-2026-11-16';
export const MINIMAX_CONSENT_MODELS = Object.freeze(['minimax/h3', 'minimax/h3-lite', 'minimax/music-2.6']);
export function isMinimaxConsentModel(model) { return MINIMAX_CONSENT_MODELS.includes(model); }
export function minimaxConsentLocale(locale) { return String(locale || '').toLowerCase().startsWith('de') ? 'de' : 'en'; }
export function effectiveMinimaxConsent(row) {
  return Boolean(row?.granted_at && !row.revoked_at && row.text_version === MINIMAX_CONSENT_TEXT_VERSION);
}
