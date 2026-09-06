import { apiAdminStats, apiAdminBillingEvents, apiAdminAiUsageAttempts, apiAdminDataLifecycleRequests } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

import { renderAdminWorkbench } from './control-plane/guidance.js?v=__ASSET_VERSION__';

const STATS_TTL = 30_000;
const STAT_IDS = ['statTotal', 'statActive', 'statAdmins', 'statVerified', 'statDisabled', 'statRecent'];

const ADMIN_OPERATOR_LOCALE = 'en-GB';

const TASKS = [
    ['Find a user', 'Role, account status, credits and stored assets.', '#users', 'People & payments'],
    ['Trace a payment', 'Follow a provider event to its checkout and fulfillment evidence.', '#billing-events', 'People & payments'],
    ['Understand an AI job', 'Inspect the reservation and outcome before deciding what comes next.', '#ai-usage', 'Operations'],
    ['Browse stored media', 'Find an object in its bucket, including further result pages.', '#object-storage', 'Operations'],
    ['Edit News Pulse', 'Manage visibility and scheduled content in both content languages.', '#news-feed-agent', 'Creative work'],
    ['Manage Hero Videos', 'Review sources, conversion state and published slots.', '#homepage-hero-videos', 'Creative work'],
];

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

function renderTasks() {
    const container = document.getElementById('adminOwnerActionSummary');
    if (!container || container.childElementCount) return;
    for (const [title, copy, href, group] of TASKS) {
        const link = document.createElement('a');
        link.className = 'admin-task-link'; link.href = href;
        const heading = document.createElement('strong'); heading.textContent = title;
        const description = document.createElement('span'); description.textContent = copy;
        const category = document.createElement('small'); category.textContent = group + ' →';
        link.append(heading, description, category); container.append(link);
    }
}

export function createAdminDashboard({ showToast, loadCapabilities }) {
    let version = 0;
    let statsCache = null;
    let busy = false;
    let attentionVersion = 0;
    let capabilityVersion = 0;
    let capabilityBusy = false;
    let workbenchInitialized = false;

    function invalidate() {
        statsCache = null;
    }

    function hide() {
        version += 1;
        attentionVersion += 1;
        capabilityVersion += 1;
        if (busy) statsCache = null;
        busy = false;
        if (capabilityBusy) {
            const button = document.getElementById('adminCapabilitiesRefresh');
            const status = document.getElementById('adminCapabilitiesState');
            if (button) button.disabled = false;
            if (status) status.textContent = 'The previous check was left before completion. Check again for current evidence.';
            capabilityBusy = false;
        }
    }

    async function load() {
        renderTasks();
        if (busy) return;
        if (!workbenchInitialized) {
            renderAdminWorkbench();
            workbenchInitialized = true;
        }
        const updatedEl = document.getElementById('statsUpdated');

        if (statsCache && (Date.now() - statsCache.fetchedAt < STATS_TTL)) {
            renderStats(statsCache.stats, updatedEl, statsCache.fetchedAt);
            return;
        }

        const myVersion = ++version;
        busy = true;
        const attention = loadAttention();

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
            await attention; if (myVersion === version) busy = false;
            return;
        }

        if (updatedEl) updatedEl.textContent = 'Failed to load stats';
        showToast('Failed to load dashboard stats.', 'error');
        await attention; if (myVersion === version) busy = false;
    }

    async function loadAttention() {
        const token = ++attentionVersion;
        const holder = document.getElementById('adminAttention');
        if (!holder) return;
        holder.textContent = 'Loading recent records…';
        const sources = [
            { title:'Billing events', section:'billing-events', key:'events', load:() => apiAdminBillingEvents({ limit:5 }), id:'eventId' },
            { title:'AI jobs', section:'ai-usage', key:'attempts', load:() => apiAdminAiUsageAttempts({ limit:5 }), id:'attemptId' },
            { title:'Lifecycle requests', section:'lifecycle', key:'requests', load:() => apiAdminDataLifecycleRequests({ limit:5 }) },
        ];
        const rows = await Promise.all(sources.map(async source => ({ source, response:await source.load() })));
        if (token !== attentionVersion || !holder.isConnected) return;
        holder.replaceChildren();
        for (const { source, response } of rows) {
            const row = document.createElement('div'); row.className = 'admin-attention-row';
            const description = document.createElement('div');
            const title = document.createElement('strong'); title.textContent = source.title;
            const copy = document.createElement('p');
            const records = Array.isArray(response.data?.[source.key]) ? response.data[source.key] : null;
            const item = records?.find(record => ['failed','unknown','pending','received','needs_review','blocked'].includes(record.processingStatus || record.status));
            const label = item?.processingStatus || item?.status;
            copy.textContent = !response.ok ? 'Could not load this sample. Open the section for its error and retry controls.'
                : !records ? 'The response did not include a usable record list.'
                    : item ? `A sampled record needs review: ${label}.`
                        : `No review state found in this sample of ${records.length} records. This does not establish overall readiness.`;
            const link = document.createElement('a'); link.href = '#' + source.section; link.className = 'btn-action'; link.textContent = 'Review ' + source.title.toLowerCase();
            const id = source.id && (item?.[source.id] || item?.id);
            if (typeof id === 'string' && id) link.addEventListener('click', event => {
                if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                event.preventDefault(); document.dispatchEvent(new CustomEvent('admin:open-context', { detail:{section:source.section,[source.id]:id} }));
            });
            description.append(title,copy); row.append(description,link); holder.append(row);
        }
        document.getElementById('adminAttentionScope').textContent = `API sample fetched at ${statsTimeFormatter.format(new Date())}; at most five recent records per source. No global readiness claim.`;
    }
    function bind() {
        document.getElementById('adminOverviewRefresh')?.addEventListener('click', () => { if (!busy) { invalidate(); void load(); } });
        document.getElementById('adminCapabilitiesRefresh')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            if (button.disabled) return;
            button.disabled = true;
            capabilityBusy = true;
            const token = ++capabilityVersion;
            const isCurrent = () => token === capabilityVersion && button.isConnected;
            const status = document.getElementById('adminCapabilitiesState');
            status.textContent = 'Checking bounded API read surfaces…';
            try { await loadCapabilities?.(isCurrent); if (!isCurrent()) return; status.textContent = 'API responses observed at ' + statsTimeFormatter.format(new Date()) + '. These do not verify deployment or business readiness.'; }
            catch { if (!isCurrent()) return; status.textContent = 'Availability check failed. Try again; other tasks remain available.'; }
            finally { if (isCurrent()) { button.disabled = false; capabilityBusy = false; } }
        });
    }
    return { bind, invalidate, load, hide };
}
