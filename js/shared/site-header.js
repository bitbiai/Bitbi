/* ============================================================
   BITBI — Shared site header for subpages
   Replaces minimal logo-only fallback with full nav + mobile menu
   ============================================================ */

import { initMobileNav } from './navbar.js';
import { initAuth } from './auth-state.js';
import { initAuthModal } from './auth-modal.js';
import { initAuthNav } from './auth-nav.js';
import { initWalletController } from './wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { initGlobalAudioUI } from './audio/audio-ui.js?v=__ASSET_VERSION__';
import { initModelsOverlay } from './models-overlay.js?v=__ASSET_VERSION__';
import {
    GENERATE_LAB_HOME_PATH,
    applyGenerateLabReturnLinks,
    isGenerateLabContextActive,
} from './generate-lab-context.js?v=__ASSET_VERSION__';

const HOME_CATEGORY_NAV_STATE_KEY = 'bitbi:pending-home-category';
const HOME_DESKTOP_STAGE_MEDIA = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

const NAV_HTML = `
<nav id="navbar" class="site-nav glass-nav" aria-label="Main navigation">
    <div class="container">
        <div class="site-nav__bar">
            <a href="/" class="site-nav__logo">
                <span class="site-nav__logo-text gt-hero">BITBI</span>
                <span class="site-nav__context-label" data-site-context-label hidden></span>
                <span class="site-nav__logo-glow" aria-hidden="true"></span>
            </a>
            <div class="site-nav__links">
                <a href="/#gallery" class="site-nav__link nav-link" data-category-link="gallery">Gallery</a>
                <a href="/#video-creations" class="site-nav__link nav-link" data-category-link="video">Video</a>
                <a href="/#soundlab" class="site-nav__link nav-link" data-category-link="sound">Sound Lab</a>
            </div>
            <div class="site-nav__actions">
                <span class="site-nav__mood">Mood: <span class="site-nav__mood-value">Creating</span></span>
            </div>
            <button type="button" id="mobileMenuBtn" class="site-nav__menu-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileNav">
                <span class="site-nav__menu-bar" id="bar1"></span>
                <span class="site-nav__menu-bar" id="bar2"></span>
                <span class="site-nav__menu-bar site-nav__menu-bar--short" id="bar3"></span>
            </button>
        </div>
    </div>
</nav>`;

const MOBILE_NAV_HTML = `
<div id="mobileNav" class="mobile-nav-panel" role="dialog" aria-modal="true" aria-label="Navigation menu" aria-hidden="true">
    <div id="frozenBackdrop" class="mobile-nav__backdrop" aria-hidden="true"></div>
    <div id="frozenRainLayer" class="mobile-nav__rain-layer" aria-hidden="true"></div>
    <button id="mobileNavClose" class="mobile-nav__close" type="button" aria-label="Close menu">&times;</button>
    <div class="mobile-nav__inner">
        <div id="mobileNavAuth" class="mobile-nav__auth"></div>

        <nav class="mobile-nav__section" aria-label="Explore">
            <span class="mobile-nav__label">Explore</span>
            <a href="/#gallery" class="mobile-nav__link mobile-nav__link--primary" data-category-link="gallery">Gallery</a>
            <a href="/#video-creations" class="mobile-nav__link mobile-nav__link--primary" data-category-link="video">Video</a>
            <a href="/#soundlab" class="mobile-nav__link mobile-nav__link--primary" data-category-link="sound">Sound Lab</a>
            <button type="button" class="mobile-nav__link mobile-nav__link--primary" data-models-link="mobile">Models</button>
        </nav>

        <nav class="mobile-nav__section" aria-label="Connect">
            <span class="mobile-nav__label">Connect</span>
            <a href="/#contact" class="mobile-nav__link">Contact</a>
        </nav>

        <div class="mobile-nav__footer">
            <div class="mobile-nav__social">
                <a href="https://x.com/bitbi_ai" target="_blank" rel="noopener noreferrer" class="mobile-nav__social-link" aria-label="X (Twitter)"><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
            </div>
            <div class="mobile-nav__legal">
                <a href="/legal/imprint.html" class="mobile-nav__legal-link">Imprint</a>
                <span class="mobile-nav__legal-dot">&bull;</span>
                <a href="/legal/privacy.html" class="mobile-nav__legal-link">Privacy</a>
                <span class="mobile-nav__legal-dot">&bull;</span>
                <a href="/legal/terms.html" class="mobile-nav__legal-link">AGB</a>
                <span class="mobile-nav__legal-dot">&bull;</span>
                <button id="mobileOpenCookieSettings" class="mobile-nav__legal-link" type="button">Cookie Settings</button>
            </div>
        </div>
    </div>
</div>`;

export function initSiteHeader(options = {}) {
    const isGenerateLabPage = options.isGenerateLabPage === true || document.body.classList.contains('generate-lab-page');
    const generateLabContext = !isGenerateLabPage && options.generateLabContext !== false && isGenerateLabContextActive();
    const showCategoryLinks = generateLabContext ? false : options.showCategoryLinks !== false;
    const enableGlobalAudio = generateLabContext ? false : options.enableGlobalAudio !== false;
    const homeHref = generateLabContext
        ? GENERATE_LAB_HOME_PATH
        : (typeof options.homeHref === 'string' && options.homeHref.trim() ? options.homeHref.trim() : '/');
    const homeTarget = typeof options.homeTarget === 'string' ? options.homeTarget.trim() : '';
    const homeRel = typeof options.homeRel === 'string' ? options.homeRel.trim() : '';
    const contextLabel = typeof options.contextLabel === 'string'
        ? options.contextLabel.trim()
        : (generateLabContext ? 'Desktop Workspace' : '');
    const header = document.querySelector('header');
    if (!header) return;
    const desktopStageQuery = window.matchMedia?.(HOME_DESKTOP_STAGE_MEDIA);

    /* 1. Replace header innerHTML with full nav */
    header.innerHTML = NAV_HTML;
    const logoLink = header.querySelector('.site-nav__logo');
    if (logoLink) {
        logoLink.setAttribute('href', homeHref);
    }
    const label = header.querySelector('[data-site-context-label]');
    if (label && contextLabel) {
        label.textContent = contextLabel;
        label.hidden = false;
        logoLink?.classList.add('site-nav__logo--context');
    }
    if (logoLink && homeTarget && !generateLabContext) {
        logoLink.setAttribute('target', homeTarget);
        if (homeRel) logoLink.setAttribute('rel', homeRel);
    }
    if (!showCategoryLinks) {
        const navLinks = header.querySelector('.site-nav__links');
        navLinks?.replaceChildren();
        navLinks?.classList.add('site-nav__links--empty');
    }

    /* 2. Insert mobile nav panel after header */
    document.getElementById('mobileNav')?.remove();
    header.insertAdjacentHTML('afterend', MOBILE_NAV_HTML);
    const mobileNav = document.getElementById('mobileNav');
    if (!showCategoryLinks) {
        mobileNav?.querySelectorAll('[data-category-link]').forEach((link) => link.remove());
    }

    const primeHomeCategoryNav = (event) => {
        const anchor = event.target.closest('a[data-category-link]');
        if (!anchor) return;
        try {
            const url = new URL(anchor.href, window.location.href);
            if (url.origin !== window.location.origin || url.pathname !== '/' || !url.hash) return;
            window.sessionStorage?.setItem(HOME_CATEGORY_NAV_STATE_KEY, url.hash);
            if (window.location.pathname !== '/' && desktopStageQuery?.matches) {
                event.preventDefault();
                window.location.assign(`${url.pathname}${url.search}`);
            }
        } catch {
            /* noop */
        }
    };

    header.addEventListener('click', primeHomeCategoryNav);
    mobileNav?.addEventListener('click', primeHomeCategoryNav);

    /* 3. Init mobile nav behavior */
    try { initMobileNav(); } catch (e) { console.warn('mobileNav:', e); }
    try { initModelsOverlay(); } catch (e) { console.warn('modelsOverlay:', e); }
    try { initWalletController(); } catch (e) { console.warn('wallet:', e); }
    if (enableGlobalAudio) {
        try { initGlobalAudioUI(); } catch (e) { console.warn('globalAudio:', e); }
    }

    /* 4. Auth modal container (initAuthModal needs <div id="authModal"> in the DOM) */
    if (!document.getElementById('authModal')) {
        document.body.insertAdjacentHTML('beforeend', '<div id="authModal"></div>');
    }

    /* 5. Non-blocking auth init */
    initAuth()
        .then(() => {
            try { initAuthModal(); } catch (e) { console.warn('authModal:', e); }
            try { initAuthNav(); } catch (e) { console.warn('authNav:', e); }
            if (generateLabContext) applyGenerateLabReturnLinks(document);
        })
        .catch(e => console.warn('auth:', e));

    if (generateLabContext) applyGenerateLabReturnLinks(document);
}
