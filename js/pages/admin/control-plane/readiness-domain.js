/* ============================================================
   BITBI — Admin Control Plane / Readiness Domain
   Frontend-only readiness, evidence, and blocked-claim rendering.
   ============================================================ */

import {
    apiAdminReadinessStatus,
} from '../../../shared/auth-api.js?v=__ASSET_VERSION__';
import {
    CURRENT_AUTH_SCHEMA_CHECKPOINT,
    badge,
    byId,
    clear,
    copyTextToClipboard,
    detailRows,
    el,
    operatorGuidancePanel,
    readinessCards,
    readinessSection,
    setState,
} from './core.js?v=__ASSET_VERSION__';
import {
    READINESS_COMMAND_GROUPS,
    READINESS_FALLBACK_STATUS,
    normalizeReadinessStatus,
    statusLabel,
    statusVariant,
} from './readiness.js?v=__ASSET_VERSION__';

export function createReadinessDomain({ notify, exportLegacyMediaResetDryRunJson, exportTenantAssetManualReviewEvidenceJson }) {
    function renderReadinessHero(container, status, sourceLabel) {
        const release = status.releaseTruth || {};
        const hero = el('div', 'admin-control-hero glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('p', 'admin-control-hero__eyebrow', 'Readiness & Evidence Dashboard'));
        copy.append(el('h2', 'admin-control-hero__title', 'Current platform state, blocked claims, and safe operator actions.'));
        copy.append(el('p', 'admin-control-hero__copy', 'This dashboard centralizes repo-supported readiness state. It does not prove live deploy status, live billing readiness, tenant isolation, ownership backfill readiness, access-switch readiness, or confirmed reset readiness.'));
        const badges = el('div', 'admin-control-hero__badges');
        badges.append(
            badge('Production blocked', 'disabled'),
            badge('Live billing blocked', 'disabled'),
            badge('Tenant isolation not claimed', 'legacy'),
            badge('Reset not approved', 'disabled'),
            badge(sourceLabel, sourceLabel === 'Backend status' ? 'active' : 'legacy'),
        );
        hero.append(copy, badges);
        container.appendChild(hero);

        const releaseSection = readinessSection('Current Release Truth', 'Repo truth is useful operator context, not live deploy proof.');
        releaseSection.appendChild(readinessCards([
            {
                title: 'Auth schema checkpoint',
                status: release.latestAuthMigration || CURRENT_AUTH_SCHEMA_CHECKPOINT,
                copy: `Latest auth migration from ${release.source || 'config/release-compat.json'}. Operator must verify remote D1 status before dependent Auth Worker deploys.`,
                meta: [
                    ['Migration directory', release.migrationDirectory || 'workers/auth/migrations'],
                    ['Database', release.databaseName || 'bitbi-auth-db'],
                ],
            },
            {
                title: 'Deploy separation',
                status: 'operator verification required',
                copy: 'Static Pages, Auth Worker, AI Worker, and Contact Worker deploy separately. Release plan output must be reviewed before any main release.',
                meta: [
                    ['Deploy units', Array.isArray(release.deployUnits) ? release.deployUnits.join(', ') : 'auth Worker, AI Worker, contact Worker, static Pages'],
                    ['Live deploy proof', release.repoTruthIsLiveDeployProof ? 'Claimed' : 'Not claimed'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        container.appendChild(releaseSection);

        container.appendChild(operatorGuidancePanel({
            eyebrow: 'Release evidence workflow',
            copy: 'Collect read-only evidence before requesting deploy approval. This dashboard is an operator map; it does not deploy, migrate, call Stripe, enable reset, or prove live readiness.',
            badges: [
                { label: 'Repo evidence only', variant: 'user' },
                { label: 'Live evidence required', variant: 'legacy' },
                { label: 'Blocked until reviewed', variant: 'disabled' },
            ],
            items: [
                {
                    badge: { label: 'Read-only', variant: 'user' },
                    title: 'Generate local packets',
                    copy: 'Use release plan, cutover evidence, readiness dossier, resource model, rollback drill, and evidence index from an operator terminal.',
                },
                {
                    badge: { label: 'Operator proof', variant: 'legacy' },
                    title: 'Attach live read-only evidence',
                    copy: 'Remote D1 migration status, Worker/static deploy IDs, health checks, security headers, billing canary, and rollback owner remain operator-supplied.',
                },
                {
                    badge: { label: 'Blocked', variant: 'disabled' },
                    title: 'Keep claims blocked',
                    copy: 'Production readiness, live billing readiness, tenant isolation, ownership backfill, access-switch readiness, confirmed reset readiness, and legal completion remain unclaimed.',
                },
            ],
        }));
    }

    function renderReadinessStatusGrid(container, title, desc, items) {
        const section = readinessSection(title, desc);
        section.appendChild(readinessCards(items, (item) => ({
            title: item.label || item.title,
            badge: { label: statusLabel(item.status || item.expected || 'not reported'), variant: statusVariant(item.status || item.expected) },
            copy: item.copy || item.summary || item.message || 'Current-state operator signal. Verify live state separately where applicable.',
            meta: item.expected || item.enabled !== undefined
                ? [
                    ['Expected', item.expected || '-'],
                    ['Enabled', item.enabled === true ? 'Yes' : item.enabled === false ? 'No' : 'Not applicable'],
                    ['Raw value exposed', item.rawValueExposed === true ? 'Yes' : 'No'],
                ]
                : undefined,
        })));
        container.appendChild(section);
    }

    function renderProductionExecution(container, status) {
        const execution = status.productionExecution || READINESS_FALLBACK_STATUS.productionExecution;
        const resourceModel = status.cloudflareResourceModel || READINESS_FALLBACK_STATUS.cloudflareResourceModel;
        const dossier = status.readinessDossier || READINESS_FALLBACK_STATUS.readinessDossier;
        const postDeploy = status.postDeployVerification || READINESS_FALLBACK_STATUS.postDeployVerification;
        const rollback = status.rollbackDrill || READINESS_FALLBACK_STATUS.rollbackDrill;
        const section = readinessSection('Production Execution Framework', 'Local-only execution dossier, Cloudflare resource model, post-deploy read-only verification, and rollback drill status. This dashboard never deploys, migrates, mutates Cloudflare, or executes rollback.');
        const grid = el('div', 'admin-control-grid');

        const cards = [
            {
                title: 'Production Execution State',
                badge: execution.status || 'blocked',
                copy: execution.safeStateSummary || 'Repo-supported state exists; deploy-pending and live-evidence-pending remain visible until operator proof is attached.',
                meta: [
                    ['Repo supported', execution.repoSupported === true ? 'Yes' : 'No'],
                    ['Deploy pending', execution.deployPending === true ? 'Yes' : 'No'],
                    ['Live evidence pending', execution.liveEvidencePending === true ? 'Yes' : 'No'],
                    ['Production readiness', execution.productionReadiness || 'blocked'],
                    ['Browser deploy/migration/rollback', execution.noBrowserDeploy && execution.noBrowserMigration && execution.noBrowserRollback ? 'Not offered' : 'Review required'],
                ],
            },
            {
                title: 'Cloudflare Resource Model',
                badge: resourceModel.status || 'live verification required',
                copy: 'Repo declarations are checked against Wrangler config. Live Cloudflare resource, secret, domain, WAF, header, RUM, and alert evidence remains operator-supplied.',
                meta: [
                    ['Resources', (resourceModel.repoDeclaredResources || []).join(', ')],
                    ['Dashboard-managed', (resourceModel.dashboardManagedRequirements || []).join(', ')],
                    ['Live verification required', resourceModel.liveVerificationRequired === true ? 'Yes' : 'No'],
                    ['Cloudflare API calls made here', resourceModel.cloudflareApiCallsMade === true ? 'Yes' : 'No'],
                    ['Secret values exposed', resourceModel.secretValuesExposed === true ? 'Yes' : 'No'],
                ],
                actions: [
                    { label: 'Copy resource model', copy: resourceModel.command || 'npm run cloudflare:resource-model' },
                    { label: 'Copy resource model Markdown', copy: resourceModel.markdownCommand || 'npm run cloudflare:resource-model:markdown' },
                ],
            },
            {
                title: 'Readiness Dossier',
                badge: dossier.status || 'local only',
                copy: 'Single local evidence packet combining release plan, resource model, evidence index, cutover summary, rollback placeholders, and blocked claims.',
                meta: [
                    ['Formats', (dossier.outputFormats || ['json', 'markdown']).join(', ')],
                    ['Default live calls', dossier.defaultLiveCalls === true ? 'Yes' : 'No'],
                    ['Production readiness', dossier.productionReadiness || 'blocked'],
                    ['Live billing readiness', dossier.liveBillingReadiness || 'blocked'],
                ],
                actions: (dossier.commands || ['npm run readiness:dossier', 'npm run readiness:dossier:markdown']).map((command) => ({
                    label: command.includes('markdown') ? 'Copy dossier Markdown' : 'Copy dossier JSON',
                    copy: command,
                })),
            },
            {
                title: 'Post-Deploy Read-Only Verification',
                badge: postDeploy.status || 'pending',
                copy: 'Operator-run live checks are opt-in and GET-only by default. Admin cookies are never rendered; admin checks stay pending when no cookie is provided.',
                meta: [
                    ['Command', postDeploy.command || 'npm run readiness:live-readonly'],
                    ['GET-only by default', postDeploy.getOnlyByDefault === true ? 'Yes' : 'No'],
                    ['Admin cookie required for admin panels', postDeploy.adminCookieRequiredForAdminPanels === true ? 'Yes' : 'No'],
                    ['Admin cookie value rendered', postDeploy.adminCookieValueRendered === true ? 'Yes' : 'No'],
                    ['Checks', (postDeploy.checks || []).join(', ')],
                ],
                actions: [
                    { label: 'Copy live-read-only command', copy: postDeploy.command || 'npm run readiness:live-readonly' },
                ],
            },
            {
                title: 'Rollback Drill',
                badge: rollback.status || 'not executed',
                copy: 'Rollback readiness is documented as a drill artifact only. The command records placeholders and smoke checks; it does not execute rollback.',
                meta: [
                    ['Command', rollback.command || 'npm run release:rollback-drill'],
                    ['Rollback executed', rollback.rollbackExecuted === true ? 'Yes' : 'No'],
                    ['Rollback owner', rollback.ownerPlaceholder || 'operator to fill'],
                    ['Required evidence', (rollback.requiredEvidence || []).join(', ')],
                ],
                actions: [
                    { label: 'Copy rollback drill command', copy: rollback.command || 'npm run release:rollback-drill' },
                ],
            },
        ];

        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(statusLabel(card.badge), statusVariant(card.badge)));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    const copied = await copyTextToClipboard(action.copy);
                    notify(copied ? `${action.label} copied.` : 'Copy failed.', copied ? 'success' : 'error');
                });
                actions.appendChild(button);
            }
            if (actions.childNodes.length) item.appendChild(actions);
            grid.appendChild(item);
        }

        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderReleaseCandidate(container, status) {
        const rc = status.releaseCandidate || READINESS_FALLBACK_STATUS.releaseCandidate;
        const commands = Array.isArray(rc.commands) ? rc.commands : READINESS_FALLBACK_STATUS.releaseCandidate.commands;
        const commandByText = (text) => commands.find((command) => command === text) || text;
        const section = readinessSection('Release Candidate / Go-No-Go', 'Final RC state, validation matrix, evidence freeze, and blocked claim acknowledgement. This panel copies commands only; it never executes shell commands or performs deployment actions.');
        const grid = el('div', 'admin-control-grid');
        const cards = [
            {
                title: 'Release Candidate Status',
                badge: rc.status || 'blocked',
                copy: 'The release candidate framework is repo-supported for code merge or deploy preparation only. Production readiness and live billing readiness remain blocked until live/manual evidence is collected and reviewed.',
                meta: [
                    ['CI status', rc.ciStatus || 'unknown'],
                    ['RC use', rc.releaseCandidateUse || 'code merge / deploy preparation only'],
                    ['Production readiness', rc.productionReadiness || 'blocked'],
                    ['Live billing readiness', rc.liveBillingReadiness || 'blocked'],
                    ['Browser executes commands', rc.browserExecutesCommands === true ? 'Yes' : 'No'],
                    ['Dangerous actions offered', rc.dangerousActionsOffered === true ? 'Yes' : 'No'],
                ],
            },
            {
                title: 'Readiness Matrix',
                badge: 'Evidence blockers visible',
                copy: 'Implemented capability areas are repo-supported current state. Evidence blockers stay visible and do not become live readiness claims.',
                meta: [
                    ['Matrix', (rc.waveMatrix || []).join(', ')],
                ],
            },
            {
                title: 'Final RC Commands',
                badge: 'Copy-only',
                copy: 'Generate the RC manifest, validation matrix, readiness dossier, rollback drill, and release plan from an operator terminal.',
                meta: [
                    ['Primary matrix', commandByText('npm run rc:check')],
                    ['RC Markdown', commandByText('npm run release:rc:markdown')],
                    ['Readiness dossier', commandByText('npm run readiness:dossier:markdown')],
                ],
                actions: [
                    { label: 'Copy RC check', copy: commandByText('npm run rc:check') },
                    { label: 'Copy RC manifest JSON', copy: commandByText('npm run release:rc') },
                    { label: 'Copy RC manifest Markdown', copy: commandByText('npm run release:rc:markdown') },
                    { label: 'Copy RC dossier Markdown', copy: commandByText('npm run readiness:dossier:markdown') },
                    { label: 'Copy rollback drill', copy: commandByText('npm run release:rollback-drill') },
                    { label: 'Copy release plan', copy: commandByText('npm run release:plan') },
                ],
            },
            {
                title: 'Go/No-Go Checklist',
                badge: 'Production blocked',
                copy: 'Every checklist item must be reviewed before deploy approval. Live evidence can remain pending only when the operator explicitly acknowledges blocked claims.',
                meta: [
                    ['Checklist', (rc.checklist || []).join(', ')],
                    ['Blocked claims', 'production readiness, live billing readiness, tenant isolation, ownership backfill, access switch, confirmed legacy reset'],
                ],
            },
        ];

        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(statusLabel(card.badge), statusVariant(card.badge)));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            if (card.meta) item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    const copied = await copyTextToClipboard(action.copy);
                    notify(copied ? `${action.label} copied.` : 'Copy failed.', copied ? 'success' : 'error');
                });
                actions.appendChild(button);
            }
            if (actions.childNodes.length) item.appendChild(actions);
            grid.appendChild(item);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderLiveEvidenceState(container, status) {
        const state = status.liveEvidenceState || READINESS_FALLBACK_STATUS.liveEvidenceState;
        const cutover = status.cutoverEvidence || READINESS_FALLBACK_STATUS.cutoverEvidence;
        const pendingChecks = Array.isArray(state.pendingChecks) ? state.pendingChecks : [];
        const manifestFields = Array.isArray(state.latestExpectedManifestFields) ? state.latestExpectedManifestFields : [];
        const commands = Array.isArray(cutover.commands) ? cutover.commands : [];
        const section = readinessSection('Live Evidence State', 'Repo-supported controls are distinct from deployed, operator-verified live evidence.');
        const grid = el('div', 'admin-control-grid');

        const liveCard = el('article', 'admin-control-card glass glass-card reveal visible');
        const liveTop = el('div', 'admin-control-card__top');
        liveTop.append(el('h3', 'admin-section-title', 'Live runtime proof'), badge(statusLabel(state.status), statusVariant(state.status)));
        liveCard.append(liveTop, el('p', 'admin-shell__desc', state.caveat || 'No live evidence is collected by the repo alone. Operator read-only evidence remains required.'));
        liveCard.appendChild(detailRows([
            ['Repo supported', state.repoSupported === true ? 'Yes' : 'No'],
            ['Deploy pending until operator proof', state.deployPendingUntilOperatorProof === true ? 'Yes' : 'No'],
            ['Evidence collected by repo alone', state.liveEvidenceCollectedByRepoAlone === true ? 'Yes' : 'No'],
            ['Pending checks', pendingChecks.length ? pendingChecks.join(', ') : 'Not reported'],
        ]));
        grid.appendChild(liveCard);

        const manifestCard = el('article', 'admin-control-card glass glass-card reveal visible');
        const manifestTop = el('div', 'admin-control-card__top');
        manifestTop.append(el('h3', 'admin-section-title', 'Release cutover manifest'), badge('Copy-only', 'user'));
        manifestCard.append(manifestTop, el('p', 'admin-shell__desc', 'Generate expected-state evidence before deploy; save sanitized output under the production-readiness evidence directory.'));
        manifestCard.appendChild(detailRows([
            ['Output path', cutover.outputDirectory || 'docs/production-readiness/evidence/'],
            ['Manifest fields', manifestFields.length ? manifestFields.join(', ') : 'Not reported'],
            ['Browser executes commands', cutover.browserExecutesCommands === true ? 'Yes' : 'No'],
            ['Deploy or migration from command', cutover.noDeployOrMigration === true ? 'No' : 'Not reported'],
        ]));
        const actions = el('div', 'admin-control-chip-row');
        const commandButton = el('button', 'btn-action', 'Copy cutover commands');
        commandButton.type = 'button';
        commandButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(commands.join('\n'));
            notify(copied ? 'Cutover evidence commands copied.' : 'Command copy failed.', copied ? 'success' : 'error');
        });
        const pathButton = el('button', 'btn-action', 'Copy evidence save path');
        pathButton.type = 'button';
        pathButton.addEventListener('click', async () => {
            const copied = await copyTextToClipboard(cutover.outputDirectory || 'docs/production-readiness/evidence/');
            notify(copied ? 'Evidence path copied.' : 'Evidence path copy failed.', copied ? 'success' : 'error');
        });
        actions.append(commandButton, pathButton);
        manifestCard.appendChild(actions);
        grid.appendChild(manifestCard);

        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderEvidenceCenter(container) {
        const section = readinessSection('Evidence Center', 'Evidence status is intentionally conservative. Pending evidence remains blocking until sanitized operator proof is accepted.');
        const grid = el('div', 'admin-control-grid');
        const cards = [
            {
                title: 'Legacy Media Reset Dry-run Evidence',
                badge: { label: 'Pending sanitized evidence', variant: 'disabled' },
                copy: 'Current status is rejected unsafe / pending sanitized evidence. Confirmed reset execution is not offered here and remains hard-disabled by default.',
                meta: [
                    ['Template', 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md'],
                    ['Decision', 'docs/tenant-assets/evidence/LEGACY_MEDIA_RESET_DRY_RUN_EVIDENCE_DECISION.md'],
                    ['Required', 'dryRun:true, no deletion, no raw idempotency keys, no raw private R2 keys'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/tenant-assets/LEGACY_MEDIA_RESET_SANITIZED_DRY_RUN_EVIDENCE_TEMPLATE.md' },
                    { label: 'Download dry-run report', onClick: (button) => exportLegacyMediaResetDryRunJson(button) },
                ],
            },
            {
                title: 'Manual Review Idempotency Evidence',
                badge: { label: 'Needs replay/conflict proof', variant: 'disabled' },
                copy: 'Existing operator evidence still needs import replay, import conflict, standalone status success, status replay, status conflict, and item/event readback evidence.',
                meta: [
                    ['Template', 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md'],
                    ['Decision', 'docs/tenant-assets/evidence/MANUAL_REVIEW_STATUS_OPERATOR_EVIDENCE_DECISION.md'],
                    ['Scope', 'Review-state only; no backfill or access switch'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/tenant-assets/MANUAL_REVIEW_IDEMPOTENCY_EVIDENCE_TEMPLATE.md' },
                    { label: 'Export manual-review evidence', onClick: (button) => exportTenantAssetManualReviewEvidenceJson(button) },
                ],
            },
            {
                title: 'Production Readiness Evidence',
                badge: { label: 'Blocked / pending', variant: 'disabled' },
                copy: 'Required categories include release plan, remote migration verification, Worker/static deploy evidence, bindings/secrets, health/security headers, alerts/WAF/RUM, rollback, and canaries.',
                meta: [
                    ['Template', 'docs/production-readiness/EVIDENCE_TEMPLATE.md'],
                    ['Current state', 'Not production-ready'],
                ],
                actions: [
                    { label: 'Copy template path', copy: 'docs/production-readiness/EVIDENCE_TEMPLATE.md' },
                ],
            },
            {
                title: 'Live Billing Evidence',
                badge: { label: 'Blocked / pending', variant: 'disabled' },
                copy: 'Live Stripe readiness requires live config, live checkout canary, verified webhook receipt, duplicate webhook idempotency, review workflow, and redacted evidence.',
                meta: [
                    ['Current state', 'Live billing readiness blocked'],
                    ['Stripe actions', 'Not available from this dashboard'],
                ],
            },
            {
                title: 'AI Budget / Platform Evidence',
                badge: { label: 'Implemented scopes; live evidence pending', variant: 'legacy' },
                copy: 'Selected admin/platform budget controls exist. Live platform evidence remains required before readiness claims.',
                meta: [
                    ['Open panel', 'Budget Switches'],
                    ['Customer billing', 'Not implied'],
                ],
                href: '#ai-budget-switches',
            },
        ];
        for (const card of cards) {
            const item = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', card.title), badge(card.badge.label, card.badge.variant));
            item.append(top, el('p', 'admin-shell__desc', card.copy));
            if (card.meta) item.appendChild(detailRows(card.meta));
            const actions = el('div', 'admin-control-chip-row');
            if (card.href) {
                const link = el('a', 'btn-action', 'Open existing panel');
                link.href = card.href;
                actions.appendChild(link);
            }
            for (const action of card.actions || []) {
                const button = el('button', 'btn-action', action.label);
                button.type = 'button';
                button.addEventListener('click', async () => {
                    if (action.copy) {
                        const copied = await copyTextToClipboard(action.copy);
                        notify(copied ? 'Evidence path copied.' : 'Copy failed.', copied ? 'success' : 'error');
                        return;
                    }
                    await action.onClick?.(button);
                });
                actions.appendChild(button);
            }
            item.appendChild(actions);
            grid.appendChild(item);
        }
        section.appendChild(grid);
        container.appendChild(section);
    }

    function renderOperatorActions(container) {
        const section = readinessSection('Operator Actions', 'Safe actions are inspection, export, refresh, and copy-only guidance. Dangerous actions are intentionally absent or disabled.');
        section.appendChild(readinessCards([
            {
                title: 'Safe inspection and export',
                status: 'available',
                copy: 'Refresh this dashboard, open existing panels, export already sanitized evidence, and copy local commands for an operator terminal.',
                meta: [
                    ['Open controls', 'Billing Events, AI Budget Switches, Data Lifecycle, Operations, Activity'],
                    ['Browser command execution', 'Not implemented'],
                ],
            },
            {
                title: 'Dangerous actions not offered',
                status: 'blocked',
                copy: 'No button enables legacy reset execution, confirmed reset/delete, ownership backfill, access-switching, live billing enablement, deploys, remote migrations, or Stripe/provider/Cloudflare/GitHub mutation.',
                meta: [
                    ['Reset gate', 'Do not enable'],
                    ['Confirmed deletion/reset', 'Not approved'],
                ],
            },
        ], (item) => ({
            title: item.title,
            badge: { label: item.status, variant: statusVariant(item.status) },
            copy: item.copy,
            meta: item.meta,
        })));
        const links = el('div', 'admin-control-chip-row');
        for (const [label, href] of [
            ['Billing Events', '#billing-events'],
            ['AI Budget Controls', '#ai-budget-switches'],
            ['Data Lifecycle', '#lifecycle'],
            ['Tenant Manual Review', '#operations'],
            ['Activity Log', '#activity'],
        ]) {
            const link = el('a', 'btn-action', label);
            link.href = href;
            links.appendChild(link);
        }
        section.appendChild(links);
        container.appendChild(section);
    }

    function renderCommandCenter(container) {
        const section = readinessSection('Command Center', 'Copy-only local/operator commands. The browser never executes shell commands.');
        const grid = el('div', 'admin-control-grid');
        for (const group of READINESS_COMMAND_GROUPS) {
            const card = el('article', 'admin-control-card glass glass-card reveal visible');
            const top = el('div', 'admin-control-card__top');
            top.append(el('h3', 'admin-section-title', group.title), badge('Copy-only', 'user'));
            card.append(top, el('p', 'admin-shell__desc', group.note));
            const pre = el('pre', 'admin-command-block');
            pre.textContent = group.commands.join('\n');
            const button = el('button', 'btn-action', 'Copy commands');
            button.type = 'button';
            button.addEventListener('click', async () => {
                const copied = await copyTextToClipboard(group.commands.join('\n'));
                notify(copied ? `${group.title} commands copied.` : 'Command copy failed.', copied ? 'success' : 'error');
            });
            card.append(pre, button);
            grid.appendChild(card);
        }
        const warning = el('p', 'admin-shell__desc', 'Manual deploy commands are intentionally not one-click actions. Do not enable ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION from this dashboard.');
        section.append(grid, warning);
        container.appendChild(section);
    }

    async function renderReadiness() {
        const container = byId('readinessChecklist');
        if (!container) return;
        clear(container);
        const toolbar = el('div', 'admin-control-toolbar glass glass-card reveal visible');
        const copy = el('div');
        copy.append(el('h3', 'admin-section-title', 'Readiness & Evidence'));
        copy.append(el('p', 'admin-shell__desc', 'Central operator cockpit for release truth, blocked claims, hardening status, evidence gaps, and safe command copy.'));
        const refresh = el('button', 'btn-action', 'Refresh status');
        refresh.type = 'button';
        refresh.addEventListener('click', () => {
            void renderReadiness();
        });
        toolbar.append(copy, refresh);
        container.appendChild(toolbar);
        const state = el('div', 'admin-state');
        state.id = 'readinessStatusState';
        state.textContent = 'Loading readiness status...';
        container.appendChild(state);

        const res = await apiAdminReadinessStatus();
        const status = normalizeReadinessStatus(res.ok ? res.data : null);
        const sourceLabel = res.ok ? 'Backend status' : 'Static fallback';
        setState(
            'readinessStatusState',
            res.ok
                ? 'Read-only readiness status loaded. No provider, Stripe, R2, reset, backfill, access-switch, deploy, or migration action was performed.'
                : 'Backend readiness status unavailable; rendering static current-state fallback. Operator verification remains required.',
            res.ok ? 'success' : 'error',
        );

        renderReadinessHero(container, status, sourceLabel);
        renderProductionExecution(container, status);
        renderReleaseCandidate(container, status);
        renderLiveEvidenceState(container, status);
        renderReadinessStatusGrid(container, 'Blocked Claims', 'These claims remain blocked or unclaimed unless separate operator evidence proves otherwise.', status.blockedClaims);
        renderReadinessStatusGrid(container, 'Current Hardening Status', 'Implemented means repo-supported/current-state, not proven live.', status.hardeningStatus);
        renderReadinessStatusGrid(container, 'Runtime Safety Gates', 'Safety gates and controls are shown as operator signals; missing gate values are safe/default-off unless explicitly enabled.', status.runtimeSafetyGates);
        renderReadinessStatusGrid(container, 'Evidence Status', 'Evidence gaps stay visible because they block readiness claims.', status.evidenceStatuses);
        renderEvidenceCenter(container);
        renderOperatorActions(container);
        renderCommandCenter(container);
    }

    return {
        renderReadiness,
    };
}
