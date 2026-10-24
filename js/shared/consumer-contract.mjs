// Consent is a request to begin performance, never an automatic withdrawal waiver.
export const CONSUMER_TERMS_VERSION = '2026-10-24';
export const CONSUMER_CONSENT_VERSION = 'consumer-v1';
export const LEGACY_CONSUMER_TERMS_VERSION = '2026-10-22';
// These versions have immutable server snapshots. This is fulfillment support,
// not permission for a client to start a new checkout using an old version.
export const CONSUMER_SNAPSHOT_TERMS_VERSIONS = Object.freeze(['2026-10-23', '2026-10-24']);

export function consumerTermsRefreshMessage(locale = 'en') {
  return locale === 'de'
    ? 'Bitte laden Sie die Seite neu und prüfen Sie die aktuellen Bedingungen vor dem Kauf. Es wurde kein neuer Checkout eröffnet.'
    : 'Please reload the page and review the current terms before purchasing. No new checkout was opened.';
}

export function consumerConsentText(locale = 'en') {
  return locale === 'de' ? {
    terms: 'Ich akzeptiere die BITBI-Nutzungsbedingungen vom 24.10.2026.',
    earlyStart: 'Ich verlange ausdrücklich, dass BITBI vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Damit verzichte ich nicht pauschal auf mein Widerrufsrecht.',
    rights: 'Ein Erlöschen des Widerrufsrechts wird nicht automatisch aus dem Kauf oder der Nutzung von Credits abgeleitet. Die gesetzlichen Voraussetzungen werden im Einzelfall geprüft.',
  } : {
    terms: 'I accept the BITBI Terms of Service dated 24 October 2026.',
    earlyStart: 'I expressly request that BITBI begins performance before the withdrawal period ends. This does not constitute a blanket waiver of my right of withdrawal.',
    rights: 'Loss of the right of withdrawal is not automatically inferred from purchasing or using credits. The statutory conditions are assessed individually.',
  };
}
