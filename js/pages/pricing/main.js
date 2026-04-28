/* ============================================================
   BITBI — Admin-gated Pricing / Credit Packs
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { getAuthState } from '../../shared/auth-state.js';
import {
    apiCreateCreditPackCheckout,
    apiListOrganizations,
    apiOrganizationBilling,
} from '../../shared/auth-api.js';

const PRICING_OPTIONS = Object.freeze([
    Object.freeze({
        id: 'free',
        name: 'Free',
        eyebrow: 'Default account tier',
        price: '€0',
        cadence: 'No checkout required',
        badge: 'Current',
        description: 'Registered non-admin accounts currently get 10 successful legacy FLUX.1 Schnell image generations per UTC day.',
        bullets: [
            '10 free image generations per UTC day',
            'FLUX.1 Schnell image generation',
            'Saved asset and profile flows stay unchanged',
            'Does not unlock credit-gated org AI usage',
        ],
        cta: 'Included by default',
        disabled: true,
    }),
    Object.freeze({
        id: 'credits_5000',
        name: 'Buy 5000 Credits',
        eyebrow: 'One-time Testmode credit pack',
        price: '€49',
        cadence: 'Stripe Testmode checkout',
        badge: 'Credits',
        description: 'Adds credits to the selected organization for eligible org-scoped AI generation routes.',
        bullets: [
            '5000 organization credits',
            'Use for eligible credit-gated AI features',
            'Credits grant only after verified Testmode webhook completion',
            'No subscription, invoice, or live billing activation',
        ],
        cta: 'Continue to Checkout',
    }),
    Object.freeze({
        id: 'credits_10000',
        name: 'Buy 10000 Credits',
        eyebrow: 'One-time Testmode credit pack',
        price: '€89',
        cadence: 'Stripe Testmode checkout',
        badge: 'Higher volume',
        featured: true,
        description: 'A larger Testmode pack for validating org credit balances and paid usage paths at realistic volume.',
        bullets: [
            '10000 organization credits',
            'Better fit for repeated staging validation',
            'Same exact-once webhook grant safeguards',
            'Live Stripe remains disabled',
        ],
        cta: 'Continue to Checkout',
    }),
]);

const ELIGIBLE_ROLES = new Set(['owner', 'admin']);

let initialized = false;
let state = {
    organizations: [],
    eligibleOrganizations: [],
    selectedOrganizationId: '',
    loadingCheckout: false,
};

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

function formatCredits(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Not reported';
    return new Intl.NumberFormat('en-US').format(number);
}

function formatMoney(cents, currency = 'EUR') {
    const amount = Number(cents) / 100;
    if (!Number.isFinite(amount)) return 'Testmode price';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(amount);
}

function checkoutStateFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const value = String(params.get('checkout') || params.get('status') || '').toLowerCase();
    if (['success', 'completed', 'complete'].includes(value)) return 'success';
    if (['cancel', 'canceled', 'cancelled'].includes(value)) return 'cancel';
    return '';
}

function createIdempotencyKey(packId, organizationId) {
    const safePack = String(packId || 'pack').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'pack';
    const safeOrg = String(organizationId || 'org').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'org';
    const random = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `pricing:${safePack}:${safeOrg}:${random}`;
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
        copy: 'This controlled Testmode rollout is currently visible to authenticated admins only.',
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

    const action = document.createElement('button');
    action.type = 'button';
    action.className = `pricing-card__cta${option.disabled ? ' pricing-card__cta--disabled' : ''}`;
    action.textContent = option.cta;
    action.disabled = !!option.disabled;
    if (!option.disabled) {
        action.dataset.checkoutPack = option.id;
    }

    card.append(head, price, description, list, action);
    return card;
}

function renderCheckoutNotice() {
    const checkoutState = checkoutStateFromUrl();
    if (!checkoutState) return null;
    const notice = document.createElement('section');
    notice.className = `pricing-return pricing-return--${checkoutState} glass glass-card reveal visible`;
    notice.setAttribute('role', 'status');
    const title = document.createElement('h2');
    title.className = 'pricing-return__title';
    const copy = document.createElement('p');
    copy.className = 'pricing-return__copy';
    if (checkoutState === 'success') {
        title.textContent = 'Checkout returned successfully';
        copy.textContent = 'If the Stripe Testmode webhook completed, credits will appear on the selected organization after backend processing. Refresh the balance below if needed.';
    } else {
        title.textContent = 'Checkout cancelled';
        copy.textContent = 'No credits were granted. You can choose a pack and restart Testmode checkout when ready.';
    }
    notice.append(title, copy);
    return notice;
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
        createTextElement('p', 'pricing-section-copy', 'Credits are debited only by eligible org-scoped AI generation routes after successful provider execution. Failed provider calls and checkout-session creation do not grant or consume credits.'),
    );
    const facts = document.createElement('dl');
    facts.className = 'pricing-facts';
    appendFact(facts, 'Image', 'Legacy no-org FLUX.1 remains covered by the free daily allowance. Org-scoped paid image generation consumes credits where used.');
    appendFact(facts, 'Text', 'Org-scoped member text generation uses credits and idempotent replay safety.');
    appendFact(facts, 'Video/Music', 'Member-facing paid video/music generation is not wired yet. Those Models entries remain Coming soon.');
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
        createFaqItem('Is this live billing?', 'No. This page uses the existing Stripe Testmode foundation. Live Stripe, subscriptions, invoices, and customer portal remain disabled.'),
    );
    return card;
}

function renderOrganizationControls(container) {
    const wrap = document.createElement('section');
    wrap.className = 'pricing-org glass glass-card reveal visible';

    const title = document.createElement('h2');
    title.className = 'pricing-section-title';
    title.textContent = 'Checkout organization';

    const copy = document.createElement('p');
    copy.className = 'pricing-section-copy';
    copy.textContent = 'Credit packs are organization-scoped. This controlled rollout requires a platform admin account that is also an active organization owner/admin.';

    const formRow = document.createElement('div');
    formRow.className = 'pricing-org__row';

    const label = document.createElement('label');
    label.className = 'pricing-org__field';
    const labelText = document.createElement('span');
    labelText.textContent = 'Organization';
    const select = document.createElement('select');
    select.id = 'pricingOrgSelect';
    select.className = 'pricing-org__select';
    select.disabled = state.eligibleOrganizations.length === 0;

    if (state.eligibleOrganizations.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No owner/admin organization available';
        option.value = '';
        select.appendChild(option);
    } else {
        for (const organization of state.eligibleOrganizations) {
            const option = document.createElement('option');
            option.value = organization.id;
            option.textContent = `${organization.name || organization.slug || organization.id} (${organization.role})`;
            select.appendChild(option);
        }
        select.value = state.selectedOrganizationId || state.eligibleOrganizations[0].id;
        state.selectedOrganizationId = select.value;
    }

    label.append(labelText, select);
    formRow.appendChild(label);

    const billing = document.createElement('div');
    billing.id = 'pricingBillingState';
    billing.className = 'pricing-org__state';
    billing.textContent = state.eligibleOrganizations.length > 0
        ? 'Loading credit balance...'
        : 'Assign this platform admin as organization owner/admin before creating Testmode checkout sessions.';

    wrap.append(title, copy, formRow, billing);
    container.appendChild(wrap);

    select.addEventListener('change', () => {
        state.selectedOrganizationId = select.value;
        refreshBillingState();
    });
}

function setCheckoutButtonsDisabled(disabled) {
    document.querySelectorAll('[data-checkout-pack]').forEach((button) => {
        button.disabled = disabled || state.eligibleOrganizations.length === 0;
        button.classList.toggle('pricing-card__cta--disabled', button.disabled);
    });
}

async function refreshBillingState() {
    const target = byId('pricingBillingState');
    const orgId = state.selectedOrganizationId;
    if (!target || !orgId) return;
    target.textContent = 'Loading credit balance...';
    const res = await apiOrganizationBilling(orgId);
    if (!res.ok) {
        target.textContent = res.status === 403
            ? 'Billing detail requires owner/admin organization role.'
            : `Billing state unavailable: ${res.error || 'Not reported'}`;
        return;
    }
    const billing = res.data?.billing || {};
    const balance = formatCredits(billing.creditBalance);
    const plan = billing.plan?.name || billing.plan?.code || 'Free';
    target.textContent = `Current balance: ${balance} credits · Plan: ${plan} · Live billing disabled`;
}

async function handleCheckoutClick(event) {
    const button = event.target.closest('[data-checkout-pack]');
    if (!button) return;
    const packId = button.dataset.checkoutPack;
    const orgId = state.selectedOrganizationId;
    const result = byId('pricingCheckoutResult');
    if (!packId || !orgId) {
        if (result) result.textContent = 'Choose an eligible owner/admin organization before checkout.';
        return;
    }

    state.loadingCheckout = true;
    setCheckoutButtonsDisabled(true);
    if (result) result.textContent = 'Creating Stripe Testmode checkout session...';

    const res = await apiCreateCreditPackCheckout(orgId, {
        packId,
        idempotencyKey: createIdempotencyKey(packId, orgId),
    });

    if (!res.ok) {
        state.loadingCheckout = false;
        setCheckoutButtonsDisabled(false);
        if (result) {
            const suffix = res.code ? ` (${res.code})` : '';
            const operatorHint = res.code === 'stripe_admin_test_checkout_disabled'
                ? ' Ask an operator to enable admin Stripe Testmode checkout for the canary window.'
                : '';
            result.textContent = `Checkout unavailable: ${res.error || 'Request failed'}${suffix}.${operatorHint}`;
        }
        return;
    }

    const checkoutUrl = res.data?.checkout_url;
    if (typeof checkoutUrl !== 'string' || !checkoutUrl) {
        state.loadingCheckout = false;
        setCheckoutButtonsDisabled(false);
        if (result) result.textContent = 'Checkout response did not include a redirect URL.';
        return;
    }

    if (result) {
        const pack = res.data?.credit_pack;
        const amount = pack?.amountCents ? formatMoney(pack.amountCents, pack.currency || 'EUR') : 'Testmode';
        result.textContent = `Redirecting to Stripe Testmode checkout for ${pack?.credits || 'selected'} credits (${amount}).`;
    }
    window.location.assign(checkoutUrl);
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
        createTextElement('h1', 'pricing-hero__title gt-gold-cyan', 'Credits for BITBI AI workflows.'),
        createTextElement('p', 'pricing-hero__copy', 'A controlled admin-only rollout for Stripe Testmode credit packs. Free image generation remains available; paid credits are for eligible org-scoped AI routes that are actually implemented.'),
    );
    const heroBadges = document.createElement('div');
    heroBadges.className = 'pricing-hero__badges';
    heroBadges.setAttribute('aria-label', 'Rollout status');
    heroBadges.append(
        createBadge('Internal/Test rollout', 'featured'),
        createBadge('Stripe Testmode only'),
        createBadge('Live billing disabled', 'blocked'),
    );
    heroGrid.append(heroCopy, heroBadges);
    hero.appendChild(heroGrid);
    root.appendChild(hero);

    const notice = renderCheckoutNotice();
    if (notice) root.appendChild(notice);

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
    root.appendChild(result);

    renderOrganizationControls(root);

    const info = document.createElement('section');
    info.className = 'pricing-info-grid';
    info.append(createCreditsInfoCard(), createFaqCard());
    root.appendChild(info);

    setRoot(root);
    setCheckoutButtonsDisabled(state.eligibleOrganizations.length === 0);
    root.addEventListener('click', handleCheckoutClick);
    refreshBillingState();
}

async function loadOrganizationsAndRender() {
    const root = byId('pricingRoot');
    if (root) {
        clearChildren(root);
        root.appendChild(createAccessStateSection({
            title: 'Loading checkout context',
            copy: 'Checking eligible owner/admin organizations for this admin account.',
        }));
    }
    const res = await apiListOrganizations({ limit: 100 });
    if (!res.ok) {
        renderAccessDenied({
            title: 'Pricing unavailable',
            copy: `Organization context could not be loaded: ${res.error || 'Not reported'}`,
        });
        return;
    }
    state.organizations = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
    state.eligibleOrganizations = state.organizations.filter((org) => (
        org?.status === 'active' && ELIGIBLE_ROLES.has(String(org.role || '').toLowerCase())
    ));
    state.selectedOrganizationId = state.eligibleOrganizations[0]?.id || '';
    renderPricingExperience();
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
            copy: 'The Pricing rollout is not public yet. Sign in with an admin account to view Testmode credit packs.',
        });
        return;
    }
    if (auth.user?.role !== 'admin') {
        renderAccessDenied({
            title: 'Pricing rollout is admin-only',
            copy: 'Credit-pack checkout is in controlled Testmode rollout and is not visible to non-admin accounts yet.',
        });
        return;
    }
    if (!initialized) {
        initialized = true;
        loadOrganizationsAndRender();
    }
}

try { initSiteHeader(); } catch (error) { console.warn('siteHeader:', error); }
document.addEventListener('bitbi:auth-change', handleAuthState);
handleAuthState();
