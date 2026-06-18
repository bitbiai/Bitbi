import {
    badge,
    byId,
    clear,
    detailRows,
    el,
} from './core.js?v=__ASSET_VERSION__';

const WORKBENCH_TASKS = Object.freeze([
    {
        id: 'release-deploy-safety',
        title: 'Betriebsstatus',
        status: 'evidence_pending',
        mode: 'Read-only',
        href: '#readiness',
        probe: null,
        nextAction: 'Run local release-plan checks, inspect deploy order, and collect operator evidence before any deploy request.',
        blockedReason: 'Deploy approval remains blocked until release-plan order and live evidence are reviewed.',
    },
    {
        id: 'production-evidence',
        title: 'Production Evidence',
        status: 'blocked',
        mode: 'Read-only',
        href: '#readiness',
        probe: null,
        nextAction: 'Review blocked claims and copy-only evidence commands; attach live read-only evidence outside this UI.',
        blockedReason: 'Repo evidence is not live Cloudflare proof.',
    },
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
        status: 'action_available',
        mode: 'Read-only plus guarded mutation',
        href: '#ai-budget-switches',
        probe: 'AI budget controls',
        nextAction: 'Refresh switches, caps, reconciliation, and repair evidence before applying any guarded update.',
        blockedReason: 'Provider-cost controls stay layered under Cloudflare/master gates.',
    },
    {
        id: 'tenant-asset-safety',
        title: 'Speicher-Integrität',
        status: 'ready_to_review',
        mode: 'Read-only first',
        href: '#tenant-assets',
        probe: 'Tenant asset manual review',
        nextAction: 'Use the compact storage health summary first; open advanced diagnostics only when evidence review is needed.',
        blockedReason: 'Legacy backfill, access switch, reset, and manual-review tools stay collapsed behind Advanced Diagnostics.',
    },
    {
        id: 'data-lifecycle',
        title: 'Data Lifecycle',
        status: 'action_available',
        mode: 'Read-only plus guarded mutation',
        href: '#lifecycle',
        probe: 'Data lifecycle',
        nextAction: 'Open request details, generate evidence, and verify final-state requirements before executing safe actions.',
        blockedReason: 'Legal/GDPR completion is claimable only per completed request evidence.',
    },
    {
        id: 'operations-triage',
        title: 'Operations Triage',
        status: 'ready_to_review',
        mode: 'Read-only',
        href: '#operations',
        probe: null,
        nextAction: 'Review timeline, evidence index commands, async diagnostics, and manual-review queue signals.',
        blockedReason: 'Triage evidence does not mutate live systems or prove readiness by itself.',
    },
]);

function statusVariant(status) {
    if (status === 'action_available' || status === 'ready_to_review') return 'active';
    if (status === 'blocked' || status === 'unsafe_to_claim') return 'disabled';
    return 'legacy';
}

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
        top.appendChild(badge(labelStatus(task.status), statusVariant(task.status)));
        article.appendChild(top);

        article.appendChild(detailRows([
            ['Mode', task.mode],
            ['API signal', probe ? probe.status : 'Not required'],
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
