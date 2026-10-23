import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initCookieConsent } from '../../shared/cookie-consent.js?v=__ASSET_VERSION__';
import { copy } from './copy.js?v=__ASSET_VERSION__';

const root = document.querySelector('[data-consumer-declaration]');
if (root) initDeclaration(root);

function initDeclaration(root) {
    const locale = document.documentElement.lang === 'de' ? 'de' : 'en';
    const text = copy[locale];
    const kind = root.dataset.consumerDeclaration;
    if (!['withdrawal', 'cancellation'].includes(kind)) return;
    const form = root.querySelector('form');
    const review = root.querySelector('[data-review]');
    const receiptSection = root.querySelector('[data-receipt]');
    const notice = root.querySelector('[data-notice]');
    const confirm = root.querySelector('[data-confirm]');
    const edit = root.querySelector('[data-edit]');
    const newDeclaration = root.querySelector('[data-new-declaration]');
    const next = form.querySelector('[type=submit]');
    const storageKey = `bitbi:consumer-declaration:${kind}:v1`;
    let pending = null;
    let response = null;
    let submitting = false;
    let ready = false;
    let uncertain = false;
    let abort = null;
    const confirmationText = kind === 'withdrawal' ? text.confirmWithdrawal : text.confirmCancellation;

    try { initSiteHeader({ enableGlobalAudio: false }); } catch { /* Form remains usable independently of the header. */ }
    try { initCookieConsent(); } catch { /* Necessary declaration intake does not depend on optional cookies. */ }

    function status(message, error = false) {
        notice.textContent = message;
        notice.classList.toggle('consumer-contracts__notice--error', error);
        notice.hidden = !message;
    }
    function remember() {
        try {
            sessionStorage.setItem(storageKey, JSON.stringify({ pending, response, expires: Date.now() + 86400000 }));
        } catch { /* In-memory request identity still protects repeated submission in this document. */ }
    }
    function entries(payload) {
        const rows = ['name', 'email', 'contractReference', 'scope'].filter(key => payload[key]).map(key => [text[key], payload[key]]);
        if (kind === 'cancellation') {
            rows.push([text.cancellationType, text[payload.cancellationType]], [text.endRequest, text[payload.endRequest]]);
            if (payload.requestedEndDate) rows.push([text.requestedEndDate, payload.requestedEndDate]);
            if (payload.reason) rows.push([text.reason, payload.reason]);
        }
        return rows;
    }
    function renderRows(target, rows) {
        target.replaceChildren();
        for (const [label, value] of rows) {
            const term = document.createElement('dt');
            const description = document.createElement('dd');
            term.textContent = label;
            description.textContent = value;
            target.append(term, description);
        }
    }
    function showReview({ focus = true } = {}) {
        form.hidden = true;
        review.hidden = false;
        receiptSection.hidden = true;
        renderRows(review.querySelector('dl'), entries(pending));
        root.querySelector('[data-request-reference]').textContent = `${text.request}: ${pending.requestId}`;
        edit.hidden = uncertain;
        confirm.disabled = !ready || submitting;
        confirm.textContent = uncertain ? text.retry : confirmationText;
        if (focus) review.querySelector('h2').focus();
    }
    function validResponse(value) {
        return value?.status === 'received' && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value.id)
            && typeof value.receivedAt === 'string' && Number.isFinite(Date.parse(value.receivedAt))
            && typeof value.receipt?.text === 'string' && value.receipt.text.length > 0 && value.receipt.text.length <= 20000
            && value.receipt.id === value.id && value.receipt.receivedAt === value.receivedAt
            && value.receipt.kind === kind && value.receipt.locale === locale;
    }
    function receiptRows() {
        return [
            [text.reference, response.id],
            [text.receivedAt, new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC' }).format(new Date(response.receivedAt))],
            ...entries(response.receipt),
        ];
    }
    function showReceipt({ focus = true } = {}) {
        form.hidden = true;
        review.hidden = true;
        receiptSection.hidden = false;
        newDeclaration.hidden = false;
        newDeclaration.textContent = text.newDeclaration;
        status('');
        renderRows(receiptSection.querySelector('dl'), receiptRows());
        const state = response.acknowledgement?.state;
        receiptSection.querySelector('[data-mail-state]').textContent = text[state === 'delivered' ? 'delivered' : state === 'accepted' ? 'sent' : ['bounced', 'review_required'].includes(state) ? 'failed' : 'queued'];
        if (focus) receiptSection.querySelector('h2').focus();
    }
    function syncFields() {
        if (kind !== 'cancellation') return;
        const date = form.elements.requestedEndDate;
        const wantsDate = form.elements.endRequest.value === 'date';
        date.disabled = !wantsDate;
        date.required = wantsDate;
        date.closest('label').hidden = !wantsDate;
        const wantsReason = form.elements.cancellationType.value === 'extraordinary';
        form.elements.reason.disabled = !wantsReason;
        form.elements.reason.closest('label').hidden = !wantsReason;
    }
    form.addEventListener('change', syncFields);
    syncFields();
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!ready || !form.reportValidity() || submitting || uncertain) return;
        const data = new FormData(form);
        pending = { requestId: crypto.randomUUID(), kind, locale, name: data.get('name').trim(), email: data.get('email').trim(), contractReference: data.get('contractReference').trim() };
        if (data.get('scope')?.trim()) pending.scope = data.get('scope').trim();
        if (kind === 'cancellation') {
            pending.endRequest = data.get('endRequest');
            pending.cancellationType = data.get('cancellationType');
            if (pending.endRequest === 'date') pending.requestedEndDate = data.get('requestedEndDate');
            if (data.get('reason')?.trim()) pending.reason = data.get('reason').trim();
        }
        status('');
        if (kind === 'cancellation') submitDeclaration();
        else showReview();
    });
    edit.addEventListener('click', () => {
        if (submitting || uncertain) return;
        review.hidden = true;
        form.hidden = false;
        form.elements.name.focus();
        pending = null;
    });
    confirm.addEventListener('click', submitDeclaration);
    async function submitDeclaration() {
        if (!ready || !pending || submitting || response) return;
        submitting = true;
        uncertain = true;
        remember();
        confirm.disabled = true;
        next.disabled = true;
        form.setAttribute('aria-busy', 'true');
        edit.hidden = true;
        review.setAttribute('aria-busy', 'true');
        status(text.sending);
        abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 30000);
        try {
            const result = await fetch('/api/consumer/declarations', {
                method: 'POST', credentials: 'include', cache: 'no-store', signal: abort.signal,
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(pending),
            });
            const value = await result.json();
            if (!result.ok || !validResponse(value)) {
                if (result.status === 400 || result.status === 422) {
                    uncertain = false;
                    try { sessionStorage.removeItem(storageKey); } catch { /* Optional session storage. */ }
                    status(text.invalid, true);
                } else status(result.status === 429 ? text.rate : result.status === 409 ? text.conflict : text.unknown, true);
                return;
            }
            response = value;
            remember();
            showReceipt();
        } catch {
            status(text.unknown, true);
        } finally {
            clearTimeout(timeout);
            abort = null;
            submitting = false;
            review.removeAttribute('aria-busy');
            form.removeAttribute('aria-busy');
            next.disabled = !ready;
            confirm.disabled = !ready;
            confirm.textContent = uncertain ? text.retry : confirmationText;
            edit.hidden = uncertain;
            if (!response && kind === 'cancellation') showReview({ focus: false });
        }
    }
    receiptSection.querySelector('[data-save-receipt]').addEventListener('click', () => {
        if (!response) return;
        const body = response.receipt.text;
        const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `bitbi-${kind}-${response.id}.txt`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    receiptSection.querySelector('[data-print-receipt]').addEventListener('click', () => { if (response) window.print(); });
    newDeclaration.addEventListener('click', () => {
        // Only a confirmed receipt permits a new identity. An uncertain request
        // must continue through its original replay path, even for a synthetic click.
        if (submitting || !validResponse(response)) return;
        pending = null;
        response = null;
        uncertain = false;
        try { sessionStorage.removeItem(storageKey); } catch { /* The current form still resets without storage. */ }
        form.reset();
        syncFields();
        review.querySelector('dl').replaceChildren();
        receiptSection.querySelector('dl').replaceChildren();
        root.querySelector('[data-request-reference]').textContent = '';
        receiptSection.querySelector('[data-mail-state]').textContent = '';
        review.hidden = true;
        receiptSection.hidden = true;
        newDeclaration.hidden = true;
        form.hidden = false;
        confirm.textContent = confirmationText;
        edit.hidden = false;
        next.disabled = !ready;
        status('');
        form.elements.name.focus();
    });
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (saved?.expires > Date.now() && saved.pending?.kind === kind && saved.pending?.locale === locale && /^[0-9a-f-]{36}$/i.test(saved.pending?.requestId || '')) {
            pending = saved.pending;
            response = validResponse(saved.response) ? saved.response : null;
            uncertain = true;
            if (response) showReceipt({ focus: false });
            else { showReview({ focus: false }); status(text.restored); }
        }
    } catch { /* Unavailable or malformed local storage cannot block public intake. */ }
    async function loadConfiguration() {
        try {
            const result = await fetch('/api/consumer/declarations/config', { cache: 'no-store', credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
            const config = await result.json();
            if (!result.ok || config.requireTurnstile !== false) throw new Error('configuration_unavailable');
            ready = true;
            next.disabled = false;
            confirm.disabled = false;
        } catch { if (!response) status(text.unavailable, true); }
    }
    loadConfiguration();
}
