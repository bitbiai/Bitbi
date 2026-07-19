import {
    apiAdminFableDataAttempts,
    apiAdminFableDataCheckpointInvalidate,
    apiAdminFableDataCheckpoints,
    apiAdminFableDataConversation,
    apiAdminFableDataConversationMutation,
    apiAdminFableDataConversations,
    apiAdminFableDataMessageMutation,
    apiAdminFableDataOverview,
    apiAdminFableDataPurge,
    apiAdminFableDataRawRecord,
    apiAdminFableDataRevealSummary,
    apiAdminFableDataTranscript,
    apiAdminFableDataTurnMutation,
    apiAdminFableDataUsage,
    apiAdminFableDataWebSearch,
} from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const PAGE_SIZE = 24;
const DETAIL_PAGE_SIZE = 50;
const TAB_LOADERS = new Set(['transcript', 'attempts', 'memory', 'search', 'usage', 'raw']);

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
}

function button(label, className = 'btn-action') {
    const element = node('button', className, label);
    element.type = 'button';
    return element;
}

function badge(label, tone = 'user') {
    return node('span', `badge badge--${tone}`, label);
}

function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function shortId(value) {
    const text = String(value || '');
    return text.length > 22 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text;
}

function statusTone(status) {
    if (['active', 'succeeded', 'recorded'].includes(status)) return 'active';
    if (['failed', 'unknown', 'deleted', 'invalidated'].includes(status)) return 'disabled';
    return 'user';
}

function copyButton(value, label = 'Copy ID') {
    const control = button(label, 'btn-action btn-action--secondary');
    control.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(String(value || '')); } catch { /* no persistent fallback */ }
    });
    return control;
}

function definitionList(entries) {
    const list = node('dl', 'admin-fable-data__definition-list');
    for (const [label, value] of entries) {
        const wrapper = node('div');
        wrapper.append(node('dt', '', label), node('dd', '', value == null ? 'Null' : value));
        list.append(wrapper);
    }
    return list;
}

function sourceList(sources) {
    const list = node('ul', 'admin-fable-data__sources');
    for (const source of Array.isArray(sources) ? sources : []) {
        const item = node('li');
        const link = node('a', '', source.title || new URL(source.url).hostname);
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
        list.append(item);
    }
    return list;
}

function makeField(labelText, control) {
    const label = node('label', 'admin-fable-data__dialog-field');
    label.append(node('span', '', labelText), control);
    return label;
}

function rawLabel(column) {
    return String(column).split('_').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function webSearchDetails(value) {
    const settings = value || {};
    const mode = settings.callerMode || 'direct';
    const inclusion = settings.effectiveResponseInclusion || 'full';
    const filterMode = settings.domainFilterMode || 'none';
    const domainCount = Number(
        filterMode === 'allowed' ? settings.allowedDomainCount : settings.blockedDomainCount
    ) || 0;
    return {
        mode,
        inclusion,
        domains: filterMode === 'none' ? 'None' : `${filterMode} · ${domainCount}`,
        location: settings.locationEnabled
            ? `Enabled · ${Number(settings.locationFieldCount || 0)} fields`
            : 'Disabled',
        toolChoice: settings.toolChoice || 'auto',
        tool: `${settings.toolVersion || 'web_search_20260318'} · contract v${Number(settings.contractVersion || 3)}`,
    };
}

export function createAdminFableDataCenter({ showToast, formatDate, onClose }) {
    const refs = {
        card: document.getElementById('fableDataCard'),
        cardStats: document.getElementById('fableDataCardStats'),
        open: document.getElementById('fableDataOpen'),
        workspace: document.getElementById('fableDataWorkspace'),
        close: document.getElementById('fableDataClose'),
        refresh: document.getElementById('fableDataRefresh'),
        status: document.getElementById('fableDataStatus'),
        stats: document.getElementById('fableDataStats'),
        filters: document.getElementById('fableDataFilters'),
        search: document.getElementById('fableDataSearch'),
        owner: document.getElementById('fableDataOwner'),
        lifecycle: document.getElementById('fableDataLifecycle'),
        effort: document.getElementById('fableDataEffort'),
        preset: document.getElementById('fableDataPreset'),
        memory: document.getElementById('fableDataMemory'),
        webSearch: document.getElementById('fableDataWebSearch'),
        reasoning: document.getElementById('fableDataReasoning'),
        attemptStatus: document.getElementById('fableDataAttemptStatus'),
        checkpointStatus: document.getElementById('fableDataCheckpointStatus'),
        errorCategory: document.getElementById('fableDataError'),
        from: document.getElementById('fableDataFrom'),
        to: document.getElementById('fableDataTo'),
        sort: document.getElementById('fableDataSort'),
        list: document.getElementById('fableDataConversationList'),
        listCount: document.getElementById('fableDataListCount'),
        previous: document.getElementById('fableDataPrevious'),
        next: document.getElementById('fableDataNext'),
        page: document.getElementById('fableDataPageLabel'),
        detailEmpty: document.getElementById('fableDataDetailEmpty'),
        detailContent: document.getElementById('fableDataDetailContent'),
        detailTitle: document.getElementById('fableDataDetailTitle'),
        detailIdentity: document.getElementById('fableDataDetailIdentity'),
        detailActions: document.getElementById('fableDataDetailActions'),
        tabs: document.getElementById('fableDataTabs'),
        dialog: document.getElementById('fableDataDialog'),
        dialogTitle: document.getElementById('fableDataDialogTitle'),
        dialogBody: document.getElementById('fableDataDialogBody'),
        dialogConfirm: document.getElementById('fableDataDialogConfirm'),
        dialogCancel: document.getElementById('fableDataDialogCancel'),
        dialogClose: document.getElementById('fableDataDialogClose'),
    };
    const panels = Object.fromEntries(['overview', 'transcript', 'attempts', 'memory', 'search', 'usage', 'raw'].map((name) => [
        name,
        document.getElementById(`fableDataPanel${name[0].toUpperCase()}${name.slice(1)}`),
    ]));
    let bound = false;
    let open = false;
    let offset = 0;
    let total = 0;
    let selected = null;
    let selectedDetail = null;
    let activeTab = 'overview';
    let filterTimer = 0;
    let dialogResolve = null;
    let dialogReturnFocus = null;
    const detailOffsets = { transcript: 0, attempts: 0, memory: 0, usage: 0 };

    function setStatus(message, kind = 'neutral') {
        refs.status.textContent = message;
        refs.status.dataset.state = kind;
    }

    function idempotencyKey() {
        return `fable-data-${crypto.randomUUID()}`;
    }

    function filters() {
        return {
            search: refs.search.value.trim(), owner: refs.owner.value.trim(),
            lifecycle: refs.lifecycle.value, effort: refs.effort.value,
            preset: refs.preset.value, memoryMode: refs.memory.value,
            webSearchEnabled: refs.webSearch.value,
            reasoningSummaryEnabled: refs.reasoning.value,
            attemptStatus: refs.attemptStatus.value,
            checkpointStatus: refs.checkpointStatus.value,
            errorCategory: refs.errorCategory.value.trim(),
            from: refs.from.value, to: refs.to.value,
            sort: refs.sort.value,
            limit: PAGE_SIZE, offset,
        };
    }

    function renderStatistics(data, target) {
        const stats = [
            ['Active', data.activeConversations], ['Deleted', data.deletedConversations],
            ['Messages', data.visibleMessages], ['Completed turns', data.completedTurns],
            ['Succeeded attempts', data.attempts?.succeeded], ['Failed', data.attempts?.failed],
            ['Unknown', data.attempts?.unknown], ['Standard memory', data.standardCheckpoints],
            ['Lite memory', data.liteCheckpoints], ['Web search', data.webSearchConversations],
            ['Web fetch', data.webFetchConversations],
            ['Compaction failures', data.compactionFailures], ['Transcript', formatBytes(data.estimatedTranscriptBytes)],
        ];
        target.replaceChildren(...stats.map(([label, value]) => {
            const item = node('div', 'admin-fable-data__stat');
            item.append(node('span', '', label), node('strong', '', value ?? 0));
            return item;
        }));
    }

    async function loadOverview() {
        const response = await apiAdminFableDataOverview();
        if (!response.ok) {
            refs.cardStats.textContent = 'Statistics unavailable.';
            if (open) setStatus(response.error || 'Statistics unavailable.', 'error');
            return;
        }
        renderStatistics(response.data.statistics, refs.cardStats);
        renderStatistics(response.data.statistics, refs.stats);
    }

    function renderConversationList(items) {
        refs.list.replaceChildren();
        if (!items.length) {
            refs.list.append(node('p', 'admin-fable-data__empty', 'No conversations match these filters.'));
            return;
        }
        for (const item of items) {
            const card = button('', 'admin-fable-data__conversation');
            card.dataset.selected = item.id === selected ? 'true' : 'false';
            card.setAttribute('aria-label', `Open ${item.title}`);
            const head = node('div', 'admin-fable-data__conversation-head');
            head.append(node('strong', '', item.title), badge(item.state, statusTone(item.state)));
            const settings = node('div', 'admin-fable-data__badges');
            settings.append(
                badge(item.settings.effort), badge(item.settings.preset),
                badge(item.settings.memoryMode),
                badge(`${item.settings.promptCacheTtl || '5m'} cache`),
                badge(item.settings.webSearchEnabled ? `Search ${item.settings.webSearchMaxUses}` : 'Search off'),
                badge(item.settings.webFetchEnabled ? `Fetch ${item.settings.webFetchMaxUses || 2}` : 'Fetch off'),
            );
            card.append(
                head,
                node('span', 'admin-fable-data__muted', `${item.ownerEmail} · ${shortId(item.id)}`),
                settings,
                node('span', 'admin-fable-data__muted', `${item.counts.messages} messages · ${item.counts.turns} completed · ${formatDate(item.updatedAt)}`),
            );
            card.addEventListener('click', () => selectConversation(item.id));
            refs.list.append(card);
        }
    }

    async function loadConversations() {
        setStatus('Loading conversations...');
        const response = await apiAdminFableDataConversations(filters());
        if (!response.ok) {
            setStatus(response.error || 'Could not load conversations.', 'error');
            refs.list.replaceChildren(node('p', 'admin-fable-data__empty', 'Load failed. Use Refresh to retry.'));
            return;
        }
        total = Number(response.data.total || 0);
        renderConversationList(response.data.conversations || []);
        refs.listCount.textContent = String(total);
        refs.page.textContent = `Page ${Math.floor(offset / PAGE_SIZE) + 1}`;
        refs.previous.disabled = offset === 0;
        refs.next.disabled = offset + PAGE_SIZE >= total;
        setStatus(`${total} conversations available.`, 'success');
    }

    function renderOverview(detail) {
        const c = detail.conversation;
        const settings = c.settings;
        const web = webSearchDetails(settings.webSearch);
        panels.overview.replaceChildren(
            definitionList([
                ['Owner', `${c.ownerEmail} (${c.ownerId})`], ['Conversation ID', c.id],
                ['Lifecycle', c.state], ['Created', formatDate(c.createdAt)], ['Updated', formatDate(c.updatedAt)],
                ['Effort', `${settings.effort} · ${settings.effectiveMaxOutputTokens.toLocaleString()} max output`],
                ['Preset', `${settings.preset} v${settings.presetVersion}`],
                ['Reasoning summary', settings.reasoningSummaryEnabled ? 'Enabled' : 'Disabled'],
                ['Prompt cache TTL', settings.promptCacheTtl || '5m'],
                ['Web search', settings.webSearchEnabled ? `Enabled · up to ${settings.webSearchMaxUses}` : 'Disabled'],
                ['Search mode / inclusion', `${web.mode} / ${web.inclusion}`],
                ['Search domains / location', `${web.domains} / ${web.location}`],
                ['Provider tool choice', web.toolChoice],
                ['Web fetch', settings.webFetchEnabled ? `Enabled · up to ${settings.webFetchMaxUses || 2} · ${Number(settings.webFetchMaxContentTokens || 8000).toLocaleString()} text tokens` : 'Disabled'],
                ['Memory', settings.memoryMode], ['Administrative revision', c.adminRevisionVersion],
                ['Uncovered visible estimate', `${detail.memory.uncoveredEstimatedTokens.toLocaleString()} tokens`],
                ['Transcript storage', formatBytes(detail.storage.transcriptBytes)],
                ['Private provider evidence', `${formatBytes(detail.storage.privateProviderBytes)} · content hidden`],
            ]),
            node('p', 'admin-fable-data__notice', 'Visible transcript revisions affect future context. Provider attempts, private blocks, fingerprints, usage, and accounting evidence remain immutable.'),
        );
    }

    function buildActionButtons(detail) {
        refs.detailActions.replaceChildren();
        const rename = button('Rename');
        rename.addEventListener('click', () => conversationAction('rename'));
        const settings = button('Settings', 'btn-action btn-action--secondary');
        settings.addEventListener('click', () => conversationAction('settings'));
        const lifecycle = button(detail.conversation.state === 'deleted' ? 'Restore' : 'Soft delete', 'btn-action btn-action--secondary');
        lifecycle.addEventListener('click', () => conversationAction(detail.conversation.state === 'deleted' ? 'restore' : 'soft_delete'));
        refs.detailActions.append(rename, settings, lifecycle, copyButton(detail.conversation.id));
        if (detail.conversation.state === 'deleted') {
            const purge = button('Permanent purge', 'btn-action admin-fable-data__danger');
            purge.addEventListener('click', purgeConversation);
            refs.detailActions.append(purge);
        }
    }

    async function selectConversation(id) {
        if (id !== selected) Object.keys(detailOffsets).forEach((key) => { detailOffsets[key] = 0; });
        selected = id;
        setStatus('Loading conversation...');
        const response = await apiAdminFableDataConversation(id);
        if (!response.ok) {
            setStatus(response.error || 'Conversation could not be loaded.', 'error');
            return;
        }
        selectedDetail = response.data;
        refs.detailEmpty.hidden = true;
        refs.detailContent.hidden = false;
        refs.detailTitle.textContent = response.data.conversation.title;
        refs.detailIdentity.textContent = `${response.data.conversation.ownerEmail} · ${response.data.conversation.id}`;
        renderOverview(response.data);
        buildActionButtons(response.data);
        await showTab(activeTab, { force: true });
        await loadConversations();
    }

    function renderTranscript(messages) {
        const fragment = document.createDocumentFragment();
        for (const message of messages) {
            const article = node('article', `admin-fable-data__message admin-fable-data__message--${message.role}`);
            const head = node('header');
            head.append(
                badge(message.role),
                node('strong', '', `Turn ${message.turnOrder}`),
                badge(message.administrativelyDeleted ? 'Administratively deleted' : message.state, statusTone(message.administrativelyDeleted ? 'deleted' : message.state)),
                node('span', 'admin-fable-data__muted', formatDate(message.createdAt)),
            );
            const content = node('pre', 'admin-fable-data__content');
            content.textContent = message.content;
            const actions = node('div', 'admin-fable-data__row-actions');
            const edit = button('Edit visible content', 'btn-action btn-action--secondary');
            edit.addEventListener('click', () => editMessage(message));
            const inspect = button('Inspect record', 'btn-action btn-action--secondary');
            inspect.addEventListener('click', () => showRawRecord('message', message.id));
            actions.append(edit, inspect, copyButton(message.id));
            if (message.role === 'user') {
                const turnAction = button(message.administrativelyDeleted ? 'Restore complete turn' : 'Delete complete turn', 'btn-action btn-action--secondary');
                turnAction.addEventListener('click', () => turnActionDialog(message));
                actions.append(turnAction);
            }
            article.append(head, content);
            if (message.citations?.length) article.append(sourceList(message.citations));
            article.append(actions);
            fragment.append(article);
        }
        panels.transcript.replaceChildren(fragment);
        if (!messages.length) panels.transcript.append(node('p', 'admin-fable-data__empty', 'No transcript records.'));
    }

    function renderAttempts(attempts) {
        const list = node('div', 'admin-fable-data__record-list');
        for (const attempt of attempts) {
            const web = webSearchDetails(attempt.webSearch);
            const details = node('details', 'admin-fable-data__record');
            const summary = node('summary');
            summary.append(badge(attempt.status, statusTone(attempt.status)), node('strong', '', shortId(attempt.id)), node('span', '', formatDate(attempt.createdAt)));
            details.append(summary, definitionList([
                ['Model', attempt.modelId], ['Effort / preset', `${attempt.effort} / ${attempt.preset}`],
                ['Prompt cache', `${attempt.promptCache?.ttl || '5m'} · v${attempt.promptCache?.version || 1}`],
                ['Web search', attempt.webSearch.enabled ? `${attempt.webSearch.requestCount}/${attempt.webSearch.maxUses} requests` : 'Disabled'],
                ['Search contract', `${web.tool} · ${web.mode} / ${web.inclusion}`],
                ['Search domains / location', `${web.domains} / ${web.location}`],
                ['Provider tool choice', web.toolChoice],
                ['Web fetch', attempt.webFetch?.enabled ? `${attempt.webFetch.requestCount}/${attempt.webFetch.maxUses} requests · ${attempt.webFetch.errorResultCount} errors` : 'Disabled'],
                ['Memory snapshot', `${attempt.memory.mode} · checkpoint v${attempt.memory.checkpointVersion}`],
                ['Context', `${attempt.context.estimatedInputTokens.toLocaleString()} estimated input tokens`],
                ['Stop reason', attempt.stopReason], ['Safe error', attempt.errorCode],
                ['Duration', attempt.providerDurationMs == null ? null : `${attempt.providerDurationMs} ms`],
                ['Private provider blocks', attempt.evidence.privateProviderBlocksPresent ? `${formatBytes(attempt.evidence.privateProviderBytes)} · hidden` : 'None'],
                ['Idempotency evidence', attempt.evidence.idempotencyHashPresent ? 'Present · redacted' : 'Absent'],
            ]));
            const inspect = button('Inspect record', 'btn-action btn-action--secondary');
            inspect.addEventListener('click', () => showRawRecord('turn', attempt.id));
            details.append(inspect);
            list.append(details);
        }
        panels.attempts.replaceChildren(list);
    }

    function renderMemory(checkpoints) {
        const list = node('div', 'admin-fable-data__record-list');
        for (const checkpoint of checkpoints) {
            const record = node('article', 'admin-fable-data__record');
            const head = node('header');
            head.append(
                badge(checkpoint.profile), badge(checkpoint.validForContext ? 'valid' : (checkpoint.invalidation ? 'invalidated' : checkpoint.status), checkpoint.validForContext ? 'active' : 'disabled'),
                node('strong', '', `Checkpoint v${checkpoint.version}`), node('span', 'admin-fable-data__muted', formatDate(checkpoint.createdAt)),
            );
            record.append(head, definitionList([
                ['ID', checkpoint.id], ['Model', checkpoint.modelId],
                ['Coverage', checkpoint.coverageTurnOrder],
                ['Summary estimate', checkpoint.estimatedSummaryTokens == null ? null : `${checkpoint.estimatedSummaryTokens} / ${checkpoint.acceptanceCeiling}`],
                ['Sources', checkpoint.sourceCount], ['Safe error', checkpoint.errorCode],
                ['Provider duration', checkpoint.providerDurationMs == null ? null : `${checkpoint.providerDurationMs} ms`],
            ]));
            const actions = node('div', 'admin-fable-data__row-actions');
            if (checkpoint.status === 'succeeded') {
                const reveal = button('Reveal hidden summary');
                reveal.addEventListener('click', () => revealSummary(checkpoint, record));
                actions.append(reveal);
            }
            if (checkpoint.validForContext) {
                const invalidate = button('Invalidate', 'btn-action btn-action--secondary');
                invalidate.addEventListener('click', () => invalidateCheckpoint(checkpoint));
                actions.append(invalidate);
            }
            const inspect = button('Inspect record', 'btn-action btn-action--secondary');
            inspect.addEventListener('click', () => showRawRecord('checkpoint', checkpoint.id));
            actions.append(inspect, copyButton(checkpoint.id));
            record.append(actions);
            list.append(record);
        }
        panels.memory.replaceChildren(list);
    }

    function renderSearch(data) {
        const fragment = document.createDocumentFragment();
        const conversationWeb = webSearchDetails(data.conversation.webSearch);
        fragment.append(definitionList([
            ['Web search setting', data.conversation.webSearchEnabled ? `Enabled · max ${data.conversation.maxUses}` : 'Disabled'],
            ['Search contract', conversationWeb.tool],
            ['Search mode / inclusion', `${conversationWeb.mode} / ${conversationWeb.inclusion}`],
            ['Search domains / location', `${conversationWeb.domains} / ${conversationWeb.location}`],
            ['Provider tool choice', conversationWeb.toolChoice],
            ['Web fetch setting', data.conversation.webFetchEnabled ? `Enabled · max ${data.conversation.webFetchMaxUses}` : 'Disabled'],
            ['Web fetch tool', `${data.conversation.webFetchToolVersion || 'web_fetch_20260318'} · ${Number(data.conversation.webFetchMaxContentTokens || 8000).toLocaleString()} text tokens`],
            ['Replay pruned through', data.conversation.replayPrunedThroughTurnOrder],
            ['Last pruning', data.conversation.replayPrunedAt ? formatDate(data.conversation.replayPrunedAt) : null],
        ]));
        for (const turn of data.turns || []) {
            const web = webSearchDetails(turn.webSearch);
            const record = node('details', 'admin-fable-data__record');
            const summary = node('summary', '', `${shortId(turn.id)} · ${turn.requestCount}/${turn.maxUses} searches · ${formatDate(turn.createdAt)}`);
            record.append(summary, definitionList([
                ['Tool', web.tool], ['Result count', turn.resultCount],
                ['Effective Search', `${web.mode} / ${web.inclusion}`],
                ['Domains / location', `${web.domains} / ${web.location}`],
                ['Provider tool choice', web.toolChoice],
                ['Web fetch', turn.webFetch?.enabled ? `${turn.webFetch.requestCount}/${turn.webFetch.maxUses} requests · ${turn.webFetch.resultCount} results · ${turn.webFetch.errorResultCount} errors` : 'Disabled'],
                ['Web fetch tool', `${turn.webFetch?.toolVersion || 'web_fetch_20260318'} · ${Number(turn.webFetch?.maxContentTokens || 8000).toLocaleString()} text tokens`],
                ['Fetch pairs pruned', turn.webFetch?.replayPrunedPairCount || 0],
                ['Fetch replay estimate removed', `${Number(turn.webFetch?.replayPrunedEstimatedTokens || 0).toLocaleString()} tokens`],
                ['Pruned pairs', turn.replay.pairCount], ['Estimated provider tokens removed', turn.replay.estimatedTokensRemoved],
            ]));
            if (turn.citations?.length) record.append(sourceList(turn.citations));
            fragment.append(record);
        }
        panels.search.replaceChildren(fragment);
    }

    function renderUsage(entries) {
        const list = node('div', 'admin-fable-data__record-list');
        for (const entry of entries) {
            const record = node('details', 'admin-fable-data__record');
            const summary = node('summary');
            summary.append(badge(entry.status, statusTone(entry.status)), node('strong', '', entry.operationKey), node('span', '', `${entry.units} units · ${formatDate(entry.createdAt)}`));
            record.append(summary, definitionList(Object.entries({
                ID: entry.id, Scope: entry.budgetScope, Route: entry.sourceRoute,
                'Source attempt': entry.sourceAttemptId, Day: entry.windowDay, Month: entry.windowMonth,
            })));
            const pre = node('pre', 'admin-fable-data__json');
            pre.textContent = JSON.stringify(entry.metadata, null, 2);
            record.append(pre, node('p', 'admin-fable-data__notice', 'Immutable accounting evidence.'));
            list.append(record);
        }
        panels.usage.replaceChildren(list);
    }

    async function renderRawRecord(kind = 'conversation', recordId = selected) {
        const response = await apiAdminFableDataRawRecord(selected, kind, recordId);
        if (!response.ok) throw new Error(response.error || 'Raw record unavailable.');
        const note = node('p', 'admin-fable-data__notice', 'Allowlisted Fable-domain columns only. Cryptographic and private provider fields are redacted; no SQL is accepted.');
        const toggle = button('Show UTC timestamps', 'btn-action btn-action--secondary');
        const table = node('dl', 'admin-fable-data__definition-list');
        let useUtc = false;
        const render = () => {
            table.replaceChildren();
            for (const [column, rawValue] of Object.entries(response.data.record || {})) {
                let value = rawValue;
                if (rawValue != null && /(?:^|_)at$/.test(column) && !useUtc) value = formatDate(rawValue);
                else if (rawValue != null && typeof rawValue === 'object') value = JSON.stringify(rawValue, null, 2);
                const wrapper = node('div');
                const term = node('dt');
                term.append(node('strong', '', rawLabel(column)), node('code', '', column));
                const description = node('dd', '', value == null ? 'Null' : value);
                wrapper.append(term, description);
                table.append(wrapper);
            }
            toggle.textContent = useUtc ? 'Show local timestamps' : 'Show UTC timestamps';
        };
        toggle.addEventListener('click', () => { useUtc = !useUtc; render(); });
        render();
        panels.raw.replaceChildren(note, toggle, table);
    }

    async function showRawRecord(kind, recordId) {
        try {
            activeTab = 'raw';
            for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== 'raw';
            refs.tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
                const selectedTab = tab.dataset.fableTab === 'raw';
                tab.setAttribute('aria-selected', selectedTab ? 'true' : 'false');
                tab.tabIndex = selectedTab ? 0 : -1;
            });
            panels.raw.replaceChildren(node('p', 'admin-fable-data__empty', 'Loading record...'));
            await renderRawRecord(kind, recordId);
        } catch (error) {
            panels.raw.replaceChildren(node('p', 'admin-fable-data__empty', error.message));
        }
    }

    function appendPanelPager(name, total, itemCount) {
        if (!(name in detailOffsets)) return;
        const offsetValue = detailOffsets[name];
        const pager = node('nav', 'admin-fable-data__pager');
        pager.setAttribute('aria-label', `${name} pagination`);
        const previous = button('Previous', 'btn-action btn-action--secondary');
        const next = button('Next', 'btn-action btn-action--secondary');
        previous.disabled = offsetValue === 0;
        next.disabled = total == null ? itemCount < DETAIL_PAGE_SIZE : offsetValue + DETAIL_PAGE_SIZE >= total;
        previous.addEventListener('click', () => {
            detailOffsets[name] = Math.max(0, offsetValue - DETAIL_PAGE_SIZE);
            loadTab(name);
        });
        next.addEventListener('click', () => {
            detailOffsets[name] = offsetValue + DETAIL_PAGE_SIZE;
            loadTab(name);
        });
        const totalLabel = total == null ? 'More records may be available' : `${total} records`;
        pager.append(previous, node('span', '', `${offsetValue + 1}-${offsetValue + itemCount} · ${totalLabel}`), next);
        panels[name].append(pager);
    }

    async function loadTab(name) {
        if (!selected || !TAB_LOADERS.has(name)) return;
        panels[name].replaceChildren(node('p', 'admin-fable-data__empty', 'Loading...'));
        const detailOffset = detailOffsets[name] || 0;
        const response = name === 'transcript' ? await apiAdminFableDataTranscript(selected, { limit: DETAIL_PAGE_SIZE, offset: detailOffset })
            : name === 'attempts' ? await apiAdminFableDataAttempts(selected, { limit: DETAIL_PAGE_SIZE, offset: detailOffset })
                : name === 'memory' ? await apiAdminFableDataCheckpoints(selected, { limit: DETAIL_PAGE_SIZE, offset: detailOffset })
                    : name === 'search' ? await apiAdminFableDataWebSearch(selected)
                        : name === 'usage' ? await apiAdminFableDataUsage(selected, { limit: DETAIL_PAGE_SIZE, offset: detailOffset })
                            : null;
        if (name === 'raw') return renderRawRecord();
        if (!response?.ok) throw new Error(response?.error || 'Panel data could not be loaded.');
        if (name === 'transcript') renderTranscript(response.data.messages || []);
        if (name === 'attempts') renderAttempts(response.data.attempts || []);
        if (name === 'memory') renderMemory(response.data.checkpoints || []);
        if (name === 'search') renderSearch(response.data);
        if (name === 'usage') renderUsage(response.data.usage || []);
        const items = name === 'transcript' ? response.data.messages
            : name === 'attempts' ? response.data.attempts
                : name === 'memory' ? response.data.checkpoints
                    : name === 'usage' ? response.data.usage : null;
        if (items) appendPanelPager(name, response.data.total, items.length);
    }

    async function showTab(name, { force = false } = {}) {
        if (!panels[name]) return;
        activeTab = name;
        for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
        refs.tabs.querySelectorAll('[role="tab"]').forEach((tab) => {
            const selectedTab = tab.dataset.fableTab === name;
            tab.setAttribute('aria-selected', selectedTab ? 'true' : 'false');
            tab.tabIndex = selectedTab ? 0 : -1;
        });
        if (force || TAB_LOADERS.has(name)) {
            try { await loadTab(name); } catch (error) {
                panels[name].replaceChildren(node('p', 'admin-fable-data__empty', error.message));
            }
        }
    }

    function closeDialog(value = null) {
        refs.dialog.hidden = true;
        refs.dialog.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        const resolve = dialogResolve;
        dialogResolve = null;
        resolve?.(value);
        dialogReturnFocus?.focus();
        dialogReturnFocus = null;
    }

    function confirmDialog({ title, build, confirmLabel = 'Confirm', danger = false }) {
        dialogReturnFocus = document.activeElement;
        refs.dialogTitle.textContent = title;
        refs.dialogBody.replaceChildren();
        const form = node('div', 'admin-fable-data__dialog-form');
        build(form);
        refs.dialogBody.append(form);
        refs.dialogConfirm.textContent = confirmLabel;
        refs.dialogConfirm.classList.toggle('admin-fable-data__danger', danger);
        refs.dialog.hidden = false;
        refs.dialog.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        (form.querySelector('input, textarea, select') || refs.dialogConfirm).focus();
        return new Promise((resolve) => { dialogResolve = (confirmed) => resolve(confirmed ? form : null); });
    }

    async function reasonDialog(title, description, { typedId = false } = {}) {
        const form = await confirmDialog({
            title, confirmLabel: title, danger: title.toLowerCase().includes('delete') || title.toLowerCase().includes('purge'),
            build(container) {
                container.append(node('p', 'admin-fable-data__notice', description));
                const reason = node('textarea');
                reason.name = 'reason'; reason.maxLength = 500; reason.required = true;
                container.append(makeField('Administrative reason', reason));
                if (typedId) {
                    const confirm = node('input');
                    confirm.name = 'confirmation'; confirm.autocomplete = 'off';
                    container.append(makeField(`Type ${selected} to confirm`, confirm));
                }
            },
        });
        if (!form) return null;
        const reason = form.querySelector('[name="reason"]').value.trim();
        const confirmation = form.querySelector('[name="confirmation"]')?.value || null;
        if (reason.length < 3) { showToast('Administrative reason is required.', 'error'); return null; }
        return { reason, confirmation };
    }

    async function conversationAction(operation) {
        if (!selectedDetail) return;
        let payload;
        if (operation === 'rename') {
            const form = await confirmDialog({ title: 'Rename conversation', build(container) {
                const title = node('input'); title.name = 'title'; title.maxLength = 120; title.value = selectedDetail.conversation.title;
                const reason = node('textarea'); reason.name = 'reason'; reason.maxLength = 500;
                container.append(makeField('Title', title), makeField('Administrative reason', reason));
            } });
            if (!form) return;
            payload = { title: form.querySelector('[name="title"]').value, reason: form.querySelector('[name="reason"]').value };
        } else if (operation === 'settings') {
            const current = selectedDetail.conversation.settings;
            const form = await confirmDialog({ title: 'Update Fable settings', build(container) {
                const effort = node('select'); effort.name = 'effort';
                ['medium', 'high', 'xhigh', 'max'].forEach((value) => { const option = node('option', '', value); option.value = value; option.selected = current.effort === value; effort.append(option); });
                const preset = node('select'); preset.name = 'preset';
                ['general', 'coding', 'creative', 'precise'].forEach((value) => { const option = node('option', '', value); option.value = value; option.selected = current.preset === value; preset.append(option); });
                const memory = node('select'); memory.name = 'memoryMode';
                ['standard', 'lite'].forEach((value) => { const option = node('option', '', value); option.value = value; option.selected = current.memoryMode === value; memory.append(option); });
                const reasoning = node('input'); reasoning.type = 'checkbox'; reasoning.name = 'reasoning'; reasoning.checked = current.reasoningSummaryEnabled;
                const search = node('input'); search.type = 'checkbox'; search.name = 'search'; search.checked = current.webSearchEnabled;
                const fetch = node('input'); fetch.type = 'checkbox'; fetch.name = 'fetch'; fetch.checked = current.webFetchEnabled;
                const reason = node('textarea'); reason.name = 'reason'; reason.maxLength = 500;
                container.append(makeField('Effort', effort), makeField('Preset', preset), makeField('Memory mode', memory), makeField('Reasoning summary', reasoning), makeField('Web search', search), makeField('Web fetch', fetch), makeField('Administrative reason', reason));
            } });
            if (!form) return;
            payload = {
                effort: form.querySelector('[name="effort"]').value,
                preset: form.querySelector('[name="preset"]').value,
                memoryMode: form.querySelector('[name="memoryMode"]').value,
                reasoningSummaryEnabled: form.querySelector('[name="reasoning"]').checked,
                webSearchEnabled: form.querySelector('[name="search"]').checked,
                webFetchEnabled: form.querySelector('[name="fetch"]').checked,
                reason: form.querySelector('[name="reason"]').value,
            };
        } else {
            payload = await reasonDialog(operation === 'restore' ? 'Restore conversation' : 'Soft delete conversation', 'This changes lifecycle visibility but preserves all domain and evidence rows.');
            if (!payload) return;
        }
        payload.operation = operation;
        payload.expectedRevision = selectedDetail.conversation.adminRevisionVersion;
        const response = await apiAdminFableDataConversationMutation(selected, payload, idempotencyKey());
        if (!response.ok) return showToast(response.error || 'Update failed.', 'error');
        showToast('Conversation updated.');
        await selectConversation(selected);
        await loadOverview();
    }

    async function editMessage(message) {
        const form = await confirmDialog({ title: 'Revise visible message', build(container) {
            container.append(node('p', 'admin-fable-data__notice', 'The original message and provider evidence remain immutable. Future context uses this revision.'));
            const content = node('textarea'); content.name = 'content'; content.value = message.content; content.maxLength = 400000;
            const reason = node('textarea'); reason.name = 'reason'; reason.maxLength = 500;
            container.append(makeField('Visible content', content));
            if (message.role === 'assistant') {
                const citations = node('textarea'); citations.name = 'citations'; citations.value = JSON.stringify(message.citations || [], null, 2);
                container.append(makeField('Sanitized citations JSON', citations));
            }
            container.append(makeField('Administrative reason', reason));
        } });
        if (!form) return;
        let citations;
        try { citations = message.role === 'assistant' ? JSON.parse(form.querySelector('[name="citations"]').value) : undefined; }
        catch { return showToast('Citations must be valid JSON.', 'error'); }
        const response = await apiAdminFableDataMessageMutation(selected, message.id, {
            content: form.querySelector('[name="content"]').value,
            citations,
            reason: form.querySelector('[name="reason"]').value,
            expectedRevision: selectedDetail.conversation.adminRevisionVersion,
            expectedMessageRevision: message.revision,
        }, idempotencyKey());
        if (!response.ok) return showToast(response.error || 'Message revision failed.', 'error');
        showToast('Visible message revision recorded.');
        await selectConversation(selected);
    }

    async function turnActionDialog(message) {
        const action = message.administrativelyDeleted ? 'restore' : 'delete';
        const payload = await reasonDialog(`${action === 'delete' ? 'Delete' : 'Restore'} complete turn`, 'Both user and assistant sides are changed together. Original rows and provider/accounting evidence remain immutable.');
        if (!payload) return;
        Object.assign(payload, {
            expectedRevision: selectedDetail.conversation.adminRevisionVersion,
            expectedTurnRevision: message.turnRevision,
        });
        const response = await apiAdminFableDataTurnMutation(selected, message.turnId, action, payload, idempotencyKey());
        if (!response.ok) return showToast(response.error || 'Turn update failed.', 'error');
        showToast(`Complete turn ${action} recorded.`);
        await selectConversation(selected);
    }

    async function invalidateCheckpoint(checkpoint) {
        const payload = await reasonDialog('Invalidate checkpoint', 'The summary remains immutable evidence but will no longer be selected for future context. No provider call is triggered.');
        if (!payload) return;
        payload.expectedRevision = selectedDetail.conversation.adminRevisionVersion;
        const response = await apiAdminFableDataCheckpointInvalidate(selected, checkpoint.id, payload, idempotencyKey());
        if (!response.ok) return showToast(response.error || 'Checkpoint invalidation failed.', 'error');
        showToast('Checkpoint invalidated.');
        await selectConversation(selected);
    }

    async function revealSummary(checkpoint, record) {
        const accepted = await confirmDialog({
            title: 'Reveal hidden summary',
            confirmLabel: 'Reveal summary',
            build(container) {
                container.append(node('p', 'admin-fable-data__notice', 'Hidden memory may contain sensitive conversation data. It is loaded only after confirmation, is never persisted by this browser, and should be hidden when no longer needed.'));
            },
        });
        if (!accepted) return;
        const response = await apiAdminFableDataRevealSummary(selected, checkpoint.id);
        if (!response.ok) return showToast(response.error || 'Summary unavailable.', 'error');
        const holder = node('section', 'admin-fable-data__revealed');
        holder.append(node('strong', '', 'Hidden summary (sensitive)'));
        const pre = node('pre', 'admin-fable-data__content'); pre.textContent = response.data.summary;
        const hide = button('Hide summary', 'btn-action btn-action--secondary');
        hide.addEventListener('click', () => holder.remove());
        holder.append(pre, hide);
        record.append(holder);
        hide.focus();
    }

    async function purgeConversation() {
        const payload = await reasonDialog('Permanent purge', 'This deletes only the selected conversation domain graph through foreign-key cascades. External audit and accounting evidence remain retained.', { typedId: true });
        if (!payload) return;
        payload.expectedRevision = selectedDetail.conversation.adminRevisionVersion;
        const response = await apiAdminFableDataPurge(selected, payload, idempotencyKey());
        if (!response.ok) return showToast(response.error || 'Permanent purge failed.', 'error');
        showToast('Conversation permanently purged.');
        selected = null; selectedDetail = null;
        refs.detailContent.hidden = true; refs.detailEmpty.hidden = false;
        await Promise.all([loadOverview(), loadConversations()]);
    }

    async function openWorkspace() {
        open = true;
        refs.card.hidden = true;
        refs.workspace.hidden = false;
        document.querySelector('#sectionAiLab > .admin-ai')?.setAttribute('hidden', '');
        document.querySelectorAll('#sectionAiLab > .admin-ai__panel, #aiLabSavedAssets').forEach((panel) => { panel.hidden = true; });
        refs.close.focus();
        await Promise.all([loadOverview(), loadConversations()]);
    }

    function closeWorkspace() {
        open = false;
        refs.workspace.hidden = true;
        refs.card.hidden = false;
        document.querySelector('#sectionAiLab > .admin-ai')?.removeAttribute('hidden');
        onClose?.();
        refs.open.focus();
    }

    function bind() {
        if (bound || !refs.card) return;
        bound = true;
        refs.open.addEventListener('click', openWorkspace);
        refs.close.addEventListener('click', closeWorkspace);
        refs.refresh.addEventListener('click', () => Promise.all([loadOverview(), loadConversations(), selected ? selectConversation(selected) : null]));
        refs.filters.addEventListener('submit', (event) => { event.preventDefault(); offset = 0; loadConversations(); });
        for (const input of [refs.search, refs.owner, refs.errorCategory]) {
            input.addEventListener('input', () => {
                window.clearTimeout(filterTimer);
                filterTimer = window.setTimeout(() => { offset = 0; loadConversations(); }, 300);
            });
        }
        refs.previous.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); loadConversations(); });
        refs.next.addEventListener('click', () => { if (offset + PAGE_SIZE < total) { offset += PAGE_SIZE; loadConversations(); } });
        refs.tabs.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-fable-tab]');
            if (tab) showTab(tab.dataset.fableTab);
        });
        refs.tabs.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            const tabs = [...refs.tabs.querySelectorAll('[role="tab"]')];
            const index = tabs.indexOf(document.activeElement);
            const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.focus(); next.click(); event.preventDefault();
        });
        refs.dialogConfirm.addEventListener('click', () => closeDialog(true));
        refs.dialogCancel.addEventListener('click', () => closeDialog(null));
        refs.dialogClose.addEventListener('click', () => closeDialog(null));
        refs.dialog.querySelector('[data-fable-dialog-close]').addEventListener('click', () => closeDialog(null));
        refs.dialog.addEventListener('keydown', (event) => {
            if (event.key !== 'Tab' || refs.dialog.hidden) return;
            const controls = [...refs.dialog.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')]
                .filter((control) => !control.disabled && control.getClientRects().length);
            if (!controls.length) return;
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
            else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
        });
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !refs.dialog.hidden) closeDialog(null); });
    }

    function show() {
        bind();
        if (!open) loadOverview();
    }

    return { bind, show, close: closeWorkspace };
}
