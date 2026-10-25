// Consent is a request to begin performance, never an automatic withdrawal waiver.
export const CONSUMER_TERMS_VERSION = '2026-10-25';
export const CONSUMER_CONSENT_VERSION = 'consumer-v1';
export const LEGACY_CONSUMER_TERMS_VERSION = '2026-10-22';
// These versions have immutable server snapshots. This is fulfillment support,
// not permission for a client to start a new checkout using an old version.
// 2026-10-25 is provisional until the actual publication day is known.
export const CONSUMER_SNAPSHOT_TERMS_VERSIONS = Object.freeze(['2026-10-23', '2026-10-24', '2026-10-25']);

export function consumerTermsRefreshMessage(locale = 'en') {
  return locale === 'de'
    ? 'Bitte laden Sie die Seite neu und prüfen Sie die aktuellen Bedingungen vor dem Kauf. Es wurde kein neuer Checkout eröffnet.'
    : 'Please reload the page and review the current terms before purchasing. No new checkout was opened.';
}

export function consumerConsentText(locale = 'en') {
  return locale === 'de' ? {
    terms: 'Ich akzeptiere die BITBI-Nutzungsbedingungen vom 25.10.2026.',
    earlyStart: 'Ich verlange ausdrücklich, dass BITBI vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Damit verzichte ich nicht pauschal auf mein Widerrufsrecht.',
    rights: 'Ein Erlöschen des Widerrufsrechts wird nicht automatisch aus dem Kauf oder der Nutzung von Credits abgeleitet. Die gesetzlichen Voraussetzungen werden im Einzelfall geprüft.',
  } : {
    terms: 'I accept the BITBI Terms of Service dated 25 October 2026.',
    earlyStart: 'I expressly request that BITBI begins performance before the withdrawal period ends. This does not constitute a blanket waiver of my right of withdrawal.',
    rights: 'Loss of the right of withdrawal is not automatically inferred from purchasing or using credits. The statutory conditions are assessed individually.',
  };
}

// Credit-pack checkout only. German is the counsel text. English is a faithful
// translation pending legal review and is not a second German wording.
export const CREDIT_PACK_PERFORMANCE_CONSENT_VERSION = 'credit-pack-356-v1';
export const CREDIT_PACK_PERFORMANCE_CONSENT_TEXT = Object.freeze({
  de: 'Ich verlange ausdrücklich, dass bitbi.ai vor Ablauf der Widerrufsfrist mit der Vertragsausführung beginnt und mir die Credits sofort gutschreibt. Mir ist bekannt, dass ich mit dieser Zustimmung mein Widerrufsrecht mit Beginn der Vertragsausführung verliere.',
  en: 'I expressly request that bitbi.ai begin performing the contract before the withdrawal period expires and add the credits to my account immediately. I am aware that, with this consent, I lose my right of withdrawal when performance of the contract begins.',
});

export function creditPackPerformanceConsentText(locale = 'en') {
  return CREDIT_PACK_PERFORMANCE_CONSENT_TEXT[locale === 'de' ? 'de' : 'en'];
}

export const PRICING_FINAL_PRICE_NOTE = Object.freeze({
  de: 'Alle Preise sind Endpreise. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  en: 'All prices are final prices. Pursuant to § 19 UStG, no VAT is charged.',
});
