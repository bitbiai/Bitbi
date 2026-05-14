/* ============================================================
   BITBI — Public Pricing / Live Credit Packs
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import {
    apiCreateMemberLiveCreditPackCheckout,
    apiCreateMemberSubscriptionCheckout,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { getCurrentLocale, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { BITBI_LIVE_CREDIT_PACKS } from '../../shared/live-credit-packs.mjs?v=__ASSET_VERSION__';
import { BITBI_MEMBER_SUBSCRIPTION } from '../../shared/member-subscription.mjs?v=__ASSET_VERSION__';

const TERMS_VERSION = '2026-05-05';
const PENDING_PACK_KEY = 'bitbi_pending_credit_pack';
const PENDING_OFFER_KEY = 'bitbi_pending_pricing_offer';
const LOCALE = getCurrentLocale();
const NUMBER_FORMATTER = new Intl.NumberFormat(LOCALE === 'de' ? 'de-DE' : 'en-US');
const STRIPE_CHECKOUT_ORIGINS = new Set([
    'https://checkout.stripe.com',
    'https://pay.bitbi.ai',
]);

const COPY = Object.freeze({
    en: Object.freeze({
        title: 'BITBI Credits & Pro',
        loading: 'Loading credit packs.',
        pricing: 'Pricing',
        subtitle: 'Flexible credits for image, video, music, and asset generation.',
        heroCopy: 'Choose BITBI Pro for a monthly creative allowance, or buy one-time credits when you need extra room. Credits stay account-bound and checkout stays Stripe-hosted.',
        heroPrimary: 'Choose an option',
        heroSecondary: 'How credits work',
        trust: ['Secure Stripe checkout', 'Credits for AI generation', 'Manage in account'],
        heroStats: Object.freeze([
            ['6000', 'monthly Pro credits'],
            ['5 GB', 'Asset Manager storage with Pro'],
            ['2', 'one-time credit packs'],
        ]),
        securePayment: 'Secure payment continues on pay.bitbi.ai.',
        checkoutHostDetail: 'Review your choice on BITBI, accept the required confirmations, then complete payment on the Stripe-hosted checkout domain.',
        successful: 'Payment successful',
        successCopy: 'You are back on BITBI. Your account-bound credits will appear shortly after the verified Stripe payment confirmation is processed.',
        viewCredits: 'View credits',
        cancelled: 'Checkout was cancelled',
        cancelCopy: 'You have not been charged. Your selected BITBI credit pack is still available if you want to continue later.',
        oneTime: 'One-time payment',
        monthly: 'Monthly subscription',
        subscriptionSection: 'Monthly subscription',
        oneTimeSection: 'One-time credit packs',
        subscribe: 'Subscribe',
        selectedSubscription: 'BITBI Pro selected',
        subscriptionSelected: 'BITBI Pro selected. Review the legal confirmations below before checkout.',
        subscriptionSummary: 'Selected subscription: BITBI Pro · 6000 credits per month · 9,99 € / month. Prices include statutory VAT where applicable.',
        loggedOutCta: 'Create account to buy',
        selectedPack: 'Selected pack',
        selectPack: 'Select pack',
        loggedOutMessage: 'Create an account or sign in to buy credits.',
        packSelected: '{title} selected. Review the legal confirmations below before checkout.',
        loggedOutDestination: 'Create an account or sign in first. Credits will be added to your BITBI member account after verified Stripe payment.',
        memberDestination: 'Credit destination: your BITBI member account. No organization setup or owner role is required. Credits are account-bound usage units, not tokens, currency, crypto, or transferable value.',
        checkoutRequirements: 'Checkout requirements',
        selectedSummary: 'Selected pack: {title} · {credits} credits · {price}. Prices include statutory VAT where applicable.',
        acceptTermsPrefix: 'I accept the ',
        termsLink: 'BITBI Terms',
        deliveryText: 'I request immediate provision of the credits and confirm that my withdrawal right may expire after provision or use of the digital credits, where legally permitted.',
        checkoutBusy: 'Opening checkout…',
        checkout: 'Continue to secure checkout',
        legalError: 'Please accept the Terms and confirm immediate provision of the digital credits.',
        loginFirst: 'Create an account or sign in to buy credits.',
        checkoutFailed: 'Checkout could not be opened. Please try again.',
        unsafeCheckout: 'Checkout response was not a recognized Stripe-hosted payment URL. No payment was started.',
        accountCreated: 'Account created. Please review the terms and continue to checkout.',
        creditPacks: 'Credit packs',
        offersTitle: 'Choose how you want to create',
        offersCopy: 'BITBI Pro is best for regular creation. One-time packs stay available for flexible top-ups without a subscription.',
        included: 'Included',
        bestFor: 'Best for',
        subscriptionBestFor: 'Regular creators who want predictable monthly credits and more storage.',
        subscriptionBenefits: Object.freeze([
            '6000 credits included each month',
            '5 GB Asset Manager storage',
            'Subscription credits are topped up to 6000 each month',
            'No accumulation beyond the monthly allowance',
            'One-time purchased credits remain separate and additional',
            'Secure Stripe checkout',
        ]),
        creditsLabel: 'credits',
        creditBenefit: '{credits} prepaid credits',
        trustNotes: 'Pricing trust notes',
        packs: Object.freeze({
            live_credits_5000: Object.freeze({
                title: 'Starter Credits',
                description: 'Perfect for first experiments, image generations, and smaller creative sessions.',
                bestFor: 'Trying BITBI or topping up a smaller project.',
                benefits: ['Use across supported BITBI AI tools', 'No subscription or renewal'],
            }),
            live_credits_12000: Object.freeze({
                title: 'Creator Credits',
                badge: 'Best value',
                description: 'More room for high-quality images, video tests, music creation, and reference-based workflows.',
                bestFor: 'Larger sessions and users who want more credits per checkout.',
                benefits: ['Best current value per credit', 'Built for larger creative sessions'],
            }),
        }),
        guideTitle: 'What happens after purchase',
        guideCopy: 'Credits are digital usage units for supported BITBI AI tools. They are added only after verified Stripe payment confirmation.',
        info: Object.freeze([
            ['Use credits across BITBI', 'Images, video tests, music generation, and asset workflows use credits based on model, quality, duration, references, and compute cost.'],
            ['One-time packs stay separate', 'Purchased credits are added to your member account and do not renew automatically. Buy them when you need extra capacity.'],
            ['BITBI Pro stays predictable', 'Subscription credits are topped up to 6000 each billing period and do not accumulate beyond that allowance. Purchased credits remain additional.'],
        ]),
        faqTitle: 'Pricing clarity',
        faqs: Object.freeze([
            ['Can I cancel BITBI Pro?', 'Yes. Manage your subscription from the Credits page. A cancellation is scheduled for the end of the paid period.'],
            ['Do one-time packs renew?', 'No. Starter Credits and Creator Credits are one-time purchases with no automatic renewal.'],
            ['Where do I manage credits?', 'Use the account Credits page to see balances, subscription status, purchases, and recent credit activity.'],
            ['Is checkout secure?', 'Checkout continues on pay.bitbi.ai, a Stripe-hosted payment domain. BITBI does not store full card details.'],
            ['Are credits transferable?', 'No. Credits are account-bound digital usage units for BITBI tools, not cash, tokens, crypto, or transferable value.'],
            ['Are AI results guaranteed?', 'No. AI output can vary. You remain responsible for prompts, reference material, rights clearance, and use of generated content.'],
        ]),
    }),
    de: Object.freeze({
        title: 'BITBI Credits & Pro',
        loading: 'Credit-Pakete werden geladen.',
        pricing: 'Preise',
        subtitle: 'Flexible Credits für Bild-, Video-, Musik- und Asset-Generierung.',
        heroCopy: 'Wählen Sie BITBI Pro für ein monatliches Kreativkontingent oder kaufen Sie einmalige Credits, wenn Sie zusätzlichen Spielraum brauchen. Credits bleiben kontogebunden und der Checkout läuft über Stripe.',
        heroPrimary: 'Option auswählen',
        heroSecondary: 'So funktionieren Credits',
        trust: ['Sicherer Stripe-Checkout', 'Credits für KI-Generierung', 'Im Konto verwalten'],
        heroStats: Object.freeze([
            ['6000', 'monatliche Pro-Credits'],
            ['5 GB', 'Assets-Manager-Speicher mit Pro'],
            ['2', 'einmalige Credit-Pakete'],
        ]),
        securePayment: 'Die sichere Zahlung wird auf pay.bitbi.ai fortgesetzt.',
        checkoutHostDetail: 'Prüfen Sie Ihre Auswahl auf BITBI, bestätigen Sie die erforderlichen Hinweise und schließen Sie die Zahlung auf der von Stripe gehosteten Checkout-Domain ab.',
        successful: 'Zahlung erfolgreich',
        successCopy: 'Sie sind zurück auf BITBI. Ihre kontogebundenen Credits erscheinen in Kürze, nachdem die bestätigte Stripe-Zahlung verarbeitet wurde.',
        viewCredits: 'Credits anzeigen',
        cancelled: 'Checkout wurde abgebrochen',
        cancelCopy: 'Ihnen wurde nichts berechnet. Ihr ausgewähltes BITBI Credit-Paket bleibt verfügbar, falls Sie später fortfahren möchten.',
        oneTime: 'Einmalzahlung',
        monthly: 'Monatsabo',
        subscriptionSection: 'Monatsabo',
        oneTimeSection: 'Einmalige Credit-Pakete',
        subscribe: 'Abonnieren',
        selectedSubscription: 'BITBI Pro ausgewählt',
        subscriptionSelected: 'BITBI Pro ausgewählt. Bitte prüfen Sie unten die rechtlichen Bestätigungen vor dem Checkout.',
        subscriptionSummary: 'Ausgewähltes Abo: BITBI Pro · 6000 Credits pro Monat · 9,99 € / Monat. Preise enthalten die gesetzliche Umsatzsteuer, soweit anwendbar.',
        loggedOutCta: 'Konto erstellen und kaufen',
        selectedPack: 'Paket ausgewählt',
        selectPack: 'Paket auswählen',
        loggedOutMessage: 'Erstelle ein Konto oder melde dich an, um Credits zu kaufen.',
        packSelected: '{title} ausgewählt. Bitte prüfen Sie unten die rechtlichen Bestätigungen vor dem Checkout.',
        loggedOutDestination: 'Erstellen Sie zuerst ein Konto oder melden Sie sich an. Die Credits werden nach bestätigter Stripe-Zahlung Ihrem BITBI-Mitgliedskonto gutgeschrieben.',
        memberDestination: 'Credit-Ziel: Ihr BITBI-Mitgliedskonto. Keine Organisationseinrichtung und keine Owner-Rolle erforderlich. Credits sind kontogebundene Nutzungseinheiten, keine Token, Währung, Krypto oder übertragbaren Werte.',
        checkoutRequirements: 'Voraussetzungen für den Checkout',
        selectedSummary: 'Ausgewähltes Paket: {title} · {credits} Credits · {price}. Preise enthalten die gesetzliche Umsatzsteuer, soweit anwendbar.',
        acceptTermsPrefix: 'Ich akzeptiere die ',
        termsLink: 'AGB von BITBI',
        deliveryText: 'Ich verlange die sofortige Bereitstellung der Credits und bestätige, dass mein Widerrufsrecht nach Bereitstellung oder Nutzung der digitalen Credits erlöschen kann, soweit gesetzlich zulässig.',
        checkoutBusy: 'Checkout wird geöffnet…',
        checkout: 'Weiter zum sicheren Checkout',
        legalError: 'Bitte akzeptieren Sie die AGB und bestätigen Sie die sofortige Bereitstellung der digitalen Credits.',
        loginFirst: 'Erstelle ein Konto oder melde dich an, um Credits zu kaufen.',
        checkoutFailed: 'Checkout konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.',
        unsafeCheckout: 'Die Checkout-Antwort war keine erkannte von Stripe gehostete Zahlungs-URL. Es wurde keine Zahlung gestartet.',
        accountCreated: 'Konto erstellt. Bitte prüfen Sie die Bedingungen und fahren Sie mit dem Checkout fort.',
        creditPacks: 'Credit-Pakete',
        offersTitle: 'Wählen Sie, wie Sie erstellen möchten',
        offersCopy: 'BITBI Pro eignet sich für regelmäßige Nutzung. Einmalige Pakete bleiben für flexible Aufladungen ohne Abo verfügbar.',
        included: 'Enthalten',
        bestFor: 'Geeignet für',
        subscriptionBestFor: 'Regelmäßige Creator, die planbare Monats-Credits und mehr Speicher möchten.',
        subscriptionBenefits: Object.freeze([
            '6000 Credits monatlich inklusive',
            '5 GB Assets-Manager-Speicher',
            'Abo-Credits werden jeden Monat auf 6000 aufgefüllt',
            'Keine Ansammlung über das monatliche Kontingent hinaus',
            'Einmalig gekaufte Credits bleiben getrennt und zusätzlich erhalten',
            'Sicherer Stripe-Checkout',
        ]),
        creditsLabel: 'Credits',
        creditBenefit: '{credits} Prepaid-Credits',
        trustNotes: 'Vertrauenshinweise zu Preisen',
        packs: Object.freeze({
            live_credits_5000: Object.freeze({
                title: 'Starter Credits',
                description: 'Ideal für erste Experimente, Bildgenerierungen und kleinere Kreativ-Sessions.',
                bestFor: 'BITBI ausprobieren oder ein kleineres Projekt aufladen.',
                benefits: ['Für unterstützte BITBI-KI-Werkzeuge nutzbar', 'Kein Abo und keine Verlängerung'],
            }),
            live_credits_12000: Object.freeze({
                title: 'Creator Credits',
                badge: 'Bester Wert',
                description: 'Mehr Spielraum für hochwertige Bilder, Video-Tests, Musik und referenzbasierte Workflows.',
                bestFor: 'Größere Sessions und mehr Credits pro Checkout.',
                benefits: ['Aktuell bester Gegenwert pro Credit', 'Für größere Kreativ-Sessions ausgelegt'],
            }),
        }),
        guideTitle: 'Was nach dem Kauf passiert',
        guideCopy: 'Credits sind digitale Nutzungseinheiten für unterstützte BITBI-KI-Werkzeuge. Sie werden erst nach bestätigter Stripe-Zahlung gutgeschrieben.',
        info: Object.freeze([
            ['Credits in BITBI nutzen', 'Bilder, Video-Tests, Musikgenerierung und Asset-Workflows verbrauchen Credits je nach Modell, Qualität, Dauer, Referenzen und Rechenaufwand.'],
            ['Einmalige Pakete bleiben getrennt', 'Gekaufte Credits werden Ihrem Mitgliedskonto gutgeschrieben und verlängern sich nicht automatisch. Sie kaufen sie nur bei Bedarf.'],
            ['BITBI Pro bleibt planbar', 'Abo-Credits werden je Abrechnungsperiode auf 6000 aufgefüllt und sammeln sich nicht darüber hinaus an. Gekaufte Credits bleiben zusätzlich erhalten.'],
        ]),
        faqTitle: 'Klarheit zu Preisen',
        faqs: Object.freeze([
            ['Kann ich BITBI Pro kündigen?', 'Ja. Sie verwalten Ihr Abo auf der Credits-Seite. Eine Kündigung wird zum Ende der bezahlten Periode vorgemerkt.'],
            ['Verlängern sich Einmalpakete?', 'Nein. Starter Credits und Creator Credits sind einmalige Käufe ohne automatische Verlängerung.'],
            ['Wo verwalte ich Credits?', 'Auf der Credits-Seite im Konto sehen Sie Guthaben, Abo-Status, Käufe und aktuelle Credit-Aktivität.'],
            ['Ist der Checkout sicher?', 'Der Checkout läuft über pay.bitbi.ai, eine von Stripe gehostete Zahlungsdomain. BITBI speichert keine vollständigen Kartendaten.'],
            ['Sind Credits übertragbar?', 'Nein. Credits sind kontogebundene digitale Nutzungseinheiten für BITBI-Werkzeuge, kein Bargeld, keine Token, kein Krypto und kein übertragbarer Wert.'],
            ['Sind KI-Ergebnisse garantiert?', 'Nein. KI-Ergebnisse können variieren. Sie bleiben verantwortlich für Prompts, Referenzmaterial, Rechteklärung und die Nutzung generierter Inhalte.'],
        ]),
    }),
});

function t(key, values = {}) {
    const copy = COPY[LOCALE] || COPY.en;
    const value = copy[key] ?? COPY.en[key] ?? key;
    return String(value).replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? '');
}

function formatPackPrice(amountCents) {
    const amount = Number(amountCents || 0) / 100;
    return `${amount.toLocaleString(LOCALE === 'de' ? 'de-DE' : 'en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} €`;
}

const CREDIT_PACKS = Object.freeze(BITBI_LIVE_CREDIT_PACKS.map((pack) => Object.freeze({
    id: pack.id,
    credits: pack.credits,
    price: formatPackPrice(pack.amountCents),
    featured: pack.id === 'live_credits_12000',
})));

let selectedPackId = sessionStorage.getItem(PENDING_PACK_KEY) || 'live_credits_12000';
let selectedOfferType = sessionStorage.getItem(PENDING_OFFER_KEY) || 'subscription';
let termsAccepted = false;
let immediateDeliveryAccepted = false;
let checkoutBusy = false;
let inlineMessage = '';
let inlineMessageTone = 'neutral';
let lastAuthLoggedIn = false;

function byId(id) {
    return document.getElementById(id);
}

function clearChildren(node) {
    while (node?.firstChild) node.removeChild(node.firstChild);
}

function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function setInlineMessage(message, tone = 'neutral') {
    inlineMessage = message || '';
    inlineMessageTone = tone;
    renderPricingExperience();
}

function getSelectedPack() {
    return CREDIT_PACKS.find((pack) => pack.id === selectedPackId) || CREDIT_PACKS[1];
}

function idempotencyKey(kind, value) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `pricing-member-live:${kind}:${value}:${random}`;
}

function isSafeCheckoutRedirect(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const url = new URL(value, window.location.href);
        return STRIPE_CHECKOUT_ORIGINS.has(url.origin);
    } catch {
        return false;
    }
}

function renderReturnState(root) {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('checkout');
    if (!state) return;

    const section = document.createElement('section');
    section.className = `pricing-return glass glass-card reveal visible pricing-return--${state === 'success' ? 'success' : 'cancel'}`;
    section.setAttribute('role', 'status');

    if (state === 'success') {
        section.append(
            createTextElement('h2', 'pricing-return__title', t('successful')),
            createTextElement('p', 'pricing-return__copy', t('successCopy')),
        );
        const link = document.createElement('a');
        link.href = localizedHref('/account/credits.html');
        link.className = 'pricing-return__link';
        link.textContent = t('viewCredits');
        section.appendChild(link);
    } else if (state === 'cancel') {
        section.append(
            createTextElement('h2', 'pricing-return__title', t('cancelled')),
            createTextElement('p', 'pricing-return__copy', t('cancelCopy')),
        );
    } else {
        return;
    }
    root.appendChild(section);
}

function createBadge(text, tone = '') {
    const badge = document.createElement('span');
    badge.className = `pricing-badge${tone ? ` pricing-badge--${tone}` : ''}`;
    badge.textContent = text;
    return badge;
}

function createPackCard(pack, auth) {
    const selected = selectedOfferType !== 'subscription' && pack.id === getSelectedPack().id;
    const localizedPack = COPY[LOCALE]?.packs?.[pack.id] || COPY.en.packs[pack.id];
    const card = document.createElement('article');
    card.className = `pricing-card glass glass-card reveal visible${pack.featured ? ' pricing-card--featured' : ''}${selected ? ' pricing-card--selected' : ''}`;
    card.dataset.packId = pack.id;

    const head = document.createElement('div');
    head.className = 'pricing-card__head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'pricing-card__title-wrap';
    titleWrap.append(
        createTextElement('p', 'pricing-card__eyebrow', `${NUMBER_FORMATTER.format(pack.credits)} ${t('creditsLabel')}`),
        createTextElement('h2', 'pricing-card__title', localizedPack.title),
    );
    head.appendChild(titleWrap);
    if (localizedPack.badge) head.appendChild(createBadge(localizedPack.badge, 'featured'));

    const price = document.createElement('div');
    price.className = 'pricing-card__price';
    price.append(
        createTextElement('span', 'pricing-card__price-value', pack.price),
        createTextElement('span', 'pricing-card__cadence', t('oneTime')),
    );

    const description = createTextElement('p', 'pricing-card__copy', localizedPack.description);

    const bestFor = document.createElement('p');
    bestFor.className = 'pricing-card__best-for';
    bestFor.append(
        createTextElement('span', 'pricing-card__best-for-label', t('bestFor')),
        document.createTextNode(localizedPack.bestFor),
    );

    const list = document.createElement('ul');
    list.className = 'pricing-card__list';
    list.setAttribute('aria-label', t('included'));
    const benefits = [
        t('creditBenefit', { credits: NUMBER_FORMATTER.format(pack.credits) }),
        ...localizedPack.benefits,
    ];
    for (const item of benefits) {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pricing-card__cta';
    button.dataset.pricingPack = pack.id;
    button.textContent = auth.loggedIn
        ? (selected ? t('selectedPack') : t('selectPack'))
        : t('loggedOutCta');
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.addEventListener('click', () => {
        selectedOfferType = 'credit-pack';
        selectedPackId = pack.id;
        if (!auth.loggedIn) {
            sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
            sessionStorage.setItem(PENDING_OFFER_KEY, 'credit-pack');
            setInlineMessage(t('loggedOutMessage'), 'info');
            openAuthModal('register', {
                message: t('loggedOutMessage'),
                messageType: 'info',
                target: 'register',
            });
            return;
        }
        sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
        sessionStorage.setItem(PENDING_OFFER_KEY, 'credit-pack');
        setInlineMessage(t('packSelected', { title: localizedPack.title }), 'success');
    });

    card.append(head, price, description, bestFor, list, button);
    return card;
}

function createSubscriptionCard(auth) {
    const selected = selectedOfferType === 'subscription';
    const card = document.createElement('article');
    card.className = `pricing-card glass glass-card reveal visible pricing-card--featured${selected ? ' pricing-card--selected' : ''}`;
    card.dataset.subscriptionPlan = BITBI_MEMBER_SUBSCRIPTION.id;

    const head = document.createElement('div');
    head.className = 'pricing-card__head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'pricing-card__title-wrap';
    titleWrap.append(
        createTextElement('p', 'pricing-card__eyebrow', t('monthly')),
        createTextElement('h2', 'pricing-card__title', 'BITBI Pro'),
    );
    head.append(titleWrap, createBadge('Pro', 'featured'));

    const price = document.createElement('div');
    price.className = 'pricing-card__price';
    price.append(
        createTextElement('span', 'pricing-card__price-value', BITBI_MEMBER_SUBSCRIPTION.displayPrice),
        createTextElement('span', 'pricing-card__cadence', `/ ${LOCALE === 'de' ? 'Monat' : 'month'}`),
    );

    const description = createTextElement('p', 'pricing-card__copy', LOCALE === 'de'
        ? 'Monatliche BITBI Mitgliedschaft mit getrennten Abo-Credits und mehr Assets-Manager-Speicher.'
        : 'Monthly BITBI membership with separate subscription credits and expanded Asset Manager storage.');

    const bestFor = document.createElement('p');
    bestFor.className = 'pricing-card__best-for';
    bestFor.append(
        createTextElement('span', 'pricing-card__best-for-label', t('bestFor')),
        document.createTextNode(t('subscriptionBestFor')),
    );

    const list = document.createElement('ul');
    list.className = 'pricing-card__list';
    list.setAttribute('aria-label', t('included'));
    for (const item of (COPY[LOCALE] || COPY.en).subscriptionBenefits) {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pricing-card__cta';
    button.dataset.subscriptionCheckout = BITBI_MEMBER_SUBSCRIPTION.id;
    button.textContent = auth.loggedIn
        ? (selected ? t('selectedSubscription') : t('subscribe'))
        : t('loggedOutCta');
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.addEventListener('click', () => {
        selectedOfferType = 'subscription';
        sessionStorage.setItem(PENDING_OFFER_KEY, 'subscription');
        if (!auth.loggedIn) {
            setInlineMessage(t('loggedOutMessage'), 'info');
            openAuthModal('register', {
                message: t('loggedOutMessage'),
                messageType: 'info',
                target: 'register',
            });
            return;
        }
        setInlineMessage(t('subscriptionSelected'), 'success');
    });

    card.append(head, price, description, bestFor, list, button);
    return card;
}

function createHero() {
    const hero = document.createElement('section');
    hero.className = 'pricing-hero glass glass-card reveal visible';
    const copy = document.createElement('div');
    copy.className = 'pricing-hero__copy-wrap';
    copy.append(
        createTextElement('p', 'pricing-kicker', t('pricing')),
        createTextElement('h1', 'pricing-hero__title gt-gold-cyan', t('title')),
        createTextElement('p', 'pricing-hero__subtitle', t('subtitle')),
        createTextElement('p', 'pricing-hero__copy', t('heroCopy')),
    );
    const actions = document.createElement('div');
    actions.className = 'pricing-hero__actions';
    const primary = document.createElement('a');
    primary.className = 'pricing-hero__link pricing-hero__link--primary';
    primary.href = '#pricingOffers';
    primary.textContent = t('heroPrimary');
    const secondary = document.createElement('a');
    secondary.className = 'pricing-hero__link';
    secondary.href = '#pricingGuide';
    secondary.textContent = t('heroSecondary');
    actions.append(primary, secondary);
    copy.appendChild(actions);

    const trust = document.createElement('div');
    trust.className = 'pricing-hero__panel';
    trust.setAttribute('aria-label', t('trustNotes'));
    const badgeRow = document.createElement('div');
    badgeRow.className = 'pricing-hero__badges';
    badgeRow.append(
        createBadge((COPY[LOCALE] || COPY.en).trust[0]),
        createBadge((COPY[LOCALE] || COPY.en).trust[1], 'featured'),
        createBadge((COPY[LOCALE] || COPY.en).trust[2]),
    );
    trust.appendChild(badgeRow);
    const stats = document.createElement('dl');
    stats.className = 'pricing-hero__stats';
    for (const [value, label] of (COPY[LOCALE] || COPY.en).heroStats) {
        const item = document.createElement('div');
        item.className = 'pricing-hero__stat';
        item.append(
            createTextElement('dt', 'pricing-hero__stat-value', value),
            createTextElement('dd', 'pricing-hero__stat-label', label),
        );
        stats.appendChild(item);
    }
    const note = createTextElement('p', 'pricing-hero__checkout-note', t('securePayment'));
    const detail = createTextElement('p', 'pricing-hero__host-detail', t('checkoutHostDetail'));
    trust.append(stats, note, detail);
    hero.append(copy, trust);
    return hero;
}

function createInfoSection(title, text, bullets = []) {
    const card = document.createElement('article');
    card.className = 'pricing-info glass glass-card reveal visible';
    card.append(
        createTextElement('h2', 'pricing-section-title', title),
        createTextElement('p', 'pricing-section-copy', text),
    );
    if (bullets.length) {
        const list = document.createElement('ul');
        list.className = 'pricing-info__list';
        for (const item of bullets) {
            const li = document.createElement('li');
            li.textContent = item;
            list.appendChild(li);
        }
        card.appendChild(list);
    }
    return card;
}

function createOffersSection(auth) {
    const section = document.createElement('section');
    section.id = 'pricingOffers';
    section.className = 'pricing-offers-section';
    section.setAttribute('aria-labelledby', 'pricingOffersTitle');

    const head = document.createElement('div');
    head.className = 'pricing-section-head';
    const titleWrap = document.createElement('div');
    titleWrap.append(
        createTextElement('p', 'pricing-kicker', t('creditPacks')),
        createTextElement('h2', 'pricing-section-title', t('offersTitle')),
        createTextElement('p', 'pricing-section-copy', t('offersCopy')),
    );
    titleWrap.querySelector('h2').id = 'pricingOffersTitle';
    head.appendChild(titleWrap);
    section.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'pricing-offers-grid';
    grid.appendChild(createSubscriptionCard(auth));
    for (const pack of CREDIT_PACKS) {
        grid.appendChild(createPackCard(pack, auth));
    }
    section.appendChild(grid);
    return section;
}

function createGuideSection() {
    const section = document.createElement('section');
    section.id = 'pricingGuide';
    section.className = 'pricing-guide-section';
    section.setAttribute('aria-labelledby', 'pricingGuideTitle');

    const head = document.createElement('div');
    head.className = 'pricing-section-head';
    const titleWrap = document.createElement('div');
    const title = createTextElement('h2', 'pricing-section-title', t('guideTitle'));
    title.id = 'pricingGuideTitle';
    titleWrap.append(
        createTextElement('p', 'pricing-kicker', t('trustNotes')),
        title,
        createTextElement('p', 'pricing-section-copy', t('guideCopy')),
    );
    head.appendChild(titleWrap);
    section.appendChild(head);

    const info = document.createElement('div');
    info.className = 'pricing-info-grid';
    info.append(...(COPY[LOCALE] || COPY.en).info.map(([titleText, text, bullets]) => createInfoSection(titleText, text, bullets || [])));
    section.appendChild(info);
    return section;
}

function createFaqSection() {
    const section = document.createElement('section');
    section.className = 'pricing-faq reveal visible';
    section.setAttribute('aria-labelledby', 'pricingFaqTitle');
    section.append(
        createTextElement('p', 'pricing-kicker', t('faqTitle')),
        createTextElement('h2', 'pricing-section-title', t('faqTitle')),
    );
    section.querySelector('h2').id = 'pricingFaqTitle';

    const list = document.createElement('div');
    list.className = 'pricing-faq__list';
    for (const [question, answer] of (COPY[LOCALE] || COPY.en).faqs) {
        const item = document.createElement('article');
        item.className = 'pricing-faq__item';
        item.append(
            createTextElement('h3', 'pricing-faq__question', question),
            createTextElement('p', 'pricing-faq__answer', answer),
        );
        list.appendChild(item);
    }
    section.appendChild(list);
    return section;
}

function createCreditDestination(auth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pricing-org';

    if (!auth.loggedIn) {
        wrapper.appendChild(createTextElement('p', 'pricing-org__state', t('loggedOutDestination')));
        return wrapper;
    }

    wrapper.appendChild(createTextElement('p', 'pricing-org__state', t('memberDestination')));
    return wrapper;
}

function createLegalCheckout(auth) {
    const section = document.createElement('section');
    section.className = 'pricing-legal glass glass-card reveal visible';
    section.setAttribute('aria-labelledby', 'pricingLegalTitle');
    const heading = createTextElement('h2', 'pricing-section-title', t('checkoutRequirements'));
    heading.id = 'pricingLegalTitle';
    section.appendChild(heading);

    const selectedPack = getSelectedPack();
    const summaryText = selectedOfferType === 'subscription'
        ? t('subscriptionSummary')
        : t('selectedSummary', {
            title: (COPY[LOCALE]?.packs?.[selectedPack.id] || COPY.en.packs[selectedPack.id]).title,
            credits: NUMBER_FORMATTER.format(selectedPack.credits),
            price: selectedPack.price,
        });
    const summary = createTextElement('p', 'pricing-section-copy', summaryText);
    section.appendChild(summary);
    section.appendChild(createTextElement('p', 'pricing-legal__host-note', t('securePayment')));

    const checks = document.createElement('div');
    checks.className = 'pricing-legal__checks';

    const termsLabel = document.createElement('label');
    termsLabel.className = 'pricing-legal__check';
    const termsInput = document.createElement('input');
    termsInput.type = 'checkbox';
    termsInput.checked = termsAccepted;
    termsInput.addEventListener('change', () => {
        termsAccepted = termsInput.checked;
        renderPricingExperience();
    });
    const termsText = document.createElement('span');
    termsText.appendChild(document.createTextNode(t('acceptTermsPrefix')));
    const termsLink = document.createElement('a');
    termsLink.href = localizedHref('/legal/terms.html');
    termsLink.target = '_blank';
    termsLink.rel = 'noopener noreferrer';
    termsLink.textContent = t('termsLink');
    termsText.appendChild(termsLink);
    termsText.appendChild(document.createTextNode('.'));
    termsLabel.append(termsInput, termsText);

    const deliveryLabel = document.createElement('label');
    deliveryLabel.className = 'pricing-legal__check';
    const deliveryInput = document.createElement('input');
    deliveryInput.type = 'checkbox';
    deliveryInput.checked = immediateDeliveryAccepted;
    deliveryInput.addEventListener('change', () => {
        immediateDeliveryAccepted = deliveryInput.checked;
        renderPricingExperience();
    });
    deliveryLabel.append(
        deliveryInput,
        createTextElement('span', '', t('deliveryText')),
    );

    checks.append(termsLabel, deliveryLabel);
    section.appendChild(checks);

    if (inlineMessage) {
        const message = createTextElement('p', `pricing-result pricing-result--${inlineMessageTone}`, inlineMessage);
        message.setAttribute('role', inlineMessageTone === 'error' ? 'alert' : 'status');
        section.appendChild(message);
    }

    const actions = document.createElement('div');
    actions.className = 'pricing-legal__actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pricing-card__cta pricing-legal__checkout';
    button.disabled = checkoutBusy;
    button.textContent = checkoutBusy
        ? t('checkoutBusy')
        : (auth.loggedIn ? t('checkout') : t('loggedOutCta'));
    button.addEventListener('click', () => handleCheckout(auth));
    actions.appendChild(button);
    section.appendChild(actions);

    return section;
}

async function handleCheckout(auth) {
    if (checkoutBusy) return;
    if (!auth.loggedIn) {
        sessionStorage.setItem(PENDING_OFFER_KEY, selectedOfferType);
        if (selectedOfferType !== 'subscription') sessionStorage.setItem(PENDING_PACK_KEY, getSelectedPack().id);
        setInlineMessage(t('loginFirst'), 'info');
        openAuthModal('register', {
            message: t('loginFirst'),
            messageType: 'info',
            target: 'register',
        });
        return;
    }
    if (!termsAccepted || !immediateDeliveryAccepted) {
        setInlineMessage(t('legalError'), 'error');
        return;
    }
    checkoutBusy = true;
    renderPricingExperience();
    const acceptedAt = new Date().toISOString();
    const pack = getSelectedPack();
    const response = selectedOfferType === 'subscription'
        ? await apiCreateMemberSubscriptionCheckout({
            idempotencyKey: idempotencyKey('subscription', BITBI_MEMBER_SUBSCRIPTION.id),
            termsAccepted: true,
            termsVersion: TERMS_VERSION,
            immediateDeliveryAccepted: true,
            acceptedAt,
        })
        : await apiCreateMemberLiveCreditPackCheckout({
            packId: pack.id,
            idempotencyKey: idempotencyKey('credit-pack', pack.id),
            termsAccepted: true,
            termsVersion: TERMS_VERSION,
            immediateDeliveryAccepted: true,
            acceptedAt,
        });
    checkoutBusy = false;

    if (!response.ok) {
        setInlineMessage(response.error || t('checkoutFailed'), 'error');
        return;
    }
    const checkoutUrl = response.data?.checkout_url;
    if (!isSafeCheckoutRedirect(checkoutUrl)) {
        setInlineMessage(t('unsafeCheckout'), 'error');
        return;
    }
    sessionStorage.removeItem(PENDING_PACK_KEY);
    sessionStorage.removeItem(PENDING_OFFER_KEY);
    window.location.assign(checkoutUrl);
}

function renderPricingExperience() {
    const root = byId('pricingRoot');
    if (!root) return;
    clearChildren(root);
    const auth = getAuthState();

    const shell = document.createElement('div');
    shell.className = 'pricing-shell';
    renderReturnState(shell);
    shell.appendChild(createHero());
    shell.appendChild(createOffersSection(auth));
    shell.appendChild(createCreditDestination(auth));
    shell.appendChild(createLegalCheckout(auth));
    shell.appendChild(createGuideSection());
    shell.appendChild(createFaqSection());

    root.appendChild(shell);
}

function handleAuthState() {
    const auth = getAuthState();
    const becameLoggedIn = auth.loggedIn && !lastAuthLoggedIn;
    lastAuthLoggedIn = auth.loggedIn;
    if (becameLoggedIn) {
        const pendingOffer = sessionStorage.getItem(PENDING_OFFER_KEY);
        if (pendingOffer === 'subscription') {
            selectedOfferType = 'subscription';
            inlineMessage = t('subscriptionSelected');
            inlineMessageTone = 'success';
        }
        const pendingPack = sessionStorage.getItem(PENDING_PACK_KEY);
        if (pendingPack && CREDIT_PACKS.some((pack) => pack.id === pendingPack)) {
            selectedOfferType = 'credit-pack';
            selectedPackId = pendingPack;
            inlineMessage = t('accountCreated');
            inlineMessageTone = 'success';
        }
    }
    if (!auth.loggedIn) {
        checkoutBusy = false;
    }
    renderPricingExperience();
}

try { initSiteHeader(); } catch (error) { console.warn('siteHeader:', error); }
document.addEventListener('bitbi:auth-change', handleAuthState);
renderPricingExperience();
