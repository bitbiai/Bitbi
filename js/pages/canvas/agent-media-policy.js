import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { canvasNotice } from './notifications.js?v=__ASSET_VERSION__';
import { canvasMediaPolicyCopy } from './agent-media-policy-copy.js?v=__ASSET_VERSION__';

const create = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (label, action, className = '') => { const node = create('button', `canvas-button ${className}`, label); node.type = 'button'; node.addEventListener('click', action); return node; };
const count = value => Number.isSafeInteger(value) && value >= 0;
const kinds = ['image', 'video', 'music'];

// Presentation owns only an editable draft. The project API owns the policy,
// revision and cumulative commitments; no local preference grants authority.
export function createCanvasMediaPolicy({ german, header, onSaved = () => {} }) {
    const copy = canvasMediaPolicyCopy(german), summaries = [], rows = new Map(), formatter = new Intl.NumberFormat(german ? 'de-DE' : 'en-US');
    let projectId = null, epoch = 0, snapshot = null, draft = null, loading = false, saving = false, pending = null, stale = false, visible = false, opener = null, category = 'all', latestPolicy = null, refreshAfterLoad = false;
    const trigger = button(copy.title, event => void open(event.currentTarget), 'canvas-media-policy__trigger'); trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'canvasMediaPolicy'); header.append(trigger);
    const dialog = create('dialog', 'canvas-media-policy'); dialog.id = 'canvasMediaPolicy'; dialog.setAttribute('aria-labelledby', 'canvasMediaPolicyTitle');
    const title = create('h2', '', copy.title); title.id = 'canvasMediaPolicyTitle';
    const closeButton = button('×', close, 'canvas-media-policy__close'); closeButton.setAttribute('aria-label', copy.close);
    const head = create('header', 'canvas-media-policy__head'); head.append(create('p', 'canvas-media-policy__eyebrow', german ? 'PROJEKT-EINSTELLUNGEN' : 'PROJECT SETTINGS'), title, create('p', '', copy.description), closeButton);
    const body = create('div', 'canvas-media-policy__body'), projectBudget = create('p', 'canvas-media-policy__budget'), status = create('p', 'canvas-muted'); status.setAttribute('role', 'status');
    const modes = create('fieldset', 'canvas-media-policy__modes'); modes.append(create('legend', 'canvas-sr-only', copy.title));
    const modeInputs = {};
    for (const mode of ['automatic', 'selected']) {
        const input = create('input'); input.type = 'radio'; input.name = 'mediaPolicyMode'; input.value = mode;
        const label = create('label', 'canvas-media-policy__mode'), text = create('span'); text.append(create('strong', '', copy[mode]), create('small', '', copy[`${mode}Hint`])); label.append(input, text); modes.append(label); modeInputs[mode] = input;
        input.addEventListener('change', () => { if (draft) { draft.mode = mode; updateControls(); } });
    }
    const activeNotice = create('p', 'canvas-media-policy__active', copy.active), scope = create('p', 'canvas-muted', copy.scope);
    const search = create('input', 'canvas-input'); search.type = 'search'; search.placeholder = copy.searchPlaceholder; search.setAttribute('aria-label', copy.search);
    const categories = create('div', 'canvas-media-policy__filters'); categories.setAttribute('role', 'group'); categories.setAttribute('aria-label', copy.category);
    const categoryButtons = new Map(['all', ...kinds].map(kind => { const node = button(kind === 'all' ? copy.all : copy.categories[kind], () => { category = kind; filterRows(); }); categories.append(node); return [kind, node]; }));
    const catalog = create('div', 'canvas-media-policy__catalog'), catalogEmpty = create('p', 'canvas-muted', copy.noResults);
    const selectionNotice = create('p', 'canvas-media-policy__selection'); selectionNotice.setAttribute('role', 'status');
    const retry = button(copy.retry, () => void load(true));
    const explanation = create('details', 'canvas-disclosure'); explanation.append(create('summary', '', german ? 'So gelten die Limits' : 'How limits work'), create('p', '', copy.totalHint), create('p', '', copy.zero));
    body.append(projectBudget, scope, modes, activeNotice, status, retry, search, categories, selectionNotice, catalog, catalogEmpty, explanation);
    const saveButton = button(copy.save, () => void save(), 'canvas-button--primary'), cancel = button(copy.cancel, close), footer = create('footer', 'canvas-media-policy__footer'); footer.append(cancel, saveButton);
    dialog.append(head, body, footer); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    search.addEventListener('input', filterRows);
    window.addEventListener('pagehide', close);

    function path() { return `/projects/${encodeURIComponent(projectId)}/agent/media-policy`; }
    function money(value) { return `${formatter.format(value)} ${copy.credits}`; }
    function selection() { return [...(draft?.models || [])].sort(([a], [b]) => a.localeCompare(b)).map(([modelId, creditLimit]) => ({ modelId, creditLimit })); }
    function policyBody() { return { expectedRevision: snapshot.policy.revision, mode: draft.mode, models: draft.mode === 'selected' ? selection() : [] }; }
    function changed() { return snapshot && draft && JSON.stringify({ mode: snapshot.policy.mode, models: [...snapshot.policy.models].sort((a, b) => a.modelId.localeCompare(b.modelId)) }) !== JSON.stringify({ mode: draft.mode, models: draft.mode === 'selected' ? selection() : [] }); }
    function showFailure(result, text) {
        status.textContent = text;
        canvasNotice(text, { code: 'canvas_client_notice', projectId, errorCode: result.code, status: result.status, diagnosticRef: result.diagnosticRef, key: `canvas-media-policy:${projectId}:${result.code || 'connection'}` });
    }
    function accept(data) {
        if (!data || !count(data.policy?.revision) || !['automatic', 'selected'].includes(data.policy.mode) || !Array.isArray(data.policy.models) || !Array.isArray(data.inventory) || !Array.isArray(data.usage)) return false;
        if (data.policy.revision < (latestPolicy?.revision ?? 0) || data.policy.revision < (snapshot?.policy.revision ?? 0)) return false;
        latestPolicy = data.policy;
        snapshot = data; draft = { mode: data.policy.mode, models: new Map(data.policy.models.map(model => [model.modelId, model.creditLimit])) }; stale = false;
        return true;
    }
    function updateSummaries() {
        const policy = latestPolicy || snapshot?.policy;
        for (const { text, list, edit } of summaries) {
            text.textContent = !policy ? (loading ? copy.summaryLoading : copy.summaryUnavailable) : policy.mode === 'automatic' ? `${copy.title}: ${copy.automatic}` : `${copy.title}: ${copy.selectedCount(policy.models.length)}`;
            list.replaceChildren();
            if (policy?.mode === 'selected') for (const model of policy.models) list.append(create('li', '', `${snapshot?.inventory.find(item => item.id === model.modelId)?.label || model.modelId}: ${model.creditLimit === null ? copy.noLimit : money(model.creditLimit)}`));
            else list.append(create('li', '', copy.automaticHint));
            edit.disabled = !projectId; edit.setAttribute('aria-label', `${copy.title} · ${copy.edit}`);
        }
        trigger.disabled = !projectId;
    }
    function updateControls() {
        const disabled = loading || saving || Boolean(pending) || stale || !snapshot;
        for (const [mode, input] of Object.entries(modeInputs)) { input.checked = draft?.mode === mode; input.disabled = disabled; }
        for (const [id, row] of rows) {
            const selected = draft?.models.has(id), value = draft?.models.get(id), automatic = draft?.mode === 'automatic';
            row.checkbox.checked = automatic ? row.model.available !== false : selected;
            row.checkbox.disabled = disabled || automatic || (!selected && row.model.available === false);
            row.limitKind.value = value === null || value === undefined ? 'none' : 'cap';
            row.limitKind.disabled = disabled || automatic || !selected;
            row.amount.disabled = disabled || automatic || !selected || row.limitKind.value === 'none';
            row.amount.hidden = row.limitKind.value === 'none'; row.unit.hidden = row.amount.hidden;
            if (document.activeElement !== row.amount) row.amount.value = value === null || value === undefined ? '' : String(value);
            row.card.dataset.selected = String(Boolean(row.checkbox.checked));
        }
        saveButton.disabled = loading || saving || stale || !snapshot || (!pending && !changed());
        saveButton.textContent = pending ? copy.retrySave : copy.save;
        retry.hidden = !stale && Boolean(snapshot); retry.disabled = loading || saving || Boolean(pending);
        search.disabled = loading || !snapshot;
        selectionNotice.textContent = draft?.mode === 'selected' ? draft.models.size ? `${copy.selectedCount(draft.models.size)}${changed() ? ` · ${copy.changed}` : ''}` : copy.empty : copy.automaticHint;
        activeNotice.hidden = !snapshot?.activeRun || ['completed', 'cancelled', 'taken_over', 'manual_takeover'].includes(snapshot.activeRun.status);
        updateSummaries();
    }
    function filterRows() {
        const query = search.value.trim().toLocaleLowerCase(german ? 'de' : 'en'); let shown = 0;
        for (const [kind, node] of categoryButtons) { node.setAttribute('aria-pressed', String(category === kind)); node.disabled = loading || !snapshot; }
        for (const row of rows.values()) { row.card.hidden = (category !== 'all' && row.model.capability !== category) || Boolean(query) && !`${row.model.label} ${row.model.provider || ''}`.toLocaleLowerCase(german ? 'de' : 'en').includes(query); if (!row.card.hidden) shown++; }
        for (const section of catalog.children) section.hidden = (category !== 'all' && category !== section.dataset.kind) || Boolean(query) && ![...section.querySelectorAll('.canvas-media-policy__model')].some(row => !row.hidden);
        catalogEmpty.hidden = shown > 0 || !query;
    }
    function makeRow(model, index) {
        const card = create('article', 'canvas-media-policy__model'), checkbox = create('input'); checkbox.type = 'checkbox'; checkbox.id = `canvasMediaModel${index}`;
        const label = create('label', 'canvas-media-policy__model-title'); label.htmlFor = checkbox.id; label.append(create('strong', '', model.label || model.id), create('span', 'canvas-muted', model.provider || ''));
        const identity = create('div', 'canvas-media-policy__identity'); identity.append(checkbox, label);
        const capabilities = [];
        if (model.inputs?.image) capabilities.push(copy.reference); if (model.inputs?.audio) capabilities.push(copy.audio);
        const durations = model.controls?.duration;
        if (durations?.min > 0 && durations?.max >= durations.min) capabilities.push(`${durations.min}–${durations.max} ${copy.duration}`);
        if (Array.isArray(model.controls?.durations)) capabilities.push(`${model.controls.durations.join(' / ')} ${copy.duration}`);
        const capability = create('p', 'canvas-media-policy__capability', capabilities.join(' · '));
        const pricing = create('p', 'canvas-media-policy__price', count(model.pricing?.defaultCredits) ? copy.pricing(formatter.format(model.pricing.defaultCredits)) : copy.noPricing);
        const unavailable = create('p', 'canvas-media-policy__unavailable', copy.reasons[model.reason] || copy.unavailable); unavailable.hidden = model.available !== false;
        const limitKind = create('select', 'canvas-input'); limitKind.setAttribute('aria-label', `${model.label || model.id} · ${copy.limit}`);
        for (const [value, text] of [['none', copy.noLimit], ['cap', copy.capped]]) { const option = create('option', '', text); option.value = value; limitKind.append(option); }
        const amount = create('input', 'canvas-input'); amount.type = 'number'; amount.min = '0'; amount.step = '1'; amount.inputMode = 'numeric'; amount.setAttribute('aria-label', `${model.label || model.id} · ${copy.credits}`);
        const unit = create('span', 'canvas-muted', copy.credits), limits = create('div', 'canvas-media-policy__limit'); limits.append(limitKind, amount, unit);
        const usage = snapshot.usage.find(item => item.modelId === model.id), totals = create('p', 'canvas-media-policy__usage');
        if (usage) totals.textContent = [[copy.committed, usage.committedCredits], [copy.charged, usage.chargedCredits], [copy.reserved, usage.reservedCredits], ...(usage.pendingOutcomeCredits > 0 ? [[copy.pending, usage.pendingOutcomeCredits]] : []), [copy.remaining, usage.remainingCredits]].filter(([, value]) => count(value)).map(([name, value]) => `${name}: ${money(value)}`).join(' · ');
        card.append(identity, capability, pricing, unavailable, limits, totals);
        checkbox.addEventListener('change', () => { if (checkbox.checked) draft.models.set(model.id, null); else draft.models.delete(model.id); updateControls(); });
        limitKind.addEventListener('change', () => { draft.models.set(model.id, limitKind.value === 'none' ? null : 0); updateControls(); if (limitKind.value === 'cap') amount.focus(); });
        amount.addEventListener('input', () => { amount.setCustomValidity(''); draft.models.set(model.id, amount.value === '' ? '' : Number(amount.value)); updateControls(); });
        rows.set(model.id, { model, card, checkbox, limitKind, amount, unit }); return card;
    }
    function render() {
        projectBudget.textContent = `${copy.projectBudget}: ${count(snapshot?.projectBudget?.capCredits) ? money(snapshot.projectBudget.capCredits) : copy.noBudget}`;
        rows.clear(); catalog.replaceChildren();
        let index = 0;
        for (const kind of kinds) {
            const models = (snapshot?.inventory || []).filter(model => model.capability === kind), section = create('section', 'canvas-media-policy__category');
            section.dataset.kind = kind;
            section.append(create('h3', '', copy.categories[kind]));
            if (!models.length) section.append(create('p', 'canvas-muted', copy.noCategory));
            for (const model of models) section.append(makeRow(model, index++));
            catalog.append(section);
        }
        updateControls(); filterRows();
    }
    async function load(report = false) {
        if (!projectId || loading || saving || pending) return;
        const current = epoch; loading = true; status.textContent = copy.loading; updateControls();
        const result = await canvasRequest(path(), { timeoutMs: 15000 });
        if (current !== epoch) return;
        loading = false;
        if (result.ok && accept(result.data)) { status.textContent = ''; render(); }
        else if (result.ok && count(result.data?.policy?.revision) && result.data.policy.revision < (latestPolicy?.revision ?? 0)) { status.textContent = copy.stale; updateControls(); }
        else { status.textContent = copy.loadFailed; if (report) showFailure(result, copy.loadFailed); updateControls(); }
        if (refreshAfterLoad) { refreshAfterLoad = false; void load(report); }
    }
    async function open(origin) {
        if (!projectId || dialog.open) return;
        // Safari does not focus buttons on pointer clicks. Restore to the
        // actual invoker rather than whichever unrelated control kept focus.
        opener = origin || document.activeElement; dialog.showModal(); closeButton.focus();
        if (pending) { status.textContent = copy.uncertain; updateControls(); } else await load(true);
    }
    function close() { if (!dialog.open) return; dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); }
    async function save() {
        if (saveButton.disabled || !snapshot) return;
        if (!pending) {
            for (const [modelId, value] of draft.models) if (draft.mode === 'selected' && value !== null && !count(value)) { const amount = rows.get(modelId)?.amount; amount?.setCustomValidity(copy.invalid); amount?.reportValidity(); amount?.focus(); return; }
            pending = { key: crypto.randomUUID(), body: policyBody() };
        }
        const current = epoch, request = pending; saving = true; status.textContent = ''; updateControls();
        const result = await canvasRequest(path(), { method: 'PUT', body: request.body, idempotencyKey: request.key, timeoutMs: 15000 });
        if (current !== epoch) return;
        saving = false;
        if (result.ok && accept(result.data)) {
            pending = null; render(); close(); canvasNotice(result.data.affectedRunPaused ? copy.paused : copy.saved, { code: 'canvas_client_notice', projectId }); onSaved();
        } else {
            const uncertain = result.ok || result.status === 0 || result.status >= 500;
            if (!uncertain) pending = null;
            stale = ['canvas_agent_media_policy_changed', 'canvas_agent_model_ineligible'].includes(result.code);
            showFailure(result, result.code === 'canvas_agent_model_ineligible' ? copy.ineligible : stale ? copy.stale : result.code === 'canvas_agent_media_limit_below_committed' ? copy.belowSpent : uncertain ? copy.uncertain : copy.saveFailed); updateControls();
        }
    }
    render();
    return {
        summary(parent, before = null) { const row = create('div', 'canvas-media-policy__summary'), details = create('details'), text = create('summary'), list = create('ul'), edit = button(copy.edit, event => void open(event.currentTarget), 'canvas-button--compact'); details.append(text, list); row.append(details, edit); parent.insertBefore(row, before); summaries.push({ text, list, edit }); updateSummaries(); return row; },
        sync(policy) {
            if (!count(policy?.revision) || !['automatic', 'selected'].includes(policy.mode) || !Array.isArray(policy.models) || policy.revision < (latestPolicy?.revision ?? 0)) return;
            const changed = policy.revision !== latestPolicy?.revision; latestPolicy = policy; updateSummaries();
            if (changed && policy.revision !== snapshot?.policy.revision && !dialog.open && !pending) { if (loading) refreshAfterLoad = true; else void load(); }
        },
        revision: () => snapshot?.policy.revision ?? null,
        setVisible(value) { const changed = visible !== value; visible = value; if (!value) close(); else if (changed && !snapshot) void load(); },
        projectChanged(id) { if (id === projectId) return; close(); epoch++; projectId = id; snapshot = draft = pending = latestPolicy = null; loading = saving = stale = refreshAfterLoad = false; category = 'all'; search.value = ''; status.textContent = ''; render(); if (visible && id) void load(); },
    };
}
