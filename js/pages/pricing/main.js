/* ============================================================
   BITBI — Public Pricing / Live Credit Packs
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import {
    apiCreateMemberLiveCreditPackCheckout,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';
import { getCurrentLocale, localizedHref } from '../../shared/locale.js?v=__ASSET_VERSION__';

const TERMS_VERSION = '2026-05-05';
const PENDING_PACK_KEY = 'bitbi_pending_credit_pack';
const LOCALE = getCurrentLocale();
const NUMBER_FORMATTER = new Intl.NumberFormat(LOCALE === 'de' ? 'de-DE' : 'en-US');

const COPY = Object.freeze({
    en: Object.freeze({
        title: 'BITBI Credits',
        loading: 'Loading credit packs.',
        pricing: 'Pricing',
        subtitle: 'Create more with flexible prepaid credits.',
        heroCopy: 'Generate images, videos, music, and AI assets without a subscription. Buy credits once and use them across BITBI’s creative tools.',
        trust: ['Secure Stripe checkout', 'Credits after successful payment', 'No subscription required'],
        successful: 'Payment successful',
        successCopy: 'Your credits will appear shortly after the verified Stripe payment confirmation is processed.',
        viewCredits: 'View credits',
        cancelled: 'Checkout was cancelled',
        cancelCopy: 'You have not been charged. You can choose a credit pack whenever you are ready.',
        oneTime: 'One-time payment',
        loggedOutCta: 'Create account to buy',
        selectedPack: 'Selected pack',
        selectPack: 'Select pack',
        loggedOutMessage: 'Create an account or sign in to buy credits.',
        packSelected: '{title} selected. Review the legal confirmations below before checkout.',
        loggedOutDestination: 'Create an account or sign in first. Credits will be added to your BITBI member account after verified Stripe payment.',
        memberDestination: 'Credit destination: your BITBI member account. No organization setup or owner role is required.',
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
        unsafeCheckout: 'Checkout response was not a safe Stripe URL. No payment was started.',
        accountCreated: 'Account created. Please review the terms and continue to checkout.',
        creditPacks: 'Credit packs',
        creditsLabel: 'credits',
        trustNotes: 'Pricing trust notes',
        packs: Object.freeze({
            live_credits_5000: Object.freeze({
                title: 'Starter Credits',
                description: 'Perfect for first experiments, image generations, and smaller creative sessions.',
                benefits: ['5,000 prepaid credits', 'Use across supported BITBI AI tools', 'No subscription or renewal'],
            }),
            live_credits_12000: Object.freeze({
                title: 'Creator Credits',
                badge: 'Best value',
                description: 'More room for high-quality images, video tests, music creation, and reference-based workflows.',
                benefits: ['12,000 prepaid credits', 'Best current value per credit', 'Built for larger creative sessions'],
            }),
        }),
        info: Object.freeze([
            ['How credits work', 'Credits are prepaid digital usage units. Each AI generation uses credits depending on model, quality, duration, reference images, and compute cost. Buy a pack, generate, save, and publish your creative assets.', ['Buy a credit pack once.', 'Credits are added after successful Stripe payment.', 'Use credits across supported BITBI AI tools.', 'Higher quality or reference-heavy generations may use more credits.']],
            ['No subscription', 'Credit packs are not a subscription. There is no monthly lock-in and no automatic renewal. You buy credits when you need them.'],
            ['Secure checkout', 'Payments are processed securely by Stripe. BITBI does not store full card details. Stripe may perform payment validation, fraud prevention, and authentication checks.'],
            ['Digital credits', 'Credits are digital prepaid usage units. They are not cash, not transferable, not reloadable, not interest-bearing, and not redeemable for money except where required by law.'],
            ['AI output responsibility', 'AI results can vary. You are responsible for prompts, uploaded reference material, rights clearance, and how you use or publish generated content.'],
        ]),
    }),
    de: Object.freeze({
        title: 'BITBI Credits',
        loading: 'Credit-Pakete werden geladen.',
        pricing: 'Preise',
        subtitle: 'Mehr erstellen mit flexiblen Prepaid-Credits.',
        heroCopy: 'Generieren Sie Bilder, Videos, Musik und KI-Assets ohne Abonnement. Kaufen Sie Credits einmalig und nutzen Sie sie in den kreativen BITBI-Werkzeugen.',
        trust: ['Sicherer Stripe-Checkout', 'Credits nach erfolgreicher Zahlung', 'Kein Abonnement erforderlich'],
        successful: 'Zahlung erfolgreich',
        successCopy: 'Ihre Credits erscheinen in Kürze, nachdem die bestätigte Stripe-Zahlung verarbeitet wurde.',
        viewCredits: 'Credits anzeigen',
        cancelled: 'Checkout wurde abgebrochen',
        cancelCopy: 'Ihnen wurde nichts berechnet. Sie können jederzeit ein Credit-Paket auswählen.',
        oneTime: 'Einmalzahlung',
        loggedOutCta: 'Konto erstellen und kaufen',
        selectedPack: 'Paket ausgewählt',
        selectPack: 'Paket auswählen',
        loggedOutMessage: 'Erstelle ein Konto oder melde dich an, um Credits zu kaufen.',
        packSelected: '{title} ausgewählt. Bitte prüfen Sie unten die rechtlichen Bestätigungen vor dem Checkout.',
        loggedOutDestination: 'Erstellen Sie zuerst ein Konto oder melden Sie sich an. Die Credits werden nach bestätigter Stripe-Zahlung Ihrem BITBI-Mitgliedskonto gutgeschrieben.',
        memberDestination: 'Credit-Ziel: Ihr BITBI-Mitgliedskonto. Keine Organisationseinrichtung und keine Owner-Rolle erforderlich.',
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
        unsafeCheckout: 'Die Checkout-Antwort war keine sichere Stripe-URL. Es wurde keine Zahlung gestartet.',
        accountCreated: 'Konto erstellt. Bitte prüfen Sie die Bedingungen und fahren Sie mit dem Checkout fort.',
        creditPacks: 'Credit-Pakete',
        creditsLabel: 'Credits',
        trustNotes: 'Vertrauenshinweise zu Preisen',
        packs: Object.freeze({
            live_credits_5000: Object.freeze({
                title: 'Starter Credits',
                description: 'Ideal für erste Experimente, Bildgenerierungen und kleinere Kreativ-Sessions.',
                benefits: ['5.000 Prepaid-Credits', 'Für unterstützte BITBI-KI-Werkzeuge nutzbar', 'Kein Abo und keine Verlängerung'],
            }),
            live_credits_12000: Object.freeze({
                title: 'Creator Credits',
                badge: 'Bester Wert',
                description: 'Mehr Spielraum für hochwertige Bilder, Video-Tests, Musik und referenzbasierte Workflows.',
                benefits: ['12.000 Prepaid-Credits', 'Aktuell bester Gegenwert pro Credit', 'Für größere Kreativ-Sessions ausgelegt'],
            }),
        }),
        info: Object.freeze([
            ['So funktionieren Credits', 'Credits sind vorausbezahlte digitale Nutzungseinheiten. Jede KI-Generierung verbraucht Credits abhängig von Modell, Qualität, Dauer, Referenzbildern und Rechenaufwand. Kaufen Sie ein Paket, generieren, speichern und veröffentlichen Sie Ihre kreativen Assets.', ['Credit-Paket einmalig kaufen.', 'Credits werden nach erfolgreicher Stripe-Zahlung gutgeschrieben.', 'Credits in unterstützten BITBI-KI-Werkzeugen nutzen.', 'Höhere Qualität oder referenzintensive Generierungen können mehr Credits verbrauchen.']],
            ['Kein Abonnement', 'Credit-Pakete sind kein Abonnement. Es gibt keine monatliche Bindung und keine automatische Verlängerung. Sie kaufen Credits, wenn Sie sie benötigen.'],
            ['Sicherer Checkout', 'Zahlungen werden sicher über Stripe verarbeitet. BITBI speichert keine vollständigen Kartendaten. Stripe kann Zahlungsvalidierung, Betrugsprävention und Authentifizierungsprüfungen durchführen.'],
            ['Digitale Credits', 'Credits sind digitale vorausbezahlte Nutzungseinheiten. Sie sind kein Bargeld, nicht übertragbar, nicht wiederaufladbar, nicht verzinslich und nicht gegen Geld einlösbar, außer soweit gesetzlich vorgeschrieben.'],
            ['Verantwortung für KI-Ergebnisse', 'KI-Ergebnisse können variieren. Sie sind verantwortlich für Prompts, hochgeladenes Referenzmaterial, Rechteklärung und die Nutzung oder Veröffentlichung generierter Inhalte.'],
        ]),
    }),
});

function t(key, values = {}) {
    const copy = COPY[LOCALE] || COPY.en;
    const value = copy[key] ?? COPY.en[key] ?? key;
    return String(value).replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? '');
}

const CREDIT_PACKS = Object.freeze([
    Object.freeze({
        id: 'live_credits_5000',
        credits: 5000,
        price: '9.99 €',
    }),
    Object.freeze({
        id: 'live_credits_12000',
        credits: 12000,
        price: '19.99 €',
        featured: true,
    }),
]);

let selectedPackId = sessionStorage.getItem(PENDING_PACK_KEY) || 'live_credits_12000';
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

function idempotencyKey(packId) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `pricing-member-live:${packId}:${random}`;
}

function isSafeCheckoutRedirect(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const url = new URL(value, window.location.href);
        return url.origin === 'https://checkout.stripe.com';
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
    const selected = pack.id === getSelectedPack().id;
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

    const list = document.createElement('ul');
    list.className = 'pricing-card__list';
    for (const item of localizedPack.benefits) {
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
        selectedPackId = pack.id;
        if (!auth.loggedIn) {
            sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
            setInlineMessage(t('loggedOutMessage'), 'info');
            openAuthModal('register', {
                message: t('loggedOutMessage'),
                messageType: 'info',
                target: 'register',
            });
            return;
        }
        sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
        setInlineMessage(t('packSelected', { title: localizedPack.title }), 'success');
    });

    card.append(head, price, description, list, button);
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
    const trust = document.createElement('div');
    trust.className = 'pricing-hero__badges';
    trust.setAttribute('aria-label', t('trustNotes'));
    trust.append(
        createBadge((COPY[LOCALE] || COPY.en).trust[0]),
        createBadge((COPY[LOCALE] || COPY.en).trust[1], 'featured'),
        createBadge((COPY[LOCALE] || COPY.en).trust[2]),
    );
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
    const summary = createTextElement(
        'p',
        'pricing-section-copy',
        t('selectedSummary', {
            title: (COPY[LOCALE]?.packs?.[selectedPack.id] || COPY.en.packs[selectedPack.id]).title,
            credits: NUMBER_FORMATTER.format(selectedPack.credits),
            price: selectedPack.price,
        }),
    );
    section.appendChild(summary);

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
        sessionStorage.setItem(PENDING_PACK_KEY, getSelectedPack().id);
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
    const response = await apiCreateMemberLiveCreditPackCheckout({
        packId: pack.id,
        idempotencyKey: idempotencyKey(pack.id),
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

    const grid = document.createElement('section');
    grid.className = 'pricing-grid';
    grid.setAttribute('aria-label', t('creditPacks'));
    for (const pack of CREDIT_PACKS) {
        grid.appendChild(createPackCard(pack, auth));
    }
    shell.appendChild(grid);
    shell.appendChild(createCreditDestination(auth));
    shell.appendChild(createLegalCheckout(auth));

    const info = document.createElement('section');
    info.className = 'pricing-info-grid';
    info.append(...(COPY[LOCALE] || COPY.en).info.map(([title, text, bullets]) => createInfoSection(title, text, bullets || [])));
    shell.appendChild(info);

    root.appendChild(shell);
}

function handleAuthState() {
    const auth = getAuthState();
    const becameLoggedIn = auth.loggedIn && !lastAuthLoggedIn;
    lastAuthLoggedIn = auth.loggedIn;
    if (becameLoggedIn) {
        const pendingPack = sessionStorage.getItem(PENDING_PACK_KEY);
        if (pendingPack && CREDIT_PACKS.some((pack) => pack.id === pendingPack)) {
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
