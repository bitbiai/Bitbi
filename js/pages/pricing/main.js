/* ============================================================
   BITBI — Public Pricing / Live Credit Packs
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';
import {
    apiCreateMemberLiveCreditPackCheckout,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const TERMS_VERSION = '2026-05-05';
const PENDING_PACK_KEY = 'bitbi_pending_credit_pack';
const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const CREDIT_PACKS = Object.freeze([
    Object.freeze({
        id: 'live_credits_5000',
        title: 'Starter Credits',
        credits: 5000,
        price: '9.99 €',
        description: 'Perfect for first experiments, image generations, and smaller creative sessions.',
        benefits: [
            '5,000 prepaid credits',
            'Use across supported BITBI AI tools',
            'No subscription or renewal',
        ],
    }),
    Object.freeze({
        id: 'live_credits_12000',
        title: 'Creator Credits',
        credits: 12000,
        price: '19.99 €',
        badge: 'Best value',
        featured: true,
        description: 'More room for high-quality images, video tests, music creation, and reference-based workflows.',
        benefits: [
            '12,000 prepaid credits',
            'Best current value per credit',
            'Built for larger creative sessions',
        ],
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
            createTextElement('h2', 'pricing-return__title', 'Payment successful'),
            createTextElement('p', 'pricing-return__copy', 'Your credits will appear shortly after the verified Stripe payment confirmation is processed.'),
        );
        const link = document.createElement('a');
        link.href = '/account/credits.html';
        link.className = 'pricing-return__link';
        link.textContent = 'View credits';
        section.appendChild(link);
    } else if (state === 'cancel') {
        section.append(
            createTextElement('h2', 'pricing-return__title', 'Checkout was cancelled'),
            createTextElement('p', 'pricing-return__copy', 'You have not been charged. You can choose a credit pack whenever you are ready.'),
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
    const card = document.createElement('article');
    card.className = `pricing-card glass glass-card reveal visible${pack.featured ? ' pricing-card--featured' : ''}${selected ? ' pricing-card--selected' : ''}`;
    card.dataset.packId = pack.id;

    const head = document.createElement('div');
    head.className = 'pricing-card__head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'pricing-card__title-wrap';
    titleWrap.append(
        createTextElement('p', 'pricing-card__eyebrow', `${NUMBER_FORMATTER.format(pack.credits)} credits`),
        createTextElement('h2', 'pricing-card__title', pack.title),
    );
    head.appendChild(titleWrap);
    if (pack.badge) head.appendChild(createBadge(pack.badge, 'featured'));

    const price = document.createElement('div');
    price.className = 'pricing-card__price';
    price.append(
        createTextElement('span', 'pricing-card__price-value', pack.price),
        createTextElement('span', 'pricing-card__cadence', 'One-time payment'),
    );

    const description = createTextElement('p', 'pricing-card__copy', pack.description);

    const list = document.createElement('ul');
    list.className = 'pricing-card__list';
    for (const item of pack.benefits) {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pricing-card__cta';
    button.dataset.pricingPack = pack.id;
    button.textContent = auth.loggedIn
        ? (selected ? 'Selected pack' : 'Select pack')
        : 'Create account to buy';
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.addEventListener('click', () => {
        selectedPackId = pack.id;
        if (!auth.loggedIn) {
            sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
            setInlineMessage('Create an account or sign in first. After that, review the terms and continue to checkout.', 'info');
            openAuthModal('register');
            return;
        }
        sessionStorage.setItem(PENDING_PACK_KEY, pack.id);
        setInlineMessage(`${pack.title} selected. Review the legal confirmations below before checkout.`, 'success');
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
        createTextElement('p', 'pricing-kicker', 'Pricing'),
        createTextElement('h1', 'pricing-hero__title gt-gold-cyan', 'BITBI Credits'),
        createTextElement('p', 'pricing-hero__subtitle', 'Create more with flexible prepaid credits.'),
        createTextElement('p', 'pricing-hero__copy', 'Generate images, videos, music, and AI assets without a subscription. Buy credits once and use them across BITBI’s creative tools.'),
    );
    const trust = document.createElement('div');
    trust.className = 'pricing-hero__badges';
    trust.setAttribute('aria-label', 'Pricing trust notes');
    trust.append(
        createBadge('Secure Stripe checkout'),
        createBadge('Credits after successful payment', 'featured'),
        createBadge('No subscription required'),
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
        wrapper.appendChild(createTextElement('p', 'pricing-org__state', 'Create an account or sign in first. Credits will be added to your BITBI member account after verified Stripe payment.'));
        return wrapper;
    }

    wrapper.appendChild(createTextElement('p', 'pricing-org__state', 'Credit destination: your BITBI member account. No organization setup or owner role is required.'));
    return wrapper;
}

function createLegalCheckout(auth) {
    const section = document.createElement('section');
    section.className = 'pricing-legal glass glass-card reveal visible';
    section.setAttribute('aria-labelledby', 'pricingLegalTitle');
    const heading = createTextElement('h2', 'pricing-section-title', 'Checkout requirements');
    heading.id = 'pricingLegalTitle';
    section.appendChild(heading);

    const selectedPack = getSelectedPack();
    const summary = createTextElement(
        'p',
        'pricing-section-copy',
        `Selected pack: ${selectedPack.title} · ${NUMBER_FORMATTER.format(selectedPack.credits)} credits · ${selectedPack.price}. Prices include statutory VAT where applicable.`,
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
    termsText.appendChild(document.createTextNode('Ich akzeptiere die '));
    const termsLink = document.createElement('a');
    termsLink.href = '/legal/terms.html';
    termsLink.target = '_blank';
    termsLink.rel = 'noopener noreferrer';
    termsLink.textContent = 'AGB von BITBI';
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
        createTextElement('span', '', 'Ich verlange die sofortige Bereitstellung der Credits und bestätige, dass mein Widerrufsrecht nach Bereitstellung oder Nutzung der digitalen Credits erlöschen kann, soweit gesetzlich zulässig.'),
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
        ? 'Opening checkout…'
        : (auth.loggedIn ? 'Continue to secure checkout' : 'Create account to buy');
    button.addEventListener('click', () => handleCheckout(auth));
    actions.appendChild(button);
    section.appendChild(actions);

    return section;
}

async function handleCheckout(auth) {
    if (checkoutBusy) return;
    if (!auth.loggedIn) {
        sessionStorage.setItem(PENDING_PACK_KEY, getSelectedPack().id);
        setInlineMessage('Create an account or sign in first. Stripe Checkout starts only after login and legal confirmation.', 'info');
        openAuthModal('register');
        return;
    }
    if (!termsAccepted || !immediateDeliveryAccepted) {
        setInlineMessage('Bitte akzeptiere die AGB und bestätige die sofortige Bereitstellung der digitalen Credits.', 'error');
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
        setInlineMessage(response.error || 'Checkout could not be opened. Please try again.', 'error');
        return;
    }
    const checkoutUrl = response.data?.checkout_url;
    if (!isSafeCheckoutRedirect(checkoutUrl)) {
        setInlineMessage('Checkout response was not a safe Stripe URL. No payment was started.', 'error');
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
    grid.setAttribute('aria-label', 'Credit packs');
    for (const pack of CREDIT_PACKS) {
        grid.appendChild(createPackCard(pack, auth));
    }
    shell.appendChild(grid);
    shell.appendChild(createCreditDestination(auth));
    shell.appendChild(createLegalCheckout(auth));

    const info = document.createElement('section');
    info.className = 'pricing-info-grid';
    info.append(
        createInfoSection('How credits work', 'Credits are prepaid digital usage units. Each AI generation uses credits depending on model, quality, duration, reference images, and compute cost. Buy a pack, generate, save, and publish your creative assets.', [
            'Buy a credit pack once.',
            'Credits are added after successful Stripe payment.',
            'Use credits across supported BITBI AI tools.',
            'Higher quality or reference-heavy generations may use more credits.',
        ]),
        createInfoSection('No subscription', 'Credit packs are not a subscription. There is no monthly lock-in and no automatic renewal. You buy credits when you need them.'),
        createInfoSection('Secure checkout', 'Payments are processed securely by Stripe. BITBI does not store full card details. Stripe may perform payment validation, fraud prevention, and authentication checks.'),
        createInfoSection('Digital credits', 'Credits are digital prepaid usage units. They are not cash, not transferable, not reloadable, not interest-bearing, and not redeemable for money except where required by law.'),
        createInfoSection('AI output responsibility', 'AI results can vary. You are responsible for prompts, uploaded reference material, rights clearance, and how you use or publish generated content.'),
    );
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
            inlineMessage = 'Account created. Please review the terms and continue to checkout.';
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
