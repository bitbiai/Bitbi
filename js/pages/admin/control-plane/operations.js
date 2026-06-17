/* ============================================================
   BITBI — Admin Control Plane / Operations Domain
   Frontend-only operator timeline, triage, and async diagnostics.
   ============================================================ */

import {
    apiAdminAiListFailedVideoJobs,
    apiAdminAiListVideoJobPoisonMessages,
    apiAdminOperationsTimeline,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    apiUnavailableMessage,
    badge,
    byId,
    clear,
    copyTextToClipboard,
    detailRows,
    el,
    readableToken,
    renderUnavailable,
    safeSummaryValue,
    setState,
    shortId,
    simpleList,
} from './core.js?v=__ASSET_VERSION__';
import {
    statusVariant,
} from './readiness.js?v=__ASSET_VERSION__';

export function createOperationsDomain({ notify, formatDate, loadTenantAssetManualReviewQueue }) {
    async function loadOperations() {
        await Promise.all([loadOperatorTimeline(), loadPoisonMessages(), loadFailedJobs(), loadTenantAssetManualReviewQueue()]);
    }

    function operatorTimelineFilters() {
        const filters = {};
        const source = byId('operatorTimelineSourceFilter')?.value || '';
        const severity = byId('operatorTimelineSeverityFilter')?.value || '';
        const status = byId('operatorTimelineStatusFilter')?.value || '';
        const attention = byId('operatorTimelineAttentionFilter')?.value || '';
        if (source) filters.source = source;
        if (severity) filters.severity = severity;
        if (status) filters.status = status;
        if (attention) filters.attentionRequired = attention;
        filters.limit = 25;
        return filters;
    }

    function safeTimelineTarget(target) {
        if (!target || typeof target !== 'object') return null;
        const href = String(target.href || '').trim();
        if (!href.startsWith('#')) return null;
        return {
            href,
            label: safeSummaryValue(target.label || 'Open related panel'),
        };
    }

    function renderOperatorTimelineEvent(event) {
        const card = el('article', 'admin-control-card glass glass-card reveal visible');
        const top = el('div', 'admin-control-card__top');
        top.append(el('h3', 'admin-section-title', safeSummaryValue(event.title || event.type || event.id)));
        top.append(
            badge(readableToken(event.severity || 'informational'), event.severity === 'critical' || event.severity === 'high' ? 'disabled' : statusVariant(event.severity)),
            badge(readableToken(event.source || 'unknown'), 'user'),
            badge(readableToken(event.status || 'recorded'), statusVariant(event.status)),
        );
        card.appendChild(top);
        card.appendChild(el('p', 'admin-shell__desc', safeSummaryValue(event.summary || 'No summary reported.')));
        const meta = [
            ['Time', formatDate(event.timestamp)],
            ['Domain', readableToken(event.domain || event.source)],
            ['Type', readableToken(event.type || event.category)],
            ['Attention required', event.attentionRequired ? 'Yes' : 'No'],
        ];
        if (event.actor && typeof event.actor === 'object') {
            const actorEmail = event.actor.email ? safeSummaryValue(event.actor.email) : null;
            const actorId = event.actor.userId ? shortId(event.actor.userId) : null;
            meta.push(['Actor', actorEmail || actorId || 'Not reported']);
        }
        if (event.recommendedAction?.label) {
            meta.push(['Recommended action', safeSummaryValue(event.recommendedAction.label)]);
        }
        card.appendChild(detailRows(meta));
        const actions = el('div', 'admin-control-chip-row');
        for (const target of [safeTimelineTarget(event.recommendedAction), safeTimelineTarget(event.evidenceTarget)].filter(Boolean)) {
            if (actions.querySelector(`a[href="${target.href}"]`)) continue;
            const link = el('a', 'btn-action', target.label);
            link.href = target.href;
            actions.appendChild(link);
        }
        const copy = el('button', 'btn-action btn-action--secondary', 'Copy event ID');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(event.id || '');
            notify(copied ? 'Event ID copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
        actions.appendChild(copy);
        card.appendChild(actions);
        if (event.dangerousActionWarning) {
            card.appendChild(el('p', 'admin-shell__desc', safeSummaryValue(event.dangerousActionWarning)));
        }
        return card;
    }

    async function loadOperatorTimeline() {
        const list = byId('operatorTimelineList');
        const summaryNode = byId('operatorTimelineSummary');
        setState('operatorTimelineState', 'Loading operator timeline...');
        clear(list);
        clear(summaryNode);
        const res = await apiAdminOperationsTimeline(operatorTimelineFilters());
        if (!res.ok) {
            setState('operatorTimelineState', '');
            renderUnavailable(list, res, 'Operator timeline unavailable. Use local evidence index and existing Admin panels for triage.');
            return;
        }
        const data = res.data || {};
        const events = Array.isArray(data.events) ? data.events : [];
        const blockedClaims = Array.isArray(data.blockedClaims) ? data.blockedClaims : [];
        if (summaryNode) {
            summaryNode.appendChild(detailRows([
                ['Generated', formatDate(data.generatedAt)],
                ['Events shown', events.length],
                ['Has more', data.hasMore ? 'Yes' : 'No'],
                ['Read-only', data.readOnly ? 'Yes' : 'No'],
                ['External calls', data.externalCallsMade ? 'Unexpected' : 'No'],
                ['R2 listing', data.r2ListingPerformed ? 'Unexpected' : 'No'],
                ['Blocked claims', blockedClaims.map((item) => readableToken(item.label || item.id)).slice(0, 4).join(', ') || 'Not reported'],
                ['Archive posture', data.archiveVisibility?.status ? readableToken(data.archiveVisibility.status) : 'metadata only'],
            ]));
        }
        if (data.dangerousActionsOffered?.length) {
            setState('operatorTimelineState', 'Timeline returned unexpected dangerous actions. Treat this response as unsafe.', 'error');
            return;
        }
        setState('operatorTimelineState', 'Read-only redacted operator timeline. It does not execute reset/backfill/access-switch, live billing, deploy, migration, Stripe, provider, refund, subscription, or credit actions.');
        const quickLinks = el('div', 'admin-control-chip-row');
        for (const [label, href] of [
            ['Open Billing Reviews', '#billing-events'],
            ['Open Billing Reconciliation', '#billing-events'],
            ['Open Speicher-Integrität', '#tenant-assets'],
            ['Open Manual Review Queue', '#operations'],
            ['Open Data Lifecycle', '#lifecycle'],
            ['Open AI Budget Evidence', '#ai-budget-switches'],
            ['Open Betriebsstatus', '#readiness'],
        ]) {
            const link = el('a', 'btn-action btn-action--secondary', label);
            link.href = href;
            quickLinks.appendChild(link);
        }
        list.appendChild(quickLinks);
        if (!events.length) {
            list.appendChild(el('p', 'admin-shell__desc', 'No operator timeline events matched the current bounded filters.'));
            return;
        }
        const grid = el('div', 'admin-control-grid');
        for (const item of events.slice(0, 25)) {
            grid.appendChild(renderOperatorTimelineEvent(item));
        }
        list.appendChild(grid);
    }

    async function loadPoisonMessages() {
        const holder = byId('videoPoisonList');
        setState('videoPoisonState', 'Loading poison messages...');
        clear(holder);
        const res = await apiAdminAiListVideoJobPoisonMessages({ limit: 10 });
        if (!res.ok) {
            setState('videoPoisonState', '');
            renderUnavailable(holder, res, 'Video poison diagnostics unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.poisonMessages) ? res.data.poisonMessages
            : Array.isArray(res.data?.messages) ? res.data.messages
                : Array.isArray(res.data?.items) ? res.data.items : [];
        if (items.length === 0) {
            setState('videoPoisonState', 'No poison messages found.');
            return;
        }
        setState('videoPoisonState', `Showing ${items.length} poison messages.`);
        holder.appendChild(simpleList(items, ['id', 'jobId', 'reason', 'createdAt']));
    }

    async function loadFailedJobs() {
        const holder = byId('videoFailedList');
        setState('videoFailedState', 'Loading failed jobs...');
        clear(holder);
        const res = await apiAdminAiListFailedVideoJobs({ limit: 10 });
        if (!res.ok) {
            setState('videoFailedState', '');
            renderUnavailable(holder, res, 'Failed job diagnostics unavailable.');
            return;
        }
        const items = Array.isArray(res.data?.jobs) ? res.data.jobs
            : Array.isArray(res.data?.failedJobs) ? res.data.failedJobs
                : Array.isArray(res.data?.items) ? res.data.items : [];
        if (items.length === 0) {
            setState('videoFailedState', 'No failed jobs found.');
            return;
        }
        setState('videoFailedState', `Showing ${items.length} failed jobs.`);
        holder.appendChild(simpleList(items, ['id', 'jobId', 'status', 'errorCode', 'updatedAt']));
    }

    function bind() {
        byId('operationsRefresh')?.addEventListener('click', loadOperations);
        byId('operatorTimelineRefresh')?.addEventListener('click', loadOperatorTimeline);
        byId('operatorTimelineFilter')?.addEventListener('submit', (event) => {
            event.preventDefault();
            loadOperatorTimeline();
        });
        byId('operatorTimelineCopyEvidenceIndex')?.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('npm run evidence:index\nnpm run evidence:index:markdown');
            notify(copied ? 'Evidence index commands copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
        byId('operatorTimelineCopyRunbook')?.addEventListener('click', async () => {
            const copied = await copyTextToClipboard('docs/runbooks/OPERATOR_TRIAGE_RUNBOOK.md');
            notify(copied ? 'Runbook path copied.' : 'Copy failed.', copied ? 'success' : 'error');
        });
    }

    return {
        bind,
        loadOperations,
        loadOperatorTimeline,
    };
}
