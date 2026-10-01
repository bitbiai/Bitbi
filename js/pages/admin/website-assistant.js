import { apiAdminWebsiteAssistant, apiAdminWebsiteAssistantSave, apiAdminWebsiteAssistantRestore, apiAdminWebsiteAssistantCheck } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

const MODES = { off: 'Off', admin: 'Admin test', public: 'Public' };
const STATES = { off: 'Public inference is off', blocked: 'Activation blocked', admin: 'Admin testing only', public: 'Public inference available', budget_paused: 'Paused by a usage or spending limit' };
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('en-GB').format(value) : 'Unknown';
const money = value => Number.isFinite(value) ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(value / 1e6) : 'Unknown';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB') : 'Not recorded';
const clone = value => structuredClone(value);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const text = value => typeof value === 'string' ? value : 'Unknown';
const button = (label, action) => { const node = el('button', 'btn-action', label); node.type = 'button'; node.addEventListener('click', action); return node; };
const fields = entries => { const dl = el('dl', 'assistant-admin__facts'); for (const [label, value] of entries) dl.append(el('dt', '', label), el('dd', '', value)); return dl; };
const valid = data => data?.ok === true && Number.isSafeInteger(data.config?.revision) && data.config.revision >= 0
    && Object.hasOwn(MODES, data.config?.settings?.mode) && typeof data.config.settings.model === 'string'
    && Array.isArray(data.config.settings.pages) && Array.isArray(data.config.settings.languages)
    && data.config.settings.greeting && typeof data.config.settings.greeting.en === 'string' && typeof data.config.settings.greeting.de === 'string'
    && Object.hasOwn(STATES, data.runtime?.effectiveMode) && Array.isArray(data.runtime.blockers)
    && typeof data.runtime.publicReady === 'boolean' && typeof data.runtime.adminReady === 'boolean' && typeof data.runtime.adminTestReady === 'boolean'
    && ['outputTokens', 'dailyRequests', 'requestsPerMinute', 'concurrentRequests'].every(key => Number.isSafeInteger(data.config.constraints?.[key]) && data.config.constraints[key] > 0)
    && data.connection && Array.isArray(data.knowledge?.topics) && Array.isArray(data.knowledge.pages) && Array.isArray(data.audit);

function sourceLink(url, label) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'bitbi.ai' || parsed.username || parsed.password || parsed.port) return el('span', '', 'Source unavailable');
        const node = el('a', '', label); node.href = parsed.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
    } catch { return el('span', '', 'Source unavailable'); }
}

export function createAdminWebsiteAssistant() {
    const root = document.getElementById('sectionWebsiteAssistant');
    let data = null, draft = null, controller = null, testController = null, expiry = null;
    let busy = false, uncertain = false, stale = false, status, savedLabel, saveButton, recoverButton, deactivateButton, refreshButton;
    let formControls = [], modeControls = [], testButton, cancelTestButton, checkButton;
    let previewLanguage = 'en', previewPage = 'home';
    const dirty = () => data && JSON.stringify(draft) !== JSON.stringify(data.config.settings);
    const safeToEdit = () => data && !busy && !uncertain && !stale;
    const notice = (message, error = false) => { if (!status) return; status.textContent = message; status.setAttribute('role', error ? 'alert' : 'status'); status.dataset.error = String(error); };
    const focusNotice = () => status?.focus();

    function updateControls() {
        if (!data) return;
        savedLabel.textContent = uncertain ? 'Save not confirmed — refresh required' : stale ? 'Status needs refreshing' : busy ? 'Working…' : dirty() ? 'Unsaved changes' : `Saved · revision ${data.config.revision}`;
        savedLabel.dataset.state = dirty() || uncertain || stale ? 'pending' : 'saved';
        saveButton.disabled = !safeToEdit() || !dirty();
        recoverButton.disabled = !safeToEdit() || !data.config.previousAvailable;
        deactivateButton.disabled = busy || data.config.settings.mode === 'off';
        refreshButton.disabled = busy;
        checkButton.disabled = busy;
        testButton.disabled = !safeToEdit() || !data.runtime.adminTestReady || dirty() || !!testController;
        cancelTestButton.hidden = !testController;
        for (const input of formControls) input.disabled = !safeToEdit();
        for (const input of modeControls) {
            input.disabled = !safeToEdit() || (input.value === 'admin' && !data.runtime.adminReady) || (input.value === 'public' && !data.runtime.publicReady);
        }
    }
    function section(title, id, description) {
        const node = el('section', 'assistant-admin__card'); node.id = `assistant-${id}`;
        const heading = el('h3', '', title); heading.id = `${node.id}-title`; node.setAttribute('aria-labelledby', heading.id); node.append(heading);
        if (description) node.append(el('p', 'assistant-admin__muted', description)); return node;
    }
    function field(label, key, { type = 'text', min, max, step, options, path, placeholder } = {}) {
        const wrap = el('div', 'assistant-admin__field'); const id = `assistant-setting-${key}${path ? `-${path}` : ''}`;
        const title = el('label', '', label); title.htmlFor = id;
        const input = el(options ? 'select' : type === 'textarea' ? 'textarea' : 'input'); input.id = id;
        if (options) for (const choice of options) { const option = el('option', '', choice.label); option.value = choice.value; option.disabled = choice.disabled === true; input.append(option); }
        else if (type !== 'textarea') input.type = type;
        if (min !== undefined) input.min = String(min); if (max !== undefined) { if (type === 'number') input.max = String(max); else input.maxLength = max; }
        if (step !== undefined) input.step = String(step);
        if (placeholder) input.placeholder = placeholder;
        const value = path ? draft[key][path] : draft[key]; input.value = value === null ? '' : String(value);
        input.addEventListener('input', () => {
            const value = type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
            if (path) draft[key][path] = value; else draft[key] = value;
            notice(''); updateControls();
        });
        formControls.push(input); wrap.append(title, input); return wrap;
    }
    function choices(label, key, options) {
        const group = el('fieldset', 'assistant-admin__choices'); group.append(el('legend', '', label)); const inputs = [];
        for (const option of options) {
            const item = el('label', 'assistant-admin__choice'); const input = el('input'); input.type = 'checkbox'; input.value = option.id;
            input.checked = draft[key].includes(option.id);
            inputs.push(input);
            input.addEventListener('change', () => { draft[key] = inputs.filter(entry => entry.checked).map(entry => entry.value); notice(''); updateControls(); });
            item.append(input, el('span', '', option.label)); group.append(item); formControls.push(input);
        }
        return group;
    }
    function overview() {
        const card = section('Overview', 'overview'); const state = el('div', 'assistant-admin__state'); state.dataset.mode = data.runtime.effectiveMode;
        state.append(el('span', 'assistant-admin__eyebrow', `Saved intent: ${MODES[data.config.settings.mode]}`), el('h4', '', stale ? 'Current availability unknown' : STATES[data.runtime.effectiveMode]));
        state.append(el('p', '', text(data.runtime.deactivation)));
        card.append(state);
        const blockers = el('ul', 'assistant-admin__blockers');
        for (const blocker of data.runtime.blockers) { const item = el('li', '', text(blocker.message)); item.dataset.code = String(blocker.code || 'unknown'); blockers.append(item); }
        if (blockers.childElementCount) card.append(el('h4', '', 'Activation blockers'), blockers);
        else card.append(el('p', 'assistant-admin__muted', 'No readiness blocker is recorded in this snapshot. Current server checks still apply to every request.'));
        const mode = el('fieldset', 'assistant-admin__modes'); mode.append(el('legend', '', 'Requested mode'));
        for (const [value, label] of Object.entries(MODES)) {
            const item = el('label'); const input = el('input'); input.type = 'radio'; input.name = 'assistant-mode'; input.value = value; input.checked = draft.mode === value;
            input.addEventListener('change', () => { draft.mode = value; notice(value === 'off' ? 'Save changes to turn inference off.' : 'Save changes to request this mode. The server verifies all activation gates.'); updateControls(); });
            modeControls.push(input); item.append(input, el('span', '', label)); mode.append(item);
        }
        card.append(mode, el('p', 'assistant-admin__muted', 'Admin test can make billable requests and needs its own approved budget. Public additionally requires recorded real German and English acceptance.'));
        deactivateButton = button('Turn inference off now', deactivate); deactivateButton.classList.add('assistant-admin__off'); card.append(deactivateButton); return card;
    }
    function connection() {
        const card = section('Connection & model', 'connection', 'Configuration presence is not a successful connection test. There is no automatic model fallback.');
        const c = data.connection; const real = c.lastSuccessfulInference?.evidence === 'real' ? c.lastSuccessfulInference : null;
        card.append(fields([
            ['Provider', text(c.provider)], ['Selected model', text(data.config.settings.model)], ['Request route', text(c.route)],
            ['Workers AI binding', c.bindingPresent === true ? 'Present — not an entitlement check' : c.bindingPresent === false ? 'Missing' : 'Unknown'],
            ['Model access', c.access?.state === 'verified' ? `Recorded as verified · ${date(c.access.verifiedAt)}` : 'Unverified'],
            ['Last genuine successful inference', real ? `${date(real.at)} · ${real.model}` : 'Not recorded'],
        ]));
        if (c.syntheticEvidencePresent || (c.lastSuccessfulInference && !real)) card.append(el('p', 'assistant-admin__muted', 'Synthetic or unclassified evidence is not a live connection result. No genuine inference is established by that evidence.'));
        card.append(el('p', 'assistant-admin__muted', 'Server-side binding; no credential values are shown. Direct Workers AI, without an AI Gateway. European model origin does not imply EU-only processing.'));
        return card;
    }
    function usage() {
        const card = section('Usage & costs', 'usage', 'The assistant’s durable accounting only. No conversation history, provider invoice totals or other BITBI AI traffic.');
        const u = data.usage || {}; card.append(el('p', 'assistant-admin__muted', `Snapshot: ${date(u.observedAt)} · Last activity: ${date(u.lastActivity)}`));
        const grid = el('div', 'assistant-admin__metrics');
        for (const [key, title] of [['daily', 'Today · UTC'], ['monthly', 'This month · UTC']]) {
            const values = u[key] || {}; const column = el('div', 'assistant-admin__metric'); column.append(el('h4', '', title));
            column.append(fields([
                ['Provider requests admitted', number(values.requests)], ['Completed', u.statisticsCoverage === 'partial-legacy-metrics' ? 'Unknown — partial historical coverage' : number(values.completed)], ['Failed', u.statisticsCoverage === 'partial-legacy-metrics' ? 'Unknown — partial historical coverage' : number(values.failed)],
                ['Cancelled / outcome unknown', u.statisticsCoverage === 'partial-legacy-metrics' ? 'Unknown — partial historical coverage' : `${number(values.cancelled)} / ${number(values.unknown)}`],
                ['Measured input / output tokens', values.measuredRequests > 0 ? `${number(values.inputTokens)} / ${number(values.outputTokens)}` : 'Unknown — no measured sample'],
                ['Mean recorded latency', values.latencySamples > 0 ? `${number(Math.round(values.latencyMs / values.latencySamples))} ms · ${number(values.latencySamples)} samples` : 'Unknown — no measured sample'],
                ['Budget consumed or reserved', money(values.chargedMicros)],
                ['Estimated measured inference cost', values.measuredRequests > 0 ? money(values.measuredMicros) : 'Unknown — no measured sample'],
                ['Approved operating cap', money(u.limits?.[key === 'daily' ? 'dailyUsdMicros' : 'monthlyUsdMicros'])],
            ])); grid.append(column);
        }
        card.append(grid, fields([['Requests currently reserved', number(u.activeRequests)], ['Provider-billed total', money(u.providerBilledMicros)]]));
        card.append(el('p', 'assistant-admin__muted', text(u.coverage)));
        if (u.statisticsCoverage === 'partial-legacy-metrics') card.append(el('p', 'assistant-admin__muted', 'Historical counters have partial coverage. Missing prior measurements are not zero usage.'));
        const rates = data.connection.rates;
        card.append(el('p', 'assistant-admin__muted', rates && data.connection.ratesStatus === 'verified'
            ? `Verified rates per million tokens: input ${money(rates.inputUsdMicrosPerMillion)}, output ${money(rates.outputUsdMicrosPerMillion)}. Rate evidence: ${date(rates.verifiedAt)}. Valid until: ${date(rates.validUntil)}.`
            : data.connection.ratesStatus === 'expired' ? 'Recorded inference prices have expired. Current rates are unknown; refresh the approved pricing evidence before activation.'
                : 'Inference rates are unknown. Missing prices do not mean free.'));
        card.append(el('p', 'assistant-admin__muted', 'Budget reservations are conservative and include unknown provider outcomes; they are not billed totals. Retrieval and stored suggestions make no model calls. Shared Worker and Durable Object infrastructure charges are not included here.'));
        return card;
    }
    function settings() {
        const card = section('Settings', 'settings', 'Presentation and operating limits. Approval evidence, security rules and provider instructions cannot be edited here.');
        const form = el('form', 'assistant-admin__form'); form.addEventListener('submit', event => { event.preventDefault(); save(); });
        const models = (data.connection.models || []).map(model => ({ value: model.id, label: `${model.label || model.id}${model.selectable ? '' : ' — approval required'}`, disabled: !model.selectable && model.id !== draft.model }));
        if (!models.some(model => model.value === draft.model)) models.unshift({ value: draft.model, label: draft.model });
        const grid = el('div', 'assistant-admin__form-grid');
        grid.append(field('Model', 'model', { options: models }), field('Answer tone', 'tone', { options: ['concise', 'friendly', 'neutral'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }),
            field('Maximum answer tokens', 'outputTokens', { type: 'number', min: 1, max: data.config.constraints.outputTokens, step: 1 }),
            field('Provider requests per day', 'dailyRequests', { type: 'number', min: 1, max: data.config.constraints.dailyRequests, step: 1 }),
            field('Requests per visitor per minute', 'requestsPerMinute', { type: 'number', min: 1, max: data.config.constraints.requestsPerMinute, step: 1 }),
            field('Concurrent provider requests', 'concurrentRequests', { type: 'number', min: 1, max: data.config.constraints.concurrentRequests, step: 1 }));
        form.append(grid);
        const budgets = el('details', 'assistant-admin__disclosure'); budgets.append(el('summary', '', 'Operating spending caps'));
        budgets.append(el('p', 'assistant-admin__muted', 'USD micro-units: 1,000,000 = $1. Caps may only reduce a recorded approval. Empty uses the source-approved ceiling, if one exists. Without a recorded approval, inference stays blocked.'));
        const budgetFields = el('div', 'assistant-admin__form-grid'); budgetFields.append(
            field('Daily cap (USD micro-units)', 'dailyUsdMicros', { type: 'number', min: 1, max: 100000000, step: 1, placeholder: 'Use approved ceiling, if any' }),
            field('Monthly cap (USD micro-units)', 'monthlyUsdMicros', { type: 'number', min: 1, max: 1000000000, step: 1, placeholder: 'Use approved ceiling, if any' })); budgets.append(budgetFields); form.append(budgets);
        const greetings = el('div', 'assistant-admin__form-grid'); greetings.append(field('English greeting / help text', 'greeting', { type: 'textarea', path: 'en', max: 240 }), field('German greeting / help text', 'greeting', { type: 'textarea', path: 'de', max: 240 })); form.append(greetings);
        form.append(choices('Enabled languages', 'languages', [{ id: 'en', label: 'English' }, { id: 'de', label: 'Deutsch' }]), choices('Eligible public page contexts', 'pages', data.knowledge.pages));
        const suggestionLabel = el('label', 'assistant-admin__choice'); const input = el('input'); input.type = 'checkbox'; input.checked = draft.suggestionsEnabled;
        input.addEventListener('change', () => { draft.suggestionsEnabled = input.checked; notice(''); updateControls(); }); formControls.push(input);
        suggestionLabel.append(input, el('span', '', 'Show three grounded contextual suggestions')); form.append(suggestionLabel, el('p', 'assistant-admin__muted', 'Viewing a page, refreshing suggestions or previewing knowledge never invokes the model. Suggestions update with the approved knowledge version.'));
        card.append(form); return card;
    }
    function knowledge() {
        const card = section('Knowledge & capabilities', 'knowledge'); const kb = data.knowledge;
        card.append(fields([['Knowledge version', text(kb.version)], ['Languages', (kb.languages || []).join(', ')], ['Approved topics', number(kb.topics.length)], ['Dated review evidence', date(kb.reviewedAt)]]));
        card.append(el('p', 'assistant-admin__muted', 'Implemented: page-aware public help, bounded retrieval, source links, streaming, cancellation and stored suggestions. Live answer quality remains unverified until genuine German and English model acceptance is recorded.'));
        card.append(el('p', 'assistant-admin__muted', 'No access to private account contents, assets, balances, jobs or administration; no autonomous actions. Provider-advertised vision and function calling are not assistant capabilities.'));
        const tools = el('div', 'assistant-admin__preview-tools'); const language = el('select'); language.setAttribute('aria-label', 'Knowledge preview language');
        for (const [value, title] of [['en', 'English'], ['de', 'Deutsch']]) { const option = el('option', '', title); option.value = value; language.append(option); } language.value = previewLanguage;
        const page = el('select'); page.setAttribute('aria-label', 'Suggestion page context');
        for (const entry of kb.pages) { const option = el('option', '', entry.label); option.value = entry.id; page.append(option); }
        if (!kb.pages.some(entry => entry.id === previewPage)) previewPage = kb.pages[0]?.id || '';
        page.value = previewPage; tools.append(language, page); const preview = el('div', 'assistant-admin__preview');
        const topics = el('div', 'assistant-admin__topics');
        function updatePreview() {
            preview.replaceChildren(el('h4', '', 'Suggested questions')); const list = el('ol');
            for (const item of kb.suggestions?.[previewPage]?.[previewLanguage] || []) list.append(el('li', '', item.question));
            preview.append(list.childElementCount ? list : el('p', '', 'No approved suggestions available for this context.'));
            topics.replaceChildren();
            for (const topic of kb.topics) {
                const content = topic[previewLanguage]; if (!content) continue;
                const item = el('details', 'assistant-admin__topic'); item.append(el('summary', '', content.title), el('p', '', content.text), sourceLink(content.url, 'Approved BITBI source')); topics.append(item);
            }
        }
        language.addEventListener('change', () => { previewLanguage = language.value; updatePreview(); }); page.addEventListener('change', () => { previewPage = page.value; updatePreview(); }); updatePreview();
        const corpus = el('details', 'assistant-admin__disclosure'); corpus.append(el('summary', '', 'Preview approved topics'), topics);
        card.append(tools, preview, corpus);
        const maintenance = el('details', 'assistant-admin__disclosure'); maintenance.append(el('summary', '', 'Update and recover approved knowledge'), el('p', '', 'Knowledge is maintained with BITBI’s existing source-controlled content and release process. Edit the bilingual approved topics or suggestion mapping, review source anchors, refresh the knowledge version and preview it here on the candidate. Publish through the protected release. To recover an earlier version, restore the reviewed content in source and publish a new release; never replace a past receipt.'), el('p', 'assistant-admin__muted', 'No separate CMS or automatic public crawl. Internal notes and private content are not knowledge sources. Configuration recovery below does not roll back the deployed knowledge version.')); card.append(maintenance); return card;
    }
    function diagnostics() {
        const card = section('Diagnostics & change history', 'diagnostics', 'Configuration checks are free of inference. A real-response test is a separate, potentially billable action.');
        const lastError = data.usage?.lastError;
        card.append(fields([['Last technical error', lastError && ['provider_error', 'request_cancelled_or_timeout'].includes(lastError.code) ? `${lastError.code} · ${date(lastError.at)} · ${lastError.evidence === 'real' ? 'real request' : 'synthetic or unclassified evidence'}` : 'Not recorded']]));
        checkButton = button('Check configuration · no inference', check); card.append(checkButton);
        const controls = el('div', 'assistant-admin__test'); const lang = el('select'); lang.setAttribute('aria-label', 'Real-response test language');
        for (const value of data.config.settings.languages) { const option = el('option', '', value === 'de' ? 'Deutsch' : 'English'); option.value = value; lang.append(option); }
        testButton = button('Run real-response test · may incur cost', () => testResponse(lang.value));
        cancelTestButton = button('Cancel real-response test', () => testController?.abort()); controls.append(lang, testButton, cancelTestButton);
        card.append(controls, el('p', 'assistant-admin__muted', 'Requires saved Admin test or Public mode, verified access and terms, prices and an approved test budget. Uses one fixed public-help question. No prompt or response is logged or retained here. A successful test alone does not activate public access.'));
        const audit = el('details', 'assistant-admin__disclosure'); audit.append(el('summary', '', `Configuration history · ${data.audit.length} recorded changes`));
        const list = el('ol', 'assistant-admin__audit');
        for (const entry of data.audit) { const item = el('li'); item.append(el('strong', '', `Revision ${number(entry.revision)} · ${text(entry.action)}`), el('span', '', `${date(entry.at)} · ${text(entry.actor)}`), el('span', 'assistant-admin__muted', `Changed: ${Array.isArray(entry.changed) ? entry.changed.join(', ') : 'Unknown'}`)); list.append(item); }
        audit.append(list.childElementCount ? list : el('p', 'assistant-admin__muted', 'No configuration changes recorded.'));
        card.append(audit); return card;
    }
    function render() {
        formControls = []; modeControls = []; root.replaceChildren();
        const header = el('div', 'assistant-admin__header'); const heading = el('div'); heading.append(el('p', 'assistant-admin__eyebrow', 'WEBSITE HELP'), el('p', 'assistant-admin__intro', 'Useful answers. Explicit permissions. Controlled spending.'));
        savedLabel = el('p', 'assistant-admin__saved'); savedLabel.setAttribute('role', 'status'); heading.append(savedLabel);
        refreshButton = button('Refresh status', refresh); header.append(heading, refreshButton); root.append(header);
        const nav = el('nav', 'assistant-admin__sections'); nav.setAttribute('aria-label', 'Assistant controls');
        for (const [id, label] of [['overview', 'Overview'], ['connection', 'Connection'], ['usage', 'Usage'], ['settings', 'Settings'], ['knowledge', 'Knowledge'], ['diagnostics', 'Diagnostics']]) {
            const link = el('button', '', label); link.type = 'button'; link.addEventListener('click', () => { const target = root.querySelector(`#assistant-${id}`); target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }); }); nav.append(link);
        }
        root.append(nav, overview());
        const columns = el('div', 'assistant-admin__columns'); columns.append(connection(), usage()); root.append(columns, settings(), knowledge(), diagnostics());
        const footer = el('div', 'assistant-admin__savebar');
        status = el('p', 'assistant-admin__notice'); status.tabIndex = -1; status.setAttribute('role', 'status');
        const actions = el('div', 'assistant-admin__actions'); saveButton = button('Save changes', save); saveButton.classList.add('assistant-admin__primary');
        const discardButton = button('Discard draft', () => { if (!busy) { draft = clone(data.config.settings); render(); notice('Draft discarded. Saved settings are unchanged.'); focusNotice(); } });
        recoverButton = button('Restore previous settings with inference off', restore); actions.append(saveButton, discardButton, recoverButton);
        footer.append(status, actions, el('p', 'assistant-admin__muted', `Last saved: ${date(data.config.updatedAt)}. Changes apply only after server confirmation.`)); root.append(footer); updateControls();
    }
    function accept(next) {
        data = next; draft = clone(next.config.settings); uncertain = false; stale = false; clearTimeout(expiry);
        // This is a snapshot, not monitoring. Expiry never performs another request.
        expiry = setTimeout(() => { stale = true; if (!data) return; updateControls(); const title = root.querySelector('.assistant-admin__state h4'); if (title) title.textContent = 'Status needs refreshing'; notice('This snapshot is more than five minutes old. Refresh before changing configuration.'); }, 300000);
    }
    async function load() {
        controller?.abort(); testController?.abort(); testController = null; controller = new AbortController(); const active = controller;
        busy = true; root.replaceChildren(el('p', 'assistant-admin__notice', 'Loading assistant controls…'));
        const result = await apiAdminWebsiteAssistant({ signal: active.signal, timeoutMs: 15000 });
        if (active.signal.aborted || controller !== active) return;
        busy = false;
        if (!result.ok || !valid(result.data)) {
            data = null; draft = null;
            const message = el('p', 'assistant-admin__notice', [401, 403, 428].includes(result.status) ? 'Admin authorization or MFA could not be confirmed. Reopen Admin after signing in.' : 'Assistant configuration is unavailable or invalid. Inference availability is unknown; no connection is verified here.'); message.setAttribute('role', 'alert');
            root.replaceChildren(message, button('Retry loading controls', load)); return;
        }
        accept(result.data); render();
    }
    async function refresh() {
        if (busy || (dirty() && !window.confirm('Discard your unsaved assistant settings and load the current configuration?'))) return;
        await load();
    }
    async function mutate(operation, message) {
        if (busy || !data) return;
        busy = true; updateControls(); notice('Saving…');
        const active = controller; const priorRevision = data.config.revision;
        const result = await operation({ signal: active.signal, timeoutMs: 15000 });
        if (active.signal.aborted || controller !== active) return;
        busy = false;
        if (!result.ok || !valid(result.data) || result.data.config.revision <= priorRevision) {
            uncertain = true; updateControls(); notice(result.status === 409 ? 'Another administrator saved newer settings. Your draft is preserved. Refresh and review the current configuration before trying again.' : 'The change was not confirmed. Your draft is preserved. Refresh to reconcile the saved state before another change.', true); focusNotice(); return;
        }
        accept(result.data); render(); notice(message); focusNotice();
    }
    async function save() {
        if (!safeToEdit() || !dirty()) return;
        const form = root.querySelector('form'); if (!form.reportValidity()) return;
        const settings = clone(draft);
        await mutate(options => apiAdminWebsiteAssistantSave({ revision: data.config.revision, settings }, options), 'Settings saved. The server continues to enforce access, approval and durable usage limits.');
    }
    async function deactivate() {
        if (busy || !data || data.config.settings.mode === 'off') return;
        testController?.abort();
        const settings = { ...clone(data.config.settings), mode: 'off' };
        await mutate(options => apiAdminWebsiteAssistantSave({ revision: data.config.revision, settings }, options), 'Inference switched off. New public requests are blocked; existing provider work may still finish.');
    }
    async function restore() {
        if (!safeToEdit() || !data.config.previousAvailable || !window.confirm('Restore the previous settings and keep inference off? Your current draft will be replaced.')) return;
        await mutate(options => apiAdminWebsiteAssistantRestore({ revision: data.config.revision }, options), 'Previous settings restored with inference off. Usage and spending history were not reset.');
    }
    async function check() {
        if (busy) return;
        busy = true; updateControls(); const active = controller;
        const result = await apiAdminWebsiteAssistantCheck({ signal: active.signal, timeoutMs: 15000 });
        if (active.signal.aborted || controller !== active) return;
        busy = false;
        if (!result.ok || !valid(result.data) || result.data.check?.inferencePerformed !== false) { stale = true; updateControls(); notice('Configuration check is unavailable. No verified connection can be inferred. Refresh before making changes.', true); return; }
        if (result.data.config.revision !== data.config.revision) { stale = true; updateControls(); notice('Configuration changed since this draft was loaded. Refresh to review the new revision.', true); return; }
        const keptDraft = draft; accept(result.data); draft = keptDraft; render(); notice(`Configuration checked at ${date(result.data.check.checkedAt)}. No inference was performed. ${data.runtime.blockers.length} activation blocker(s).`); focusNotice();
    }
    async function testResponse(locale) {
        if (!safeToEdit() || !data.runtime.adminTestReady || dirty() || testController) return;
        if (!window.confirm('Run one real provider response using the approved test budget? This may incur a charge even if cancelled.')) return;
        const active = new AbortController(); testController = active; updateControls(); notice('Running one real-response test. No automatic retry.');
        const timeout = setTimeout(() => active.abort(), 35000); let reader;
        try {
            const response = await fetch('/api/admin/website-assistant/acceptance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: active.signal, body: JSON.stringify({ page: data.config.settings.pages.includes('home') ? 'home' : data.config.settings.pages[0], locale, contentVersion: data.knowledge.version, message: locale === 'de' ? 'Wie starte ich einen Canvas-Workflow?' : 'How do I start a Canvas workflow?', history: [] }) });
            if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw Error('test_unavailable');
            reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '', bytes = 0, complete = false;
            while (true) {
                const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 160000) throw Error('test_invalid');
                pending += decoder.decode(chunk.value, { stream: true });
                let end; while ((end = pending.indexOf('\n\n')) !== -1) {
                    const frame = pending.slice(0, end); pending = pending.slice(end + 2);
                    const kind = frame.match(/^event: (\w+)$/m)?.[1]; if (kind === 'error') throw Error('test_provider_error');
                    if (kind === 'done') { const value = JSON.parse(frame.match(/^data: (.+)$/m)?.[1] || '{}'); if (value.grounded !== true) throw Error('test_ungrounded'); complete = true; }
                }
            }
            if (!complete) throw Error('test_incomplete');
            if (testController === active) notice('One genuine provider response completed. Its answer quality still requires review; this does not record EN/DE acceptance or activate public inference. Refresh to read server-recorded usage.');
        } catch {
            if (testController === active) notice(active.signal.aborted ? 'Test cancelled or timed out. The provider outcome and any charge may be unknown. Do not replay automatically; refresh usage first.' : 'The real-response test did not complete successfully. Access, budget or provider availability may have changed. No retry was sent.', true);
        } finally { clearTimeout(timeout); void reader?.cancel().catch(() => {}); if (testController === active) { testController = null; updateControls(); focusNotice(); } }
    }
    function hide() { controller?.abort(); testController?.abort(); testController = null; clearTimeout(expiry); busy = false; data = null; draft = null; root.replaceChildren(); }
    return { load, hide, destroy: hide };
}
