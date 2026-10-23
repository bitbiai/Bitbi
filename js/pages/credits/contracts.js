import { apiListContractConfirmations, apiContractConfirmation } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

// Documents are account-owned server snapshots, never reconstructed from today's terms.
export function initContractDocuments({ locale, currentActor }) {
    const mount = document.getElementById('creditsContractDocuments');
    if (!mount) return { reset() {}, load() {} };
    const de = locale === 'de';
    const status = mount.querySelector('[data-contract-status]');
    const list = mount.querySelector('[data-contract-list]');
    const more = mount.querySelector('[data-contract-more]');
    let actor = null, generation = 0, cursor = null, busy = false, loaded = false;
    const seen = new Set();
    const valid = (token, owner) => token === generation && owner === actor && currentActor() === owner;
    function reset() {
        generation++; actor = null; cursor = null; busy = false; loaded = false; seen.clear();
        list.replaceChildren(); status.textContent = ''; more.hidden = true; mount.hidden = true;
    }
    async function download(id, button) {
        const token = generation, owner = actor; button.disabled = true;
        try {
            const result = await apiContractConfirmation(id);
            if (!valid(token, owner)) return;
            const text = result.data?.document?.text;
            if (!result.ok || typeof text !== 'string' || !text) throw new Error('document_unavailable');
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = `bitbi-contract-${id}.txt`;
            link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.textContent = '';
        } catch {
            if (valid(token, owner)) status.textContent = de ? 'Der Beleg konnte nicht geladen werden. Bitte erneut versuchen.' : 'The document could not be loaded. Please try again.';
        } finally { if (valid(token, owner)) button.disabled = false; }
    }
    async function load(next = false) {
        const owner = currentActor(); if (!owner) { reset(); return; }
        if (actor !== owner) { reset(); actor = owner; }
        mount.hidden = false;
        if (busy || (loaded && !next)) return;
        const token = generation; busy = true; more.disabled = true;
        status.textContent = de ? 'Belege werden geladen …' : 'Loading documents …';
        try {
            const result = await apiListContractConfirmations(next ? cursor : null);
            if (!valid(token, owner)) return;
            if (!result.ok || !Array.isArray(result.data?.items)) throw new Error('documents_unavailable');
            for (const item of result.data.items) {
                if (typeof item.checkoutId !== 'string' || seen.has(item.checkoutId)) continue;
                seen.add(item.checkoutId);
                const row = document.createElement('li'), button = document.createElement('button');
                const date = new Date(item.createdAt);
                button.type = 'button'; button.className = 'btn btn-secondary';
                button.textContent = `${item.offerName || 'BITBI'} · ${Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(de ? 'de-DE' : 'en-GB')} · ${de ? 'Beleg speichern' : 'Save document'}`;
                button.addEventListener('click', () => download(item.checkoutId, button));
                row.append(button); list.append(row);
            }
            loaded = true; cursor = result.data.nextCursor || null; more.hidden = !cursor;
            status.textContent = seen.size ? '' : (de ? 'Noch keine neuen Vertragsbelege vorhanden. Frühere Kaufnachweise bleiben unverändert.' : 'No new contract documents yet. Earlier purchase records remain unchanged.');
        } catch {
            if (valid(token, owner)) { status.textContent = de ? 'Belege konnten nicht geladen werden.' : 'Documents could not be loaded.'; more.hidden = false; more.textContent = de ? 'Erneut versuchen' : 'Try again'; }
        } finally { if (valid(token, owner)) { busy = false; more.disabled = false; } }
    }
    more.addEventListener('click', () => load(loaded));
    return { reset, load };
}
