/* Early, bounded bootstrap. Public configuration only; no personal preferences. */
(function () {
    'use strict';
    if (window.BitbiAppearance || !window.BitbiAppearanceContract) return;
    const contract = window.BitbiAppearanceContract;
    const root = document.documentElement;
    const CACHE_KEY = 'bitbi.appearance.global.v1';
    const REFRESH_MS = 60_000;
    let state = { version: 1, revision: 0, segments: { ...contract.DEFAULT_SEGMENTS }, personalEnabled: false };
    let pending = null, timer = null, abort = null, stopped = false, verifiedAt = 0, hasConfirmed = false;
    let cached = false;
    try { state = contract.normalizeAppearance(JSON.parse(localStorage.getItem(CACHE_KEY))); cached = true; } catch { /* deterministic initial defaults */ }
    function apply() {
        const segment = contract.resolveSegment(location.pathname);
        const theme = contract.resolvePreference({ globalTheme: state.segments[segment] });
        root.dataset.theme = theme;
        root.dataset.themeSegment = segment;
        root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
        meta.content = { dark: '#0A0A0A', light: '#f1f5f7', soft: '#f3f0e8' }[theme];
    }
    const reveal = () => root.removeAttribute('data-appearance-pending');
    if (!cached) { root.setAttribute('data-appearance-pending', ''); setTimeout(reveal, 600); }
    apply();
    function acceptConfirmed(value) {
        let next;
        try { next = contract.normalizeAppearance(value); } catch { return false; }
        if (hasConfirmed && next.revision < state.revision) return false;
        state = next; verifiedAt = Date.now(); hasConfirmed = true;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* private/disabled storage */ }
        apply(); reveal();
        window.dispatchEvent(new CustomEvent('bitbi:appearance', { detail: { revision: state.revision, segment: root.dataset.themeSegment, theme: root.dataset.theme } }));
        return true;
    }
    function schedule() {
        clearTimeout(timer);
        if (!stopped && document.visibilityState !== 'hidden') timer = setTimeout(() => refresh({ force: true }), REFRESH_MS);
    }
    async function refresh({ force = false } = {}) {
        apply();
        if (stopped || pending) return pending;
        if (!force && verifiedAt && Date.now() - verifiedAt < 1000) { schedule(); return; }
        const active = new AbortController(); abort = active;
        const timeout = setTimeout(() => active.abort(), 4000);
        pending = (async () => {
            try {
                const response = await fetch('/api/appearance', { credentials: 'omit', cache: 'no-store', signal: active.signal, headers: { Accept: 'application/json' } });
                if (!response.ok) return;
                const data = await response.json();
                if (!stopped && !active.signal.aborted && data.ok === true) acceptConfirmed(data.appearance);
            } catch { /* Keep the last verified/default theme; never block the app. */ }
            finally { clearTimeout(timeout); if (abort === active) { pending = null; abort = null; schedule(); } reveal(); }
        })();
        return pending;
    }
    window.BitbiAppearance = Object.freeze({ refresh, acceptConfirmed, snapshot: () => structuredClone(state) });
    window.addEventListener('storage', event => { if (event.key === CACHE_KEY && event.newValue !== JSON.stringify(state)) refresh({ force: true }); });
    window.addEventListener('focus', () => refresh());
    window.addEventListener('popstate', () => refresh({ force: true }));
    window.addEventListener('pageshow', () => { stopped = false; refresh({ force: true }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clearTimeout(timer); else refresh({ force: true }); });
    window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); abort?.abort(); abort = null; pending = null; reveal(); });
    refresh({ force: true });
})();
