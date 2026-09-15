// Admin-only content in the existing shared Help menu. No second panel or renderer
// on public/member pages; these topics contain no private records or live claims.
const TOPICS = [
    ['people', 'People and organization context',
        'Start with a user or organization; keep that identity through the next action.',
        'User Info links to the account, credit history and stored assets. Organization membership selects a valid context; it never overrides tenant isolation, permissions or billing. Registration controls remain in Users. Account shortcuts open your own member account.',
        [['Users', 'users'], ['Organizations', 'orgs'], ['Registration settings', 'registration-settings']]],
    ['billing', 'Billing and credit adjustments',
        'Inspect balances and entitlements before making a manual adjustment.',
        'Manual grants change the credit ledger and require a reason and confirmation. Repeating a pending operation retains its idempotency key. User grants add to the member balance; they are not a purchase or evidence of live billing readiness. Organization and member grants are separate controls below the billing lookups.',
        [['Billing & credits', 'billing'], ['Billing readiness', 'live-billing']]],
    ['events', 'Provider events and review',
        'Receipt of a provider event and completion of its business action are different.',
        'Billing Events shows sanitized records, fulfillment evidence and local reconciliation. Resolving or dismissing a review does not call Stripe, cancel subscriptions or repair credits. Live readiness requires the relevant checkout, webhook, duplicate-event and operator evidence.',
        [['Billing events', 'billing-events']]],
    ['creative', 'Creative tools and publishing',
        'Use AI Lab to create and compare; use Model status to inspect observed outcomes.',
        'AI Lab keeps its model catalog, Text, Image, Embeddings, Compare, Live Agent, Music and Video modes. Run and save controls keep their displayed model, cost and validation requirements. Fable data opens the existing conversation workspace with filters, details and guarded actions. Newsfeed is a read-only reader; News management edits content and per-surface visibility. Homepage videos separates source assignment and conversion from delivery settings. Visibility changes and cleanup remain explicit actions.',
        [['AI Lab', 'ai-lab'], ['Model status', 'model-status'], ['Fable data', 'fable-data-center'], ['Newsfeed reader', 'newsfeed'], ['News management', 'news-feed-agent'], ['Homepage videos', 'homepage-hero-videos']]],
    ['budget', 'Budgets and provider controls',
        'App switches, provider master flags and budget caps are separate controls.',
        'Provider-cost work requires the Cloudflare master flag, the D1 app switch and the applicable daily or monthly cap. This page edits app controls, not Cloudflare variables. Usage attempts distinguish reservation, provider outcome and billing state; cleanup must retain unknown outcomes. Reconciliation, repair reports and archives provide evidence, not a readiness approval or a replacement for the required review.',
        [['AI usage', 'ai-usage'], ['Budget controls', 'ai-budget-switches'], ['Platform caps', 'platform-budget-caps'], ['Reconciliation', 'budget-reconciliation'], ['Repair report', 'repair-evidence-report'], ['Evidence archives', 'evidence-archives']]],
    ['lifecycle', 'Lifecycle and retention',
        'Inspect the subject and retained categories before approving an operation.',
        'Lifecycle requests separate planning, approval, execution and completion. Review scope and evidence at every step. Operational deletion is not blanket legal erasure: billing, audit, provider, security and legal records may remain. Required reasons and typed confirmations stay beside the action.',
        [['Data lifecycle', 'lifecycle']]],
    ['operations', 'Diagnostics and storage',
        'Use observed records to understand a problem; an empty sample is not an all-clear.',
        'The Workspace review queue is a bounded sample of recent records. Diagnostics contains timeline, triage, video jobs and tenant review. After cleanup, run the existing dry-run before superseding stale review rows; this does not delete assets or establish ownership. R2 Drive browses configured buckets and preserves guarded upload, download and delete actions. Storage Integrity and Security show their recorded evidence and access boundaries.',
        [['Diagnostics', 'operations'], ['R2 Drive', 'object-storage'], ['Storage Integrity', 'tenant-assets'], ['Security & policy', 'security'], ['Activity', 'activity']]],
];

export function initAdminHelp() {
    const root = document.getElementById('bitbiHelpMenu');
    const section = root?.querySelector('[data-help-section="admin"]');
    const stack = section?.querySelector('.help-menu__items');
    if (!stack || stack.dataset.adminGuide) return;
    stack.dataset.adminGuide = 'true';
    section.querySelector('.help-menu__section-title').textContent = 'Admin guide';
    section.querySelector('.help-menu__section-summary').textContent = 'People, creative work and operations — with the safeguards at each step.';
    stack.replaceChildren();
    for (const [id, title, summary, copy, destinations] of TOPICS) {
        const details = document.createElement('details');
        details.className = 'help-menu__item'; details.dataset.adminHelpTopic = id;
        const toggle = document.createElement('summary'); toggle.className = 'help-menu__item-summary';
        const heading = document.createElement('span'); heading.className = 'help-menu__item-title'; heading.textContent = title;
        const description = document.createElement('span'); description.className = 'help-menu__item-copy'; description.textContent = summary;
        toggle.append(heading, description);
        const body = document.createElement('div'); body.className = 'help-menu__item-body';
        const paragraph = document.createElement('p'); paragraph.className = 'help-menu__item-detail'; paragraph.textContent = copy;
        const links = document.createElement('div'); links.className = 'help-menu__links';
        for (const [label, hash] of destinations) {
            const link = document.createElement('a'); link.className = 'help-menu__link'; link.textContent = label; link.href = '#' + hash; link.dataset.nav = hash;
            link.addEventListener('click', event => {
                if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) root.querySelector('.help-menu__close')?.click();
            });
            links.append(link);
        }
        body.append(paragraph, links); details.append(toggle, body); stack.append(details);
    }
}
