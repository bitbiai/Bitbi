import {
    badge,
    byId,
    clear,
    detailRows,
    el,
} from './core.js?v=__ASSET_VERSION__';

const WORKBENCH_TASKS = Object.freeze([
    {
        id: 'billing-evidence',
        title: 'Billing Evidence',
        status: 'evidence_pending',
        mode: 'Read-only',
        href: '#billing-events',
        probe: 'Billing events',
        nextAction: 'Review billing evidence, provider event summaries, and reconciliation before any manual review resolution.',
        blockedReason: 'Live billing readiness needs Stripe canary and operator evidence.',
    },
    {
        id: 'ai-budget-controls',
        title: 'AI Budget Controls',
        status: 'guarded_actions',
        mode: 'Read-only plus guarded mutation',
        href: '#ai-budget-switches',
        probe: 'AI budget controls',
        nextAction: 'Refresh switches, caps, reconciliation, and repair evidence before applying any guarded update.',
        blockedReason: 'Provider-cost controls stay layered under Cloudflare/master gates.',
    },
    {
        id: 'tenant-asset-safety',
        title: 'Storage Integrity',
        status: 'read_only_review',
        mode: 'Read-only first',
        href: '#tenant-assets',
        probe: 'Tenant asset manual review',
        nextAction: 'Use the compact storage health summary first; open advanced diagnostics only when evidence review is needed.',
        blockedReason: 'Legacy backfill, access switch, reset, and manual-review tools stay collapsed behind Advanced Diagnostics.',
    },
    {
        id: 'data-lifecycle',
        title: 'Data Lifecycle',
        status: 'guarded_actions',
        mode: 'Read-only plus guarded mutation',
        href: '#lifecycle',
        probe: 'Data lifecycle',
        nextAction: 'Open request details, generate evidence, and verify final-state requirements before executing safe actions.',
        blockedReason: 'Legal/GDPR completion is claimable only per completed request evidence.',
    },
    {
        id: 'operations-triage',
        title: 'Operations Triage',
        status: 'read_only_review',
        mode: 'Read-only',
        href: '#operations',
        probe: null,
        nextAction: 'Review timeline, evidence index commands, async diagnostics, and manual-review queue signals.',
        blockedReason: 'Triage evidence does not mutate live systems or prove readiness by itself.',
    },
]);

function labelStatus(status) {
    return String(status || 'unknown').replace(/_/g, ' ');
}

function probeByLabel(probes = []) {
    const map = new Map();
    for (const probe of probes) {
        if (probe?.label) map.set(probe.label, probe);
    }
    return map;
}

export function renderAdminWorkbench(probes = []) {
    const container = byId('adminWorkbenchTasks');
    if (!container) return;
    const probeMap = probeByLabel(probes);
    clear(container);

    for (const task of WORKBENCH_TASKS) {
        const probe = task.probe ? probeMap.get(task.probe) : null;
        const article = el('article', 'admin-workbench-card');
        const top = el('div', 'admin-workbench-card__top');
        top.append(el('h4', 'admin-workbench-card__title', task.title));
        top.appendChild(badge(
            probe ? probe.status : 'Availability not checked',
            probe?.ok === true ? 'active' : probe?.variant || 'legacy',
        ));
        article.appendChild(top);

        article.appendChild(detailRows([
            ['Implemented workflow', labelStatus(task.status)],
            ['Mode', task.mode],
            ['API signal', probe ? probe.status : 'Not checked'],
            ['Next safe action', task.nextAction],
            ['Blocked reason', task.blockedReason],
        ]));

        const link = el('a', 'btn-action', `Open ${task.title}`);
        link.href = task.href;
        link.dataset.workbenchTask = task.id;
        article.appendChild(link);
        container.appendChild(article);
    }
}
