import { apiAdminStats } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const STATS_TTL = 30_000;
const STAT_IDS = ['statTotal', 'statActive', 'statAdmins', 'statVerified', 'statDisabled', 'statRecent'];

const ADMIN_OPERATOR_LOCALE = 'en-GB';

const OWNER_ACTION_BUCKETS = Object.freeze([
    {
        title: 'Safe review now',
        badge: 'Read-only',
        badgeClass: 'badge--user',
        description: 'Start here for current state, evidence, and operator context without first-click mutations.',
        links: [
            { label: 'Operations', href: '#operations' },
            { label: 'Billing Evidence', href: '#billing-events' },
            { label: 'Live Billing', href: '#live-billing' },
            { label: 'R2 Drive', href: '#object-storage' },
            { label: 'Speicher-Integrität', href: '#tenant-assets' },
            { label: 'News Feed Agent', href: '#news-feed-agent' },
            { label: 'Hero Videos', href: '#homepage-hero-videos' },
            { label: 'AI Usage', href: '#ai-usage' },
            { label: 'Budget Switches', href: '#ai-budget-switches' },
        ],
    },
    {
        title: 'Blocked until evidence',
        badge: 'Evidence required',
        badgeClass: 'badge--disabled',
        description: 'These claims stay blocked until live operator proof exists; repo-local checks do not approve them.',
        links: [
            { label: 'Production readiness blocked', href: '#operations' },
            { label: 'Live billing readiness blocked', href: '#billing-events' },
            { label: 'Tenant isolation and access-switch unclaimed', href: '#tenant-assets' },
            { label: 'Ownership backfill unclaimed', href: '#tenant-assets' },
            { label: 'Confirmed legacy media reset blocked', href: '#tenant-assets' },
        ],
    },
    {
        title: 'Guarded actions',
        badge: 'Admin/MFA',
        badgeClass: 'badge--legacy',
        description: 'Use these after review; mutation routes require admin/MFA, reasons, idempotency, and exact confirmations.',
        links: [
            { label: 'Billing repair and reconciliation', href: '#billing-events' },
            { label: 'Data Lifecycle safe execution', href: '#lifecycle' },
            { label: 'Tenant advanced diagnostics', href: '#tenant-assets' },
            { label: 'Budget switch and cap updates', href: '#ai-budget-switches' },
            { label: 'Irreversible News Pulse cleanup', href: '#news-feed-agent' },
        ],
    },
]);

const statsTimeFormatter = new Intl.DateTimeFormat(ADMIN_OPERATOR_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

function renderStats(stats, updatedEl, fetchedAt) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val ?? '\u2014';
    };
    setVal('statTotal', stats.totalUsers);
    setVal('statActive', stats.activeUsers);
    setVal('statAdmins', stats.admins);
    setVal('statVerified', stats.verifiedUsers);
    setVal('statDisabled', stats.disabledUsers);
    setVal('statRecent', stats.recentRegistrations);
    if (updatedEl) {
        updatedEl.textContent = `Last updated: ${statsTimeFormatter.format(fetchedAt)}`;
    }
}

function createBadge(text, className) {
    const badge = document.createElement('span');
    badge.className = ['badge', className].filter(Boolean).join(' ');
    badge.textContent = text;
    return badge;
}

function renderOwnerActionSummary() {
    const container = document.getElementById('adminOwnerActionSummary');
    if (!container || container.dataset.rendered === 'true') return;

    const fragment = document.createDocumentFragment();
    OWNER_ACTION_BUCKETS.forEach((bucket) => {
        const card = document.createElement('article');
        card.className = 'admin-owner-summary-card';

        const top = document.createElement('div');
        top.className = 'admin-owner-summary-card__top';
        const title = document.createElement('h4');
        title.textContent = bucket.title;
        top.append(createBadge(bucket.badge, bucket.badgeClass), title);

        const description = document.createElement('p');
        description.textContent = bucket.description;

        const links = document.createElement('div');
        links.className = 'admin-owner-summary-card__links';
        bucket.links.forEach((entry) => {
            const link = document.createElement('a');
            link.href = entry.href;
            link.textContent = entry.label;
            links.append(link);
        });

        card.append(top, description, links);
        fragment.append(card);
    });
    container.replaceChildren(fragment);
    container.dataset.rendered = 'true';
}

export function createAdminDashboard({ showToast }) {
    let version = 0;
    let statsCache = null;

    function invalidate() {
        statsCache = null;
    }

    async function load() {
        renderOwnerActionSummary();
        const updatedEl = document.getElementById('statsUpdated');

        if (statsCache && (Date.now() - statsCache.fetchedAt < STATS_TTL)) {
            renderStats(statsCache.stats, updatedEl, statsCache.fetchedAt);
            return;
        }

        const myVersion = ++version;

        for (const id of STAT_IDS) {
            const el = document.getElementById(id);
            if (el) el.textContent = '\u2014';
        }
        if (updatedEl) updatedEl.textContent = 'Refreshing\u2026';

        const statsRes = await apiAdminStats();

        if (myVersion !== version) return;

        if (statsRes.ok) {
            const stats = statsRes.data?.stats || statsRes.data || {};
            const now = Date.now();
            statsCache = { stats, fetchedAt: now };
            renderStats(stats, updatedEl, now);
            return;
        }

        if (updatedEl) updatedEl.textContent = 'Failed to load stats';
        showToast('Failed to load dashboard stats.', 'error');
    }

    return {
        invalidate,
        load,
    };
}
