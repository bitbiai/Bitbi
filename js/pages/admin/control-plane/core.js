export const CONTROL_SECTIONS = new Set([
    'dashboard',
    'security',
    'orgs',
    'billing',
    'billing-events',
    'ai-usage',
    'ai-budget-switches',
    'lifecycle',
    'operations',
    'tenant-assets',
    'readiness',
    'settings',
]);

export const FEATURE_BADGES = {
    'ai.image.generate': ['AI Image', 'user'],
    'ai.text.generate': ['AI Text', 'user'],
    'ai.video.generate': ['AI Video', 'legacy'],
};

const STATUS_VARIANTS = {
    active: 'active',
    succeeded: 'active',
    finalized: 'active',
    completed: 'active',
    granted: 'active',
    planned: 'legacy',
    received: 'user',
    ignored: 'legacy',
    pending: 'legacy',
    reserved: 'legacy',
    failed: 'disabled',
    disabled: 'disabled',
    expired: 'disabled',
};

export const TENANT_REVIEW_STATUSES = [
    'pending_review',
    'review_in_progress',
    'approved_personal_user_asset',
    'approved_organization_asset',
    'approved_legacy_unclassified',
    'approved_platform_admin_test_asset',
    'blocked_public_unsafe',
    'blocked_derivative_risk',
    'blocked_relationship_conflict',
    'blocked_missing_evidence',
    'needs_legal_privacy_review',
    'deferred',
    'rejected',
    'superseded',
];

const TENANT_REVIEW_STATUS_TRANSITIONS = {
    pending_review: ['review_in_progress', 'deferred', 'rejected', 'needs_legal_privacy_review'],
    review_in_progress: [
        'approved_personal_user_asset',
        'approved_organization_asset',
        'approved_legacy_unclassified',
        'approved_platform_admin_test_asset',
        'blocked_public_unsafe',
        'blocked_derivative_risk',
        'blocked_relationship_conflict',
        'blocked_missing_evidence',
        'deferred',
        'rejected',
        'needs_legal_privacy_review',
    ],
    deferred: ['pending_review'],
    needs_legal_privacy_review: ['review_in_progress'],
    approved_personal_user_asset: ['superseded'],
    approved_organization_asset: ['superseded'],
    approved_legacy_unclassified: ['superseded'],
    approved_platform_admin_test_asset: ['superseded'],
    blocked_public_unsafe: ['superseded'],
    blocked_derivative_risk: ['superseded'],
    blocked_relationship_conflict: ['superseded'],
    blocked_missing_evidence: ['superseded'],
    rejected: ['superseded'],
    superseded: [],
};

export const TENANT_REVIEW_SUPERSEDE_CONFIRMATION = 'SUPERSEDE STALE REVIEW ITEMS';
export const CURRENT_AUTH_SCHEMA_CHECKPOINT = '0060_add_app_settings.sql';

const SENSITIVE_KEY_PATTERN = /secret|token|password|hash|signature|raw|payload|request_?fingerprint|idempotency|r2_?key|private_?key|mfa|recovery|webhook_?secret|stripe_?secret|service_?auth|card|payment_?method|credential|authorization|cookie|session/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:sk_(?:live|test)|rk_(?:live|test)|whsec|Bearer\s+|Stripe-Signature|authorization=|secret=|token=|password=|pm_[A-Za-z0-9]|card=)[A-Za-z0-9_:=+./-]*/i;

export function byId(id) {
    return document.getElementById(id);
}

export function clear(node) {
    if (node) node.replaceChildren();
}

export function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text == null || text === '' ? '-' : String(text)));
}

export function notReported(value) {
    return value == null || value === '' ? 'Not reported' : value;
}

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) appendText(node, text);
    return node;
}

export function badge(label, variant = 'user') {
    const span = el('span', `badge badge--${variant}`);
    span.textContent = label || '-';
    return span;
}

export function variantFor(value) {
    return STATUS_VARIANTS[String(value || '').toLowerCase()] || 'user';
}

export function readableToken(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    return text.replace(/_/g, ' ');
}

export function tenantReviewStatusVariant(value) {
    const status = String(value || '').toLowerCase();
    if (status.startsWith('approved_')) return 'active';
    if (status.startsWith('blocked_') || status === 'rejected') return 'disabled';
    if (status === 'review_in_progress' || status === 'needs_legal_privacy_review') return 'legacy';
    if (status === 'superseded') return 'legacy';
    if (status === 'deferred') return 'user';
    return 'user';
}

export function allowedTenantReviewTransitions(status) {
    return TENANT_REVIEW_STATUS_TRANSITIONS[String(status || '')] || [];
}

export function shortId(value) {
    const text = String(value || '');
    if (!text) return '-';
    if (text.length <= 18) return text;
    return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

export function isSensitiveKey(key) {
    return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

export function safeSummaryValue(value) {
    if (value == null || value === '') return 'Not reported';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'Not reported';
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '[object summary]';
    const text = String(value);
    if (SENSITIVE_VALUE_PATTERN.test(text)) return '[redacted]';
    return text;
}

export function effectiveSwitchVariant(value) {
    if (value === true || value === 'enabled') return 'active';
    if (value === false || value === 'disabled' || value === 'missing' || value === 'unavailable') return 'disabled';
    return 'legacy';
}

export function createIdempotencyKey(prefix) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${Date.now().toString(36)}-${token}`;
}

export function setState(id, message, type = 'neutral') {
    const node = byId(id);
    if (!node) return;
    node.textContent = message || '';
    node.dataset.state = type;
}

export function apiUnavailableMessage(response, fallback) {
    if (!response) return fallback;
    if (response.status === 404) return 'Capability unavailable in this environment.';
    if (response.status === 429) return 'Rate limit reached. Try again later.';
    if (response.status === 503) return 'Backend dependency is unavailable or fail-closed.';
    if (response.status === 401 || response.status === 403) return 'Admin access or MFA is required.';
    return response.error || fallback;
}

export function capabilityStatus(response) {
    if (response?.ok) return { label: 'API available', variant: 'active' };
    if (response?.status === 404) return { label: 'Unavailable', variant: 'legacy' };
    if (response?.status === 429) return { label: 'Rate limited', variant: 'disabled' };
    if (response?.status === 503) return { label: 'Fail-closed', variant: 'disabled' };
    if (response?.status === 401 || response?.status === 403) return { label: 'Admin gated', variant: 'disabled' };
    return { label: 'Unknown', variant: 'legacy' };
}

export function setSubmitting(button, submitting) {
    if (!button) return;
    button.disabled = !!submitting;
    button.dataset.busy = submitting ? 'true' : 'false';
}

export function renderUnavailable(container, response, fallback = 'This capability is unavailable.') {
    if (!container) return;
    clear(container);
    const box = el('div', 'admin-shell__empty');
    const icon = el('span', 'admin-shell__empty-icon', '!');
    const copy = el('span', null, apiUnavailableMessage(response, fallback));
    box.append(icon, copy);
    container.appendChild(box);
}

export function row(name, value, valueClass = 'admin-inventory__meta') {
    const item = el('div', 'admin-inventory__row');
    item.append(el('span', 'admin-inventory__name', name));
    const meta = el('span', valueClass);
    if (value instanceof Node) meta.appendChild(value);
    else appendText(meta, value);
    item.appendChild(meta);
    return item;
}

export function detailRows(entries) {
    const list = el('div', 'admin-inventory');
    for (const [name, value] of entries) list.appendChild(row(name, value));
    return list;
}

export function table(headers) {
    const wrap = el('div', 'admin-table-wrap');
    const tbl = el('table', 'admin-table');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const header of headers) tr.appendChild(el('th', null, header));
    thead.appendChild(tr);
    tbl.appendChild(thead);
    tbl.appendChild(document.createElement('tbody'));
    wrap.appendChild(tbl);
    return { wrap, tbody: tbl.querySelector('tbody') };
}

export function addCell(tr, value) {
    const td = document.createElement('td');
    if (value instanceof Node) td.appendChild(value);
    else appendText(td, value);
    tr.appendChild(td);
    return td;
}

export function renderJsonSummary(value) {
    if (!value || typeof value !== 'object') return '-';
    const safeEntries = Object.entries(value).filter(([key]) => !isSensitiveKey(key));
    if (safeEntries.length === 0) return '-';
    return safeEntries
        .slice(0, 10)
        .map(([key, val]) => `${key}: ${safeSummaryValue(val)}`)
        .join(', ');
}

export function renderCards(container, cards) {
    clear(container);
    const grid = el('div', 'admin-control-grid');
    for (const card of cards) {
        const item = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        const title = el('h3', 'admin-section-title', card.title);
        top.appendChild(title);
        if (card.badge) top.appendChild(badge(card.badge.label, card.badge.variant));
        item.appendChild(top);
        item.appendChild(el('p', 'admin-shell__desc', card.copy));
        if (card.meta) item.appendChild(detailRows(card.meta));
        if (card.href) {
            const link = el('a', 'btn-action', card.cta || 'Open');
            link.href = card.href;
            item.appendChild(link);
        }
        grid.appendChild(item);
    }
    container.appendChild(grid);
}

export function operatorGuidancePanel({ eyebrow, title = 'Next Safe Action', copy, badges = [], items = [] } = {}) {
    const panel = el('section', 'admin-operator-guidance glass glass-card reveal visible');
    const header = el('div', 'admin-operator-guidance__header');
    const text = el('div');
    if (eyebrow) text.append(el('p', 'admin-operator-guidance__eyebrow', eyebrow));
    text.append(el('h3', 'admin-section-title', title));
    if (copy) text.append(el('p', 'admin-shell__desc', copy));
    header.appendChild(text);
    if (badges.length) {
        const badgeRow = el('div', 'admin-control-toolbar__badges');
        for (const item of badges) badgeRow.appendChild(badge(item.label, item.variant));
        header.appendChild(badgeRow);
    }
    panel.appendChild(header);
    if (items.length) {
        const grid = el('div', 'admin-operator-guidance__grid');
        for (const item of items) {
            const row = el('div', 'admin-operator-guidance__item');
            if (item.badge) row.appendChild(badge(item.badge.label, item.badge.variant));
            row.append(el('strong', null, item.title), el('span', null, item.copy));
            grid.appendChild(row);
        }
        panel.appendChild(grid);
    }
    return panel;
}

export async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.insetInlineStart = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        return true;
    } catch {
        return false;
    }
}

export async function capabilityProbe(label, call) {
    const result = await call();
    const status = capabilityStatus(result);
    return {
        label,
        ok: result.ok,
        status: status.label,
        variant: status.variant,
    };
}
