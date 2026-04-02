/* ============================================================
   TEMPORARY DECK DEBUG INSTRUMENTATION
   Activated ONLY when URL contains ?deckdebug=1
   DELETE THIS FILE after investigation is complete.
   ============================================================ */

const ENABLED = new URLSearchParams(location.search).has('deckdebug');
if (ENABLED) console.warn('[DECK-DEBUG] Instrumentation ACTIVE — remove before production');

/* ── Counters ── */
const C = {
    modalOpen: 0, modalClose: 0,
    loginSubmitStart: 0, loginSuccess: 0,
    authDispatch: 0,
    authChange_gallery: 0, authChange_soundlab: 0, authChange_experiments: 0,
    authChange_lockedSections: 0, authChange_authNav: 0,
    mutObs_gallery: 0, mutObs_soundlab: 0, mutObs_experiments: 0,
    layout_gallery: 0, layout_soundlab: 0, layout_experiments: 0,
    deckInit_gallery: 0, deckInit_soundlab: 0, deckInit_experiments: 0,
    resize: 0, vvResize: 0, matchMediaChange: 0,
};

/* ── State snapshots ── */
let snap_beforeLogin = null;
let snap_afterLogin = null;
let snap_afterModalClose = null;
let firstSwipeAfterLogin = { experiments: true, gallery: true, soundlab: true };

/* ── Helpers ── */
function ts() { return performance.now().toFixed(1); }

function viewport() {
    const vv = window.visualViewport;
    return {
        'window.innerWidth': window.innerWidth,
        'window.innerHeight': window.innerHeight,
        'vv.width': vv ? vv.width : 'N/A',
        'vv.height': vv ? vv.height : 'N/A',
        'vv.offsetTop': vv ? vv.offsetTop : 'N/A',
        'vv.offsetLeft': vv ? vv.offsetLeft : 'N/A',
        'vv.scale': vv ? vv.scale : 'N/A',
        'docEl.clientWidth': document.documentElement.clientWidth,
        'docEl.clientHeight': document.documentElement.clientHeight,
        'body.clientWidth': document.body.clientWidth,
        'body.clientHeight': document.body.clientHeight,
        'body.scrollWidth': document.body.scrollWidth,
        'body.scrollHeight': document.body.scrollHeight,
    };
}

function computedStyles(el, label) {
    if (!el) return { label, error: 'element not found' };
    const cs = getComputedStyle(el);
    return {
        label,
        overflow: cs.overflow,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        position: cs.position,
        width: cs.width,
        height: cs.height,
        top: cs.top,
        left: cs.left,
        transform: cs.transform,
        touchAction: cs.touchAction,
        pointerEvents: cs.pointerEvents,
    };
}

function overlayState() {
    const ov = document.querySelector('.auth-modal__overlay');
    if (!ov) return { exists: false };
    const cs = getComputedStyle(ov);
    const rect = ov.getBoundingClientRect();
    return {
        exists: true,
        hasActiveClass: ov.classList.contains('active'),
        classes: ov.className,
        computed: {
            display: cs.display,
            opacity: cs.opacity,
            pointerEvents: cs.pointerEvents,
            position: cs.position,
            inset: cs.inset,
            zIndex: cs.zIndex,
            transform: cs.transform,
        },
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
}

function deckState(containerId, label) {
    const ctn = document.getElementById(containerId);
    if (!ctn) return { label, error: 'container not found' };
    const rect = ctn.getBoundingClientRect();
    const allChildren = Array.from(ctn.children);
    const visibleCards = allChildren.filter(c => c.style.display !== 'none' && c.tagName !== 'BUTTON');
    const hasDeckClass = ctn.classList.contains('exp-deck') || ctn.classList.contains('gal-deck') || ctn.classList.contains('snd-deck');
    const cs = getComputedStyle(ctn);

    /* Find active card (one with opacity ~1 and scale ~0.9) */
    let activeIdx = -1;
    visibleCards.forEach((c, i) => {
        if (c.style.opacity === '1' || c.style.opacity === '') {
            const t = c.style.transform;
            if (t && t.includes('scale(0.9')) activeIdx = i;
        }
    });

    let activeRect = null;
    if (activeIdx >= 0 && visibleCards[activeIdx]) {
        const ar = visibleCards[activeIdx].getBoundingClientRect();
        activeRect = { top: ar.top, left: ar.left, width: ar.width, height: ar.height };
    }

    return {
        label,
        containerRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        containerComputed: {
            display: cs.display,
            gridTemplateColumns: cs.gridTemplateColumns,
            touchAction: cs.touchAction,
            overflow: cs.overflow,
        },
        totalChildren: allChildren.length,
        visibleCardCount: visibleCards.length,
        hasDeckClass,
        activeIdx,
        activeRect,
        cardTransforms: visibleCards.slice(0, 6).map((c, i) => ({
            i,
            display: c.style.display,
            transform: c.style.transform,
            opacity: c.style.opacity,
            transition: c.style.transition,
            pointerEvents: c.style.pointerEvents,
            classes: c.className.split(' ').filter(x => x.includes('locked') || x.includes('reveal') || x.includes('visible')).join(' '),
        })),
    };
}

function fullSnapshot(label) {
    return {
        label,
        timestamp: ts(),
        viewport: viewport(),
        html: computedStyles(document.documentElement, 'html'),
        body: computedStyles(document.body, 'body'),
        overlay: overlayState(),
        experiments: deckState('experimentsGrid', 'experiments'),
        gallery: deckState('galleryGrid', 'gallery'),
        soundlab: deckState('soundLabTracks', 'soundlab'),
    };
}

/* ── Public API (imported by instrumented modules) ── */

export function dbg(tag, ...args) {
    if (!ENABLED) return;
    console.log(`[DECK-DEBUG ${ts()}ms] ${tag}`, ...args);
}

export function dbgCount(key) {
    if (!ENABLED) return;
    if (key in C) C[key]++;
}

export function dbgModalOpen() {
    if (!ENABLED) return;
    C.modalOpen++;
    snap_beforeLogin = fullSnapshot('BEFORE_LOGIN (modal open)');
    console.groupCollapsed(`[DECK-DEBUG] === MODAL OPEN #${C.modalOpen} ===`);
    console.log('body.style.overflow BEFORE open:', document.body.style.overflow);
    console.log('Snapshot:', snap_beforeLogin);
    console.groupEnd();
}

export function dbgModalClose() {
    if (!ENABLED) return;
    C.modalClose++;
    snap_afterModalClose = fullSnapshot('AFTER_MODAL_CLOSE');
    console.groupCollapsed(`[DECK-DEBUG] === MODAL CLOSE #${C.modalClose} ===`);
    console.log('body.style.overflow AFTER close:', document.body.style.overflow);
    console.log('Snapshot:', snap_afterModalClose);

    if (snap_beforeLogin) {
        const bw = snap_beforeLogin.viewport['docEl.clientWidth'];
        const aw = snap_afterModalClose.viewport['docEl.clientWidth'];
        if (bw !== aw) {
            console.warn(`WIDTH CHANGED: ${bw} -> ${aw} (delta ${aw - bw}px)`);
        } else {
            console.log(`Width unchanged: ${bw}px`);
        }

        /* Compare deck container widths */
        ['experiments', 'gallery', 'soundlab'].forEach(s => {
            const bRect = snap_beforeLogin[s]?.containerRect;
            const aRect = snap_afterModalClose[s]?.containerRect;
            if (bRect && aRect && bRect.width !== aRect.width) {
                console.warn(`${s} container width CHANGED: ${bRect.width} -> ${aRect.width}`);
            }
        });

        /* Compare overlay state */
        const ov = snap_afterModalClose.overlay;
        if (ov.exists) {
            console.log('Overlay still in DOM:', ov);
            if (ov.computed.pointerEvents !== 'none') {
                console.error('OVERLAY pointer-events IS NOT none:', ov.computed.pointerEvents);
            }
            if (parseFloat(ov.computed.opacity) > 0.01) {
                console.error('OVERLAY opacity > 0:', ov.computed.opacity);
            }
        }
    }
    console.groupEnd();
}

export function dbgLoginSubmitStart() {
    if (!ENABLED) return;
    C.loginSubmitStart++;
    dbg('LOGIN_SUBMIT_START', { bodyOverflow: document.body.style.overflow });
}

export function dbgLoginSuccess() {
    if (!ENABLED) return;
    C.loginSuccess++;
    snap_afterLogin = fullSnapshot('AFTER_LOGIN (before modal close)');
    console.groupCollapsed(`[DECK-DEBUG] === LOGIN SUCCESS #${C.loginSuccess} ===`);
    console.log('body.style.overflow AT login success:', document.body.style.overflow);
    console.log('Snapshot:', snap_afterLogin);

    if (snap_beforeLogin) {
        const bw = snap_beforeLogin.viewport['docEl.clientWidth'];
        const aw = snap_afterLogin.viewport['docEl.clientWidth'];
        if (bw !== aw) {
            console.warn(`WIDTH CHANGED at login: ${bw} -> ${aw} (delta ${aw - bw}px)`);
        }
    }
    console.groupEnd();

    /* Reset first-swipe flags */
    firstSwipeAfterLogin = { experiments: true, gallery: true, soundlab: true };
}

export function dbgAuthDispatch(state) {
    if (!ENABLED) return;
    C.authDispatch++;
    dbg('AUTH_DISPATCH', { count: C.authDispatch, loggedIn: state.loggedIn });
}

export function dbgAuthChangeIn(module) {
    if (!ENABLED) return;
    const key = `authChange_${module}`;
    if (key in C) C[key]++;
    dbg(`AUTH_CHANGE_HANDLER [${module}]`, { count: C[key] });
}

export function dbgMutObs(module) {
    if (!ENABLED) return;
    const key = `mutObs_${module}`;
    if (key in C) C[key]++;
    dbg(`MUTATION_OBSERVER [${module}]`, { count: C[key] });
}

export function dbgLayout(module) {
    if (!ENABLED) return;
    const key = `layout_${module}`;
    if (key in C) C[key]++;
}

export function dbgDeckInit(module) {
    if (!ENABLED) return;
    const key = `deckInit_${module}`;
    if (key in C) C[key]++;
    dbg(`DECK_INIT [${module}]`, { count: C[key] });
}

export function dbgSwipe(module, data) {
    if (!ENABLED) return;
    const isFirst = firstSwipeAfterLogin[module];
    if (isFirst) firstSwipeAfterLogin[module] = false;

    console.groupCollapsed(`[DECK-DEBUG] SWIPE [${module}] ${isFirst ? '★ FIRST AFTER LOGIN' : ''}`);
    console.log('data:', data);
    if (isFirst) {
        console.log('Current full snapshot:', fullSnapshot(`FIRST_SWIPE_${module}`));
    }
    console.groupEnd();
}

export function dbgSwipeMove(module, data) {
    if (!ENABLED) return;
    /* Only log the first few moves to avoid spam */
    if (!dbgSwipeMove._counts) dbgSwipeMove._counts = {};
    if (!dbgSwipeMove._counts[module]) dbgSwipeMove._counts[module] = 0;
    dbgSwipeMove._counts[module]++;
    if (dbgSwipeMove._counts[module] <= 3) {
        dbg(`SWIPE_MOVE [${module}]`, data);
    }
}

export function dbgSwipeEnd(module, data) {
    if (!ENABLED) return;
    dbgSwipeMove._counts = dbgSwipeMove._counts || {};
    dbgSwipeMove._counts[module] = 0;
    console.groupCollapsed(`[DECK-DEBUG] SWIPE_END [${module}]`);
    console.log('data:', data);
    console.groupEnd();
}

/* ── Global event watchers (self-install) ── */
if (ENABLED) {
    window.addEventListener('resize', () => {
        C.resize++;
        dbg('WINDOW_RESIZE', { count: C.resize, ...viewport() });
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            C.vvResize++;
            dbg('VISUAL_VIEWPORT_RESIZE', { count: C.vvResize, width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale });
        });
    }

    /* matchMedia breakpoint change */
    const mql = window.matchMedia('(max-width: 639px)');
    mql.addEventListener('change', e => {
        C.matchMediaChange++;
        dbg('MATCH_MEDIA_CHANGE', { matches: e.matches, count: C.matchMediaChange, ...viewport() });
    });

    /* Print summary on demand */
    window.__deckDebugSummary = () => {
        console.group('[DECK-DEBUG] === SUMMARY ===');
        console.table(C);
        console.log('snap_beforeLogin:', snap_beforeLogin);
        console.log('snap_afterLogin:', snap_afterLogin);
        console.log('snap_afterModalClose:', snap_afterModalClose);
        console.log('Current:', fullSnapshot('CURRENT'));
        console.groupEnd();
    };

    console.log('[DECK-DEBUG] Call __deckDebugSummary() at any time to print full state');
}

export { ENABLED as DECK_DEBUG_ENABLED };
