/* ============================================================
   BITBI — Admin-gated Pricing / Credit Packs
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';

const PRICING_OPTIONS = Object.freeze([
    Object.freeze({
        id: 'free',
        name: 'Free',
        eyebrow: 'Default account tier',
        price: '0 €',
        cadence: 'Included account allowance',
        badge: 'Current',
        description: 'Registered non-admin accounts currently get 10 successful legacy FLUX.1 Schnell image generations per UTC day.',
        bullets: [
            '10 free image generations per UTC day',
            'FLUX.1 Schnell image generation',
            'Saved asset and profile flows stay unchanged',
            'Does not unlock credit-gated organization AI usage',
        ],
        cta: 'Included by default',
        disabled: true,
    }),
    Object.freeze({
        id: 'live_credits_5000',
        name: '5,000 credits',
        eyebrow: 'One-time credit pack',
        price: '9,99 €',
        cadence: 'Organization credits',
        badge: 'Credits',
        description: 'Adds credits to the selected organization for eligible BITBI AI creation tools and admin-approved usage paths.',
        bullets: [
            '5,000 organization credits',
            'Use through the Credits dashboard',
            'No subscription or recurring charge',
            'Checkout remains gated by backend authorization',
        ],
        cta: 'Open Credits',
        href: '/account/credits.html',
    }),
    Object.freeze({
        id: 'live_credits_12000',
        name: '12,000 credits',
        eyebrow: 'One-time credit pack',
        price: '19,99 €',
        cadence: 'Organization credits',
        badge: 'Best value',
        featured: true,
        description: 'A larger credit pack for eligible organization AI usage when you need more room for creation and testing.',
        bullets: [
            '12,000 organization credits',
            'Lower effective cost per credit',
            'Credits belong to the selected organization',
            'No subscription, invoice, or customer portal',
        ],
        cta: 'Open Credits',
        href: '/account/credits.html',
    }),
]);

let initialized = false;

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

function createAccessStateSection({ stateName, title, copy }) {
    const section = document.createElement('section');
    section.className = 'pricing-access glass glass-card reveal visible';
    if (stateName) section.dataset.pricingAccess = stateName;
    section.append(
        createTextElement('p', 'pricing-kicker', 'Pricing'),
        createTextElement('h1', 'pricing-access__title gt-gold-cyan', title),
        createTextElement('p', 'pricing-access__copy', copy),
    );
    return section;
}

function setRoot(content) {
    const root = byId('pricingRoot');
    if (!root) return;
    clearChildren(root);
    if (content) root.appendChild(content);
}

function renderAccessDenied({ title, copy }) {
    const section = createAccessStateSection({ stateName: 'denied', title, copy });
    const link = document.createElement('a');
    link.className = 'pricing-access__link';
    link.href = '/';
    link.textContent = 'Return to BITBI';
    section.appendChild(link);
    setRoot(section);
}

function renderLoading() {
    setRoot(createAccessStateSection({
        stateName: 'loading',
        title: 'Checking access',
        copy: 'Checking whether this admin-only Pricing page is available.',
    }));
}

function createBadge(text, tone = '') {
    const badge = document.createElement('span');
    badge.className = `pricing-badge${tone ? ` pricing-badge--${tone}` : ''}`;
    badge.textContent = text;
    return badge;
}

function createOptionCard(option) {
    const card = document.createElement('article');
    card.className = `pricing-card glass glass-card reveal visible${option.featured ? ' pricing-card--featured' : ''}`;
    card.dataset.packId = option.id;

    const head = document.createElement('div');
    head.className = 'pricing-card__head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'pricing-card__title-wrap';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'pricing-card__eyebrow';
    eyebrow.textContent = option.eyebrow;
    const title = document.createElement('h2');
    title.className = 'pricing-card__title';
    title.textContent = option.name;
    titleWrap.append(eyebrow, title);
    head.append(titleWrap, createBadge(option.badge, option.featured ? 'featured' : ''));

    const price = document.createElement('div');
    price.className = 'pricing-card__price';
    const priceValue = document.createElement('span');
    priceValue.className = 'pricing-card__price-value';
    priceValue.textContent = option.price;
    const cadence = document.createElement('span');
    cadence.className = 'pricing-card__cadence';
    cadence.textContent = option.cadence;
    price.append(priceValue, cadence);

    const description = document.createElement('p');
    description.className = 'pricing-card__copy';
    description.textContent = option.description;

    const list = document.createElement('ul');
    list.className = 'pricing-card__list';
    for (const item of option.bullets) {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
    }

    const action = option.disabled ? document.createElement('button') : document.createElement('a');
    if (option.disabled) action.type = 'button';
    action.className = `pricing-card__cta${option.disabled ? ' pricing-card__cta--disabled' : ''}`;
    action.textContent = option.cta;
    if (option.disabled) {
        action.disabled = true;
    } else {
        action.href = option.href || '/account/credits.html';
        action.dataset.pricingPack = option.id;
    }

    card.append(head, price, description, list, action);
    return card;
}

function appendFact(list, term, description) {
    const row = document.createElement('div');
    row.append(
        createTextElement('dt', '', term),
        createTextElement('dd', '', description),
    );
    list.appendChild(row);
}

function createCreditsInfoCard() {
    const card = document.createElement('article');
    card.className = 'pricing-info glass glass-card reveal visible';
    card.append(
        createTextElement('h2', 'pricing-section-title', 'How credits work'),
        createTextElement('p', 'pricing-section-copy', 'Credits belong to organizations and are debited only by eligible AI usage paths after successful provider execution. Checkout creation alone does not grant or consume credits.'),
    );
    const facts = document.createElement('dl');
    facts.className = 'pricing-facts';
    appendFact(facts, 'Image', 'Legacy no-org FLUX.1 remains covered by the free daily allowance. Org-scoped paid image generation consumes credits where used.');
    appendFact(facts, 'Text', 'Org-scoped member text generation uses credits and idempotent replay safety.');
    appendFact(facts, 'Access', 'Purchases remain restricted by backend authorization. Eligible users complete checkout from the Credits dashboard.');
    card.appendChild(facts);
    return card;
}

function createFaqItem(summaryText, bodyText, open = false) {
    const details = document.createElement('details');
    if (open) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = summaryText;
    const body = document.createElement('p');
    body.textContent = bodyText;
    details.append(summary, body);
    return details;
}

function createFaqCard() {
    const card = document.createElement('article');
    card.className = 'pricing-info glass glass-card reveal visible';
    card.append(
        createTextElement('h2', 'pricing-section-title', 'FAQ'),
        createFaqItem('What does Free include?', 'Every registered non-admin account currently has 10 successful legacy image generations per UTC day with FLUX.1 Schnell.', true),
        createFaqItem('Do credits unlock every model?', 'No. Credits apply only to implemented org-scoped AI routes. Models that are not technically runnable remain Coming soon.'),
        createFaqItem('Where do I buy credits?', 'Eligible platform admins and active organization owners use the Credits dashboard. This Pricing page is still restricted and does not bypass backend authorization.'),
    );
    return card;
}

function renderPricingExperience() {
    const root = document.createElement('div');
    root.className = 'pricing-shell';

    const hero = document.createElement('section');
    hero.className = 'pricing-hero glass glass-card reveal visible';
    hero.appendChild(createTextElement('p', 'pricing-kicker', 'Pricing'));
    const heroGrid = document.createElement('div');
    heroGrid.className = 'pricing-hero__grid';
    const heroCopy = document.createElement('div');
    heroCopy.append(
        createTextElement('h1', 'pricing-hero__title gt-gold-cyan', 'Credits for BITBI AI'),
        createTextElement('p', 'pricing-hero__copy', 'Credits are the organization-scoped usage units for eligible BITBI AI creation tools. Free image generation remains available, and paid packs are handled through the gated Credits dashboard.'),
    );
    const heroBadges = document.createElement('div');
    heroBadges.className = 'pricing-hero__badges';
    heroBadges.setAttribute('aria-label', 'Pricing status');
    heroBadges.append(
        createBadge('Admin preview', 'featured'),
        createBadge('Organization credits'),
        createBadge('No subscriptions'),
    );
    heroGrid.append(heroCopy, heroBadges);
    hero.appendChild(heroGrid);
    root.appendChild(hero);

    const grid = document.createElement('section');
    grid.className = 'pricing-grid';
    grid.setAttribute('aria-label', 'Pricing options');
    for (const option of PRICING_OPTIONS) {
        grid.appendChild(createOptionCard(option));
    }
    root.appendChild(grid);

    const result = document.createElement('div');
    result.id = 'pricingCheckoutResult';
    result.className = 'pricing-result';
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    result.textContent = 'Paid pack CTAs open the organization-aware Credits dashboard. Backend authorization still controls checkout access.';
    root.appendChild(result);

    const info = document.createElement('section');
    info.className = 'pricing-info-grid';
    info.append(createCreditsInfoCard(), createFaqCard());
    root.appendChild(info);

    setRoot(root);
}

function handleAuthState() {
    const auth = getAuthState();
    if (!auth.ready) {
        renderLoading();
        return;
    }
    if (!auth.loggedIn) {
        renderAccessDenied({
            title: 'Admin access required',
            copy: 'The Pricing page is not public yet. Sign in with an authorized admin account to view the current credit-pack overview.',
        });
        return;
    }
    if (auth.user?.role !== 'admin') {
        renderAccessDenied({
            title: 'Pricing rollout is admin-only',
            copy: 'This Pricing page is currently restricted to platform admins. Eligible organization owners can use the Credits dashboard when available.',
        });
        return;
    }
    if (!initialized) {
        initialized = true;
        renderPricingExperience();
    }
}

try { initSiteHeader(); } catch (error) { console.warn('siteHeader:', error); }
document.addEventListener('bitbi:auth-change', handleAuthState);
handleAuthState();
