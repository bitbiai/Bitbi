import { getBrowserTariff, setBrowserTariff, TARIFF_HEADER } from './model-tariff.mjs';

let pending, epoch = 0, identity, blocked = false, adminAuthorized = false;
const isAdminPage = () => location.pathname === '/admin/' || location.pathname === '/admin/index.html';
const canRefresh = () => !blocked && (!isAdminPage() || adminAuthorized);
function clear() {
    epoch++; pending?.controller.abort(); pending = null;
    const previous = getBrowserTariff(); setBrowserTariff(null);
    if (previous) window.dispatchEvent(new Event('bitbi:model-pricing'));
}
function sessionUser(user) {
    const next = user ? JSON.stringify([user.id, user.role, user.status || 'active']) : null;
    // The initial credentialed retail fetch already belongs to this page's
    // session. Binding its first /me identity must not discard that response.
    // Later actor/access changes invalidate it; profile/credit patches do not.
    if (identity !== undefined && next !== identity) {
        clear(); adminAuthorized = false;
    }
    identity = next;
    if (user) blocked = false;
}
export function modelPricingSession(path, response, data) {
    if (path === '/admin/me') {
        if (response.ok && data?.ok !== false && data?.user) sessionUser(data.user);
        adminAuthorized = response.ok && data?.ok !== false;
        if (adminAuthorized) { blocked = false; void refreshModelPricing(); }
        else { blocked = true; clear(); }
    }
    if (path === '/logout') { identity = null; blocked = isAdminPage(); adminAuthorized = false; clear(); }
    if (path === '/login' && response.ok) {
        identity = null; blocked = true; adminAuthorized = false; clear();
    }
}
function startRefresh() {
    const admin = isAdminPage();
    const request = { generation:epoch, controller:new AbortController() };
    const signal = request.controller.signal, timer = setTimeout(() => request.controller.abort(), 8000);
    pending = request;
    request.promise = (async () => {
        try {
            const response = await fetch(admin ? '/api/admin/ai/model-pricing' : '/api/model-pricing', { credentials:'include', cache:'no-store', signal });
            if (request.generation !== epoch || signal.aborted) return;
            if ([401,403,428].includes(response.status)) { blocked = true; adminAuthorized = false; clear(); return; }
            if (!response.ok) return;
            const data = await response.json();
            if (request.generation !== epoch || signal.aborted || !canRefresh()
                || data.ok === false || !Number.isSafeInteger(data.revision) || data.revision < 0
                || !data.rules || typeof data.rules !== 'object' || Array.isArray(data.rules)) return;
            const previous = getBrowserTariff()?.revision;
            if (previous !== undefined && data.revision < previous) return;
            // Only retail data enters the estimator; Admin economics stay local
            // to its protected page. Never persist either response in storage.
            setBrowserTariff({ revision:data.revision, rules:data.rules });
            if (previous !== data.revision) window.dispatchEvent(new Event('bitbi:model-pricing'));
        } catch { /* Server rejects stale quotes before new paid admission. */ }
        finally { clearTimeout(timer); if (pending === request) pending = null; }
    })();
    return request;
}
export async function refreshModelPricing() {
    if (!canRefresh()) return null;
    let request = pending || startRefresh();
    for (;;) {
        await request.promise;
        if (!canRefresh()) return null;
        // A waiter follows the current session's replacement instead of treating
        // a superseded abort as successful pricing readiness (revision zero).
        if (pending && pending !== request) { request = pending; continue; }
        return getBrowserTariff();
    }
}
export function modelPricingRequestHeaders() {
    return { [TARIFF_HEADER]: String(getBrowserTariff()?.revision ?? 0) };
}
if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshModelPricing);
    window.addEventListener('pageshow', refreshModelPricing);
    document.addEventListener('bitbi:auth-change', event => {
        const user = event.detail?.user;
        sessionUser(user);
        if (!user) { blocked = isAdminPage(); adminAuthorized = false; clear(); }
        else void refreshModelPricing();
    });
    refreshModelPricing();
}
