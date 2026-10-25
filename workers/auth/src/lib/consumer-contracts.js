import { CONSUMER_TERMS_VERSION, CONSUMER_CONSENT_VERSION, CONSUMER_SNAPSHOT_TERMS_VERSIONS, CREDIT_PACK_PERFORMANCE_CONSENT_VERSION, consumerConsentText, creditPackPerformanceConsentText } from '../../../../js/shared/consumer-contract.mjs';
import { CONSUMER_TERMS_CONTENT } from './consumer-terms-content.js';
import { prepareTransactionalMessage } from './transactional-messages.js';
import { nowIso, sha256Hex } from './tokens.js';

const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const clean = (value, length=300) => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length) : null;

// Version-one summaries remain available for snapshots accepted before summaries
// were pinned. New snapshots carry their own text; fulfillment never reads the
// current product catalog or current terms to reinterpret an accepted offer.
function versionOneOfferSummary(locale, interval) {
  const de=locale==='de';
  return interval
    ? (de?'Laufzeit: monatlich, automatische Verlängerung; ordentliche Kündigung zum Ende des bezahlten Zeitraums. Monatlich wird das Aboguthaben auf 6.000 Credits aufgefüllt; separat gekaufte Credits bleiben getrennt.':'Term: monthly, automatically renewing; ordinary cancellation at the end of the paid period. The subscription balance is topped up to 6,000 credits monthly; separately purchased credits remain separate.')
    : (de?'Einmaliger Credit-Kauf, kein Abonnement.':'One-time credit purchase, not a subscription.');
}

function acceptedTermsLine(termsVersion, locale) {
  if (termsVersion === CONSUMER_TERMS_VERSION) return consumerConsentText(locale).terms;
  // Purchases accepted on 2026-10-24 keep the checkbox sentence stored that day.
  if (termsVersion === '2026-10-24') return locale === 'de'
    ? 'Ich akzeptiere die BITBI-Nutzungsbedingungen vom 24.10.2026.'
    : 'I accept the BITBI Terms of Service dated 24 October 2026.';
  return null;
}

function validateAcceptedSnapshot(row, snapshot, checkout, termsVersion) {
  const scope=checkout.plan_id ? 'member_subscription' : checkout.organization_id ? 'organization' : 'member';
  if (row.terms_version!==termsVersion || snapshot.version!==1 || snapshot.checkoutId!==checkout.id || snapshot.userId!==checkout.user_id
    || snapshot.organizationId!==(checkout.organization_id || null) || row.checkout_scope!==scope || snapshot.scope!==scope
    || !['en','de'].includes(row.locale) || snapshot.locale!==row.locale || snapshot.acceptedAt!==row.accepted_at
    || snapshot.terms?.version!==termsVersion || typeof snapshot.terms.text!=='string' || !snapshot.terms.text.trim()
    || snapshot.consent?.termsAccepted!==true || snapshot.consent.earlyStartRequested!==true
    || !snapshot.offer || !snapshot.customer?.accountEmail)
    throw new Error('contract_snapshot_binding_mismatch');
  if (snapshot.consent.version === CREDIT_PACK_PERFORMANCE_CONSENT_VERSION) {
    if (!['member','organization'].includes(scope) || snapshot.consent.withdrawalKnowledgeAccepted!==true
      || snapshot.consent.extinction!=='on_performance_start'
      || snapshot.consent.wording?.performanceLoss!==creditPackPerformanceConsentText(row.locale)
      || snapshot.consent.wording?.terms!==acceptedTermsLine(termsVersion, row.locale))
      throw new Error('contract_snapshot_binding_mismatch');
  } else if (snapshot.consent?.version!==(termsVersion==='2026-10-23'?'consumer-v1':CONSUMER_CONSENT_VERSION)
    || snapshot.consent.withdrawalKnowledgeAccepted!==false || snapshot.consent.extinction!=='not_determined'
    || !['terms','earlyStart','rights'].every(key=>typeof snapshot.consent.wording?.[key]==='string' && snapshot.consent.wording[key].trim()))
    throw new Error('contract_snapshot_binding_mismatch');
  if (snapshot.offer.contractSummary===undefined && termsVersion!=='2026-10-23') throw new Error('contract_offer_summary_missing');
  if (snapshot.offer.contractSummary!==undefined && (typeof snapshot.offer.contractSummary!=='string' || !snapshot.offer.contractSummary.trim()))
    throw new Error('contract_offer_summary_invalid');
}

export async function prepareConsumerContractSnapshot(env, { checkoutId, userId, organizationId=null, scope, offer, acceptance, now=nowIso() }) {
  // Old accepted checkouts retain only their recorded evidence. Never label current terms as historic terms.
  if (acceptance.termsVersion !== CONSUMER_TERMS_VERSION) return null;
  const user=await env.DB.prepare('SELECT email FROM users WHERE id=? AND status=\'active\'').bind(userId).first();
  if (!user?.email) throw Object.assign(new Error('Contract contact is unavailable.'),{code:'contract_contact_unavailable',status:409});
  const locale=acceptance.locale, content=CONSUMER_TERMS_CONTENT[locale],acceptedAt=acceptance.acceptedAt||now;
  if (content.version !== acceptance.termsVersion) throw new Error('contract_document_version_mismatch');
  const performance=acceptance.creditPackPerformanceConsent===true;
  if (performance && (acceptance.creditPackConsentVersion!==CREDIT_PACK_PERFORMANCE_CONSENT_VERSION
    || acceptance.creditPackConsentText!==creditPackPerformanceConsentText(locale) || offer.interval))
    throw new Error('contract_consent_wording_mismatch');
  const consent=performance
    ? {version:CREDIT_PACK_PERFORMANCE_CONSENT_VERSION,termsAccepted:true,earlyStartRequested:true,withdrawalKnowledgeAccepted:true,
      classification:'acknowledged_loss_on_performance',extinction:'on_performance_start',
      wording:{terms:consumerConsentText(locale).terms,performanceLoss:acceptance.creditPackConsentText}}
    : {version:CONSUMER_CONSENT_VERSION,termsAccepted:true,earlyStartRequested:true,withdrawalKnowledgeAccepted:false,
      classification:'review_required',extinction:'not_determined',wording:consumerConsentText(locale)};
  const snapshot={version:1,checkoutId,userId,organizationId,scope,locale,acceptedAt,
    supplier:{name:'Stefan van Ark',tradingName:'BITBI',address:'Schwarzwaldstraße 20, 78647 Trossingen, Germany',email:'bit@bitbi.ai'},
    customer:{accountEmail:user.email},offer:{...offer,contractSummary:versionOneOfferSummary(locale,offer.interval)},
    consent,
    terms:{version:content.version,text:content.text},
    performance:{startsAfterVerifiedPayment:true,confirmationAvailability:'immutable_account_document',emailDelivery:'separately_observed'},
  };
  const json=JSON.stringify(snapshot),hash=await sha256Hex(json);
  const statement=env.DB.prepare(`INSERT INTO consumer_contract_snapshots(checkout_id,user_id,checkout_scope,terms_version,locale,snapshot_json,snapshot_hash,accepted_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(checkoutId,userId,scope,acceptance.termsVersion,locale,json,hash,acceptedAt);
  return {snapshot,statement};
}

export async function persistConsumerContractSnapshot(env,input) {
  const prepared=await prepareConsumerContractSnapshot(env,input);
  if(prepared)await prepared.statement.run();
  return prepared?.snapshot || null;
}

const IMPRINT_VAT_ID = 'DE462787956';

function legalDateTime(iso, locale) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return String(iso || '');
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).format(date);
}

function euroAmount(cents, locale) {
  return (Number(cents) / 100).toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

const PAYMENT_METHOD_LABELS = Object.freeze({
  de: Object.freeze({ card: 'Karte', paypal: 'PayPal', sepa_debit: 'SEPA-Lastschrift', klarna: 'Klarna' }),
  en: Object.freeze({ card: 'Card', paypal: 'PayPal', sepa_debit: 'SEPA direct debit', klarna: 'Klarna' }),
});

function paymentMethodType(value) {
  const details = value?.payment_method_details || value?.latest_charge?.payment_method_details
    || value?.charges?.data?.[0]?.payment_method_details;
  const type = details?.type;
  return typeof type === 'string' && /^[a-z0-9_]{1,40}$/.test(type) ? type : null;
}

function labelPaymentMethod(type, locale) {
  const language = locale === 'de' ? 'de' : 'en';
  if (!type) return language === 'de' ? 'Zahlung' : 'Payment';
  return PAYMENT_METHOD_LABELS[language][type] || type.split('_').filter(Boolean)
    .map(part => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

// Checkout Session webhooks name the offered method list, not the method that
// was charged. One PaymentIntent read, with the charge expanded, supplies
// payment_method_details.type. A missing or failed read keeps the grant and
// uses the generic fallback label.
async function resolveChargedPaymentMethod(env, raw, locale) {
  const embedded = paymentMethodType(raw) || paymentMethodType(raw?.payment_intent) || paymentMethodType(raw?.latest_charge);
  if (embedded) return labelPaymentMethod(embedded, locale);
  const intentId = typeof raw?.payment_intent === 'string' ? raw.payment_intent : '';
  const live = /^pi_live_[A-Za-z0-9_:-]{8,200}$/.test(intentId);
  const secret = live ? env?.STRIPE_LIVE_SECRET_KEY : null;
  const fetchImpl = env?.__TEST_FETCH || globalThis.fetch;
  if (!live || typeof secret !== 'string' || !secret || typeof fetchImpl !== 'function') return labelPaymentMethod(null, locale);
  try {
    const response = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge`, {
      method: 'GET', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel?.(); return labelPaymentMethod(null, locale); }
    const body = await response.json();
    if (body?.id !== intentId) return labelPaymentMethod(null, locale);
    return labelPaymentMethod(paymentMethodType(body), locale);
  } catch {
    return labelPaymentMethod(null, locale);
  }
}

function creditPackConfirmationText(snapshot, payment, createdAt, checkout) {
  const de = snapshot.locale === 'de';
  const name = payment.name || snapshot.customer.accountEmail;
  const orderedAt = legalDateTime(checkout.created_at || snapshot.acceptedAt, snapshot.locale);
  const consentedAt = legalDateTime(snapshot.acceptedAt, snapshot.locale);
  const grantedAt = legalDateTime(createdAt, snapshot.locale);
  const price = euroAmount(payment.amountTotal, snapshot.locale);
  const provider = `${snapshot.supplier.name}, ${snapshot.supplier.address}, ${snapshot.supplier.email}`;
  const documents = de
    ? `AGB und Widerrufsbelehrung samt Muster-Widerrufsformular\nFassung: ${snapshot.terms.version}\n\n${snapshot.terms.text}`
    : `Terms and withdrawal instructions, including the model withdrawal form\nVersion: ${snapshot.terms.version}\n\n${snapshot.terms.text}`;
  const body = de
    ? `Hallo ${name},\n\nvielen Dank für deinen Kauf. Hiermit bestätigen wir den Vertrag:\n\nProdukt: ${snapshot.offer.name} (${snapshot.offer.credits} Credits)\nPreis: ${price} € (Endpreis; gemäß § 19 UStG wird keine Umsatzsteuer berechnet)\nBestelldatum: ${orderedAt}\nZahlungsart: ${payment.method}\n\nDeine Zustimmung zum sofortigen Beginn: Du hast am ${consentedAt} ausdrücklich verlangt, dass wir vor Ablauf der Widerrufsfrist mit der Vertragsausführung beginnen. Du hast bestätigt, dass dir bekannt ist, dass du damit dein Widerrufsrecht mit Beginn der Vertragsausführung verlierst. Die Credits wurden deinem Konto am ${grantedAt} gutgeschrieben.\n\nNachfolgend findest du unsere AGB und die Widerrufsbelehrung samt Muster-Widerrufsformular im vollständigen Wortlaut, in der Fassung, die zum Zeitpunkt deiner Bestellung galt.\n\nAnbieter: ${provider}, USt-IdNr. ${IMPRINT_VAT_ID}`
    : `Hello ${name},\n\nthank you for your purchase. We hereby confirm the contract:\n\nProduct: ${snapshot.offer.name} (${snapshot.offer.credits} credits)\nPrice: ${price} € (final price; pursuant to § 19 UStG, no VAT is charged)\nOrder date: ${orderedAt}\nPayment method: ${payment.method}\n\nYour consent to immediate performance: On ${consentedAt} you expressly requested that we begin performing the contract before the withdrawal period expires. You confirmed that you are aware that you thereby lose your right of withdrawal when performance of the contract begins. The credits were credited to your account on ${grantedAt}.\n\nOur terms and the withdrawal instructions, including the model withdrawal form, in the version that applied when you ordered, are included in full below.\n\nProvider: ${provider}, VAT ID pursuant to § 27a UStG: ${IMPRINT_VAT_ID}`;
  return `${body}\n\n${documents}`;
}

function confirmationText(snapshot,payment,createdAt) {
  const de=snapshot.locale==='de', consent=snapshot.consent;
  return [de?'BITBI – Vertragsbestätigung':'BITBI — Contract confirmation','',
    `${de?'Vertragsreferenz':'Contract reference'}: ${snapshot.checkoutId}`,
    `${de?'Bestätigung erstellt':'Confirmation created'}: ${createdAt}`,
    `${de?'Anbieter':'Supplier'}: ${snapshot.supplier.name} / BITBI, ${snapshot.supplier.address}, ${snapshot.supplier.email}`,
    `${de?'Vertragspartner':'Customer'}: ${payment.name || snapshot.customer.accountEmail}`,
    payment.address ? `${de?'Rechnungsanschrift':'Billing address'}: ${Object.values(payment.address).filter(Boolean).join(', ')}` : '',
    `${de?'Kontokontakt':'Account contact'}: ${snapshot.customer.accountEmail}`,
    `${de?'Angebot':'Offer'}: ${snapshot.offer.name} (${snapshot.offer.id})`,
    `${de?'Credits':'Credits'}: ${snapshot.offer.credits ?? snapshot.offer.allowanceCredits}`,
    snapshot.offer.storageLimitBytes ? `${de?'Speicher':'Storage'}: ${snapshot.offer.storageLimitBytes} bytes` : '',
    `${de?'Preis / Währung':'Price / currency'}: ${(payment.amountTotal/100).toFixed(2)} ${payment.currency.toUpperCase()}`,
    `${de?'Steuern laut Zahlungsbeleg':'Tax recorded by payment provider'}: ${payment.taxAmount === null ? (de?'nicht separat ausgewiesen':'not separately stated') : `${(payment.taxAmount/100).toFixed(2)} ${payment.currency.toUpperCase()}`}`,
    snapshot.offer.contractSummary ?? versionOneOfferSummary(snapshot.locale,snapshot.offer.interval),
    '',`${de?'Zustimmung erfasst':'Consent recorded'}: ${snapshot.acceptedAt}`,
    consent.wording.terms,consent.wording.earlyStart,consent.wording.rights,
    '',de?'Vollständige vereinbarte Bedingungen einschließlich Widerrufsbelehrung und Musterformular:':'Full applicable terms, including withdrawal instructions and model form:',
    snapshot.terms.text,
  ].filter(value=>value!==null).join('\n');
}

// Caller supplies only a signature-verified, ownership-checked Stripe object and
// commits these statements in its existing fulfillment transaction.
export async function prepareConsumerConfirmation(env,{checkout,payload,providerEventId,now=nowIso()}) {
  const termsVersion=parse(checkout.metadata_json).termsVersion;
  if (!CONSUMER_SNAPSHOT_TERMS_VERSIONS.includes(termsVersion)) {
    // Pre-snapshot purchases retain their original legacy behavior. A newer
    // unrecognized document protocol must not silently omit its confirmation.
    if (typeof termsVersion==='string' && termsVersion>='2026-10-23') throw new Error('contract_terms_version_unsupported');
    return [];
  }
  const row=await env.DB.prepare('SELECT * FROM consumer_contract_snapshots WHERE checkout_id=? AND user_id=?').bind(checkout.id,checkout.user_id).first();
  if (!row) throw new Error('contract_snapshot_missing'); // New consent must have its actual immutable evidence.
  if (await sha256Hex(row.snapshot_json)!==row.snapshot_hash) throw new Error('contract_snapshot_integrity');
  const snapshot=parse(row.snapshot_json), raw=payload?.data?.object || {};
  validateAcceptedSnapshot(row,snapshot,checkout,termsVersion);
  const current=await env.DB.prepare('SELECT checkout_id FROM consumer_contract_confirmations WHERE checkout_id=?').bind(checkout.id).first();
  if(current) return [];
  const sessionId=checkout.provider_checkout_session_id;
  if (!sessionId || !providerEventId) throw new Error('contract_payment_identity_missing');
  const amount=raw.amount_total ?? raw.amount_paid;
  if (!Number.isSafeInteger(amount) || amount<0 || typeof raw.currency!=='string') throw new Error('contract_payment_amount_missing');
  const details=raw.customer_details || {}, address=details.address || raw.customer_address;
  const creditPack=snapshot.consent?.version===CREDIT_PACK_PERFORMANCE_CONSENT_VERSION;
  const payment={sessionId,providerEventId,eventType:payload.type,providerEventTime:Number.isSafeInteger(payload.created)?new Date(payload.created*1000).toISOString():null,
    amountTotal:amount,currency:raw.currency.toLowerCase(),taxAmount:Number.isSafeInteger(raw.total_details?.amount_tax)?raw.total_details.amount_tax:null,
    method:creditPack ? await resolveChargedPaymentMethod(env, raw, snapshot.locale) : labelPaymentMethod(paymentMethodType(raw), snapshot.locale),
    name:clean(details.name || raw.customer_name),address:address && typeof address==='object' ? Object.fromEntries(['line1','line2','city','state','postal_code','country'].map(key=>[key,clean(address[key])])) : null};
  const document={version:1,snapshot,payment,createdAt:now,text:creditPack?creditPackConfirmationText(snapshot,payment,now,checkout):confirmationText(snapshot,payment,now)};
  const json=JSON.stringify(document),hash=await sha256Hex(json);
  const subject=creditPack
    ? (snapshot.locale==='de'?`Deine Bestellung bei bitbi.ai – Vertragsbestätigung Nr. ${snapshot.checkoutId}`:`Your order at bitbi.ai – contract confirmation no. ${snapshot.checkoutId}`)
    : (snapshot.locale==='de'?'BITBI – Ihre Vertragsbestätigung':'BITBI — Your contract confirmation');
  const message=await prepareTransactionalMessage(env,{id:`contract:${checkout.id}`,sourceId:checkout.id,kind:'contract_confirmation',recipientEmail:snapshot.customer.accountEmail,
    subject,text:document.text,now});
  return [env.DB.prepare(`INSERT INTO consumer_contract_confirmations(checkout_id,provider_session_id,provider_event_id,document_json,document_hash,created_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(checkout_id) DO NOTHING`).bind(checkout.id,sessionId,providerEventId,json,hash,now),message.statement];
}

export async function readOwnedContractConfirmation(env,{checkoutId,userId}) {
  const row=await env.DB.prepare(`SELECT c.document_json,c.document_hash,c.created_at FROM consumer_contract_confirmations c
    JOIN consumer_contract_snapshots s ON s.checkout_id=c.checkout_id WHERE c.checkout_id=? AND s.user_id=?`).bind(checkoutId,userId).first();
  return row ? {document:parse(row.document_json),digest:row.document_hash,createdAt:row.created_at} : null;
}

export async function listOwnedContractConfirmations(env,{userId,cursor=null}) {
  const boundary=cursor?.indexOf('|'),before=cursor?cursor.slice(0,boundary):'9999-12-31T23:59:59.999Z',beforeId=cursor?cursor.slice(boundary+1):'zz';
  const result=await env.DB.prepare(`SELECT c.checkout_id,c.created_at,s.locale,json_extract(s.snapshot_json,'$.offer.name') AS offer_name
    FROM consumer_contract_snapshots s JOIN consumer_contract_confirmations c ON c.checkout_id=s.checkout_id
    WHERE s.user_id=? AND (c.created_at<? OR (c.created_at=? AND c.checkout_id<?))
    ORDER BY c.created_at DESC,c.checkout_id DESC LIMIT 31`).bind(userId,before,before,beforeId).all();
  const rows=(result.results||[]).slice(0,30);
  return {items:rows.map(row=>({checkoutId:row.checkout_id,offerName:row.offer_name,createdAt:row.created_at,locale:row.locale})),
    nextCursor:result.results?.length>30?`${rows.at(-1).created_at}|${rows.at(-1).checkout_id}`:null};
}

// Only call after the exact subscription response has been validated and saved.
// The original operation key preserves a lost local acknowledgement without a
// second email; declaration intake has its own, separate acknowledgement.
export async function queueCancellationConfirmation(env,{userId,subscription,idempotencyKey,locale,providerEndedAt=null,now=nowIso()}) {
  if((subscription?.cancelAtPeriodEnd!==true && subscription?.status!=='canceled') || !subscription.providerSubscriptionId || !subscription.currentPeriodEnd)
    throw new Error('cancellation_confirmation_unproven');
  const user=await env.DB.prepare("SELECT email FROM users WHERE id=? AND status='active'").bind(userId).first();
  if(!user?.email)throw new Error('cancellation_confirmation_contact_unavailable');
  const language=['en','de'].includes(locale)?locale:'en',de=language==='de';
  const ended=subscription.status==='canceled',effectiveEnd=ended?providerEndedAt:subscription.currentPeriodEnd;
  const id=`cancellation:${await sha256Hex(`${userId}:${subscription.providerSubscriptionId}:${idempotencyKey}`)}`;
  const text=[de?'BITBI – Kündigungsbestätigung':'BITBI — Subscription cancellation confirmation','',
    `${de?'Vertrag':'Contract'}: BITBI Pro (${subscription.providerSubscriptionId})`,
    `${de?'Bestätigung erstellt (UTC)':'Confirmation created (UTC)'}: ${now}`,
    `${de?'Bestätigtes Vertragsende (UTC)':'Confirmed contract end (UTC)'}: ${effectiveEnd || (de?'noch nicht belegt':'not yet established')}`,
    ended ? (de?'Stripe hat die Beendigung dieses Abonnements bestätigt.':'Stripe has confirmed that this subscription has ended.') : de?'Stripe hat die Kündigung zum Ende des bezahlten Zeitraums bestätigt. Bis dahin bleibt der bezahlte Zugang bestehen.':'Stripe has confirmed cancellation at the end of the paid period. Paid access remains available until then.',
    de?'Das Konto, gespeicherte Medien und separat gekaufte Credits werden durch diese Kündigung nicht gelöscht. Dies ist keine Widerrufs- oder Erstattungsbestätigung.':'This cancellation does not delete your account, saved media or separately purchased credits. It is not a withdrawal or refund confirmation.',
    'BITBI · Stefan van Ark · Schwarzwaldstraße 20 · 78647 Trossingen · Germany · bit@bitbi.ai'].join('\n');
  const message=await prepareTransactionalMessage(env,{id,sourceId:subscription.providerSubscriptionId,kind:'cancellation_confirmation',
    recipientEmail:user.email,subject:de?'BITBI – Ihre Kündigungsbestätigung':'BITBI — Your subscription cancellation confirmation',text,now});
  await message.statement.run();
  return {id,state:'queued'};
}
