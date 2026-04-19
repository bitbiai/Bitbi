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

const NAV_HTML = `
<nav class="site-nav glass-nav" aria-label="Main navigation">
    <div class="container">
        <div class="site-nav__bar">
            <a href="/" class="site-nav__logo">
                <span class="site-nav__logo-text gt-hero">BITBI</span>
                <span class="site-nav__logo-glow" aria-hidden="true"></span>
            </a>
            <div class="site-nav__links">
                <a href="/#gallery" class="site-nav__link nav-link">Gallery</a>
                <a href="/#video-creations" class="site-nav__link nav-link">Video</a>
                <a href="/#soundlab" class="site-nav__link nav-link">Sound Lab</a>
                <a href="/#youtube" class="site-nav__link nav-link">YouTube</a>
                <a href="/#contact" class="site-nav__link nav-link">Contact</a>
                <button type="button" class="site-nav__link nav-link" data-models-link="desktop">Models</button>
            </div>
            <div class="site-nav__actions">
                <span class="site-nav__mood">Mood: <span class="site-nav__mood-value">Creating</span></span>
            </div>
            <button id="mobileMenuBtn" class="site-nav__menu-btn" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileNav">
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
            <a href="/#gallery" class="mobile-nav__link mobile-nav__link--primary">Gallery</a>
            <a href="/#video-creations" class="mobile-nav__link mobile-nav__link--primary">Video</a>
            <a href="/#soundlab" class="mobile-nav__link mobile-nav__link--primary">Sound Lab</a>
            <button type="button" class="mobile-nav__link mobile-nav__link--primary" data-models-link="mobile">Models</button>
        </nav>

        <nav class="mobile-nav__section" aria-label="Connect">
            <span class="mobile-nav__label">Connect</span>
            <a href="/#youtube" class="mobile-nav__link">YouTube</a>
            <a href="/#contact" class="mobile-nav__link">Contact</a>
        </nav>

        <div class="mobile-nav__footer">
            <div class="mobile-nav__social">
                <a href="https://x.com/bitbi_ai" target="_blank" rel="noopener noreferrer" class="mobile-nav__social-link" aria-label="X (Twitter)"><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
                <a href="https://www.youtube.com/@bitbi_ai" target="_blank" rel="noopener noreferrer" class="mobile-nav__social-link" aria-label="YouTube"><svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>
            </div>
            <div class="mobile-nav__legal">
                <a href="/legal/imprint.html" class="mobile-nav__legal-link">Imprint</a>
                <span class="mobile-nav__legal-dot">&bull;</span>
                <a href="/legal/privacy.html" class="mobile-nav__legal-link">Privacy</a>
                <span class="mobile-nav__legal-dot">&bull;</span>
                <button id="mobileOpenCookieSettings" class="mobile-nav__legal-link" type="button">Cookie Settings</button>
            </div>
        </div>
    </div>
</div>`;

export function initSiteHeader() {
    const header = document.querySelector('header');
    if (!header) return;

    /* 1. Replace header innerHTML with full nav */
    header.innerHTML = NAV_HTML;

    /* 2. Insert mobile nav panel after header */
    document.getElementById('mobileNav')?.remove();
    header.insertAdjacentHTML('afterend', MOBILE_NAV_HTML);

    /* 3. Init mobile nav behavior */
    try { initMobileNav(); } catch (e) { console.warn('mobileNav:', e); }
    try { initModelsOverlay(); } catch (e) { console.warn('modelsOverlay:', e); }
    try { initWalletController(); } catch (e) { console.warn('wallet:', e); }
    try { initGlobalAudioUI(); } catch (e) { console.warn('globalAudio:', e); }

    /* 4. Auth modal container (initAuthModal needs <div id="authModal"> in the DOM) */
    if (!document.getElementById('authModal')) {
        document.body.insertAdjacentHTML('beforeend', '<div id="authModal"></div>');
    }

    /* 5. Non-blocking auth init */
    initAuth()
        .then(() => {
            try { initAuthModal(); } catch (e) { console.warn('authModal:', e); }
            try { initAuthNav(); } catch (e) { console.warn('authNav:', e); }
        })
        .catch(e => console.warn('auth:', e));
}
