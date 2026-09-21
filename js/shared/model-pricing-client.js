import { getBrowserTariff, setBrowserTariff, TARIFF_HEADER } from './model-tariff.mjs';

let pending, abort, epoch = 0, adminAuthorized = false;
const isAdminPage = () => location.pathname === '/admin/' || location.pathname === '/admin/index.html';
function clear() { epoch++; abort?.abort(); pending = null; setBrowserTariff(null); }
export function modelPricingSession(path, response, data) {
    if (path === '/admin/me') {
        adminAuthorized = response.ok && data?.ok !== false;
        if (adminAuthorized) refreshModelPricing(); else clear();
    }
    if (path === '/logout') { adminAuthorized = false; clear(); }
}
export async function refreshModelPricing() {
    if (pending) return pending;
    const admin = isAdminPage();
    if (admin && !adminAuthorized) return;
    const generation = epoch; abort = new AbortController();
    const active = abort, timer = setTimeout(() => active.abort(), 8000), signal = active.signal;
    const request = (async () => {
        try {
            const response = await fetch(admin ? '/api/admin/ai/model-pricing' : '/api/model-pricing', { credentials:'include', cache:'no-store', signal });
            if (!response.ok) return;
            const data = await response.json();
            if (generation !== epoch || signal.aborted || (admin && !adminAuthorized)
                || !Number.isSafeInteger(data.revision) || !data.rules || typeof data.rules !== 'object') return;
            const previous = getBrowserTariff()?.revision;
            // Only retail data enters the estimator; Admin economics stay local
            // to its protected page. Never persist either response in storage.
            setBrowserTariff({ revision:data.revision, rules:data.rules });
            if (previous !== data.revision) window.dispatchEvent(new Event('bitbi:model-pricing'));
        } catch { /* Server rejects stale quotes before new paid admission. */ }
        finally { clearTimeout(timer); if (generation === epoch) pending = null; }
    })();
    pending = request; return request;
}
export function modelPricingRequestHeaders() {
    return { [TARIFF_HEADER]: String(getBrowserTariff()?.revision ?? 0) };
}
if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshModelPricing);
    window.addEventListener('pageshow', refreshModelPricing);
    document.addEventListener('bitbi:auth-change', event => {
        clear(); if (!event.detail?.user) adminAuthorized = false;
        else refreshModelPricing();
    });
    refreshModelPricing();
}
