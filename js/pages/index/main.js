/* ============================================================
   BITBI — Index page entry point
   Initializes all page modules
   ============================================================ */

import { initMobileNav } from './navbar.js';
import { initGallery } from './gallery.js';
import { initVideoGallery } from './video-gallery.js?v=__ASSET_VERSION__';
import { initSoundLab } from './soundlab.js';
import { initCategoryCarousel } from './category-carousel.js?v=__ASSET_VERSION__';
import { initSmoothScroll } from './smooth-scroll.js';
import { initScrollReveal } from '../../shared/scroll-reveal.js';
import { initParticles } from '../../shared/particles.js';
import { initBinaryRain } from '../../shared/binary-rain.js';
import { initBinaryFooter } from '../../shared/binary-footer.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { initAuth, getAuthState } from '../../shared/auth-state.js';
import { initAuthModal, openAuthModal } from '../../shared/auth-modal.js';
import { initGalleryStudio } from './studio.js?v=__ASSET_VERSION__';
import { initAuthNav } from './auth-nav.js';
import { initLockedSections } from './locked-sections.js';
import { initContact } from './contact.js';
import { initModelsOverlay } from '../../shared/models-overlay.js?v=__ASSET_VERSION__';
import { loadFavorites } from '../../shared/favorites.js';
import { initWalletController } from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { initGlobalAudioUI } from '../../shared/audio/audio-ui.js?v=__ASSET_VERSION__';

function initHeroBackgroundVideo() {
    const video = document.querySelector('[data-hero-video]');
    if (!video) return;

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let activeSource = '';
    let pausedByMenu = false;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    function setVideoActive(active) {
        video.classList.toggle('is-active', !!active);
    }

    function clearVideoSource() {
        if (!activeSource && !video.getAttribute('src')) return;
        video.pause();
        video.removeAttribute('src');
        activeSource = '';
        setVideoActive(false);
        video.load();
    }

    function supportsWebmPlayback() {
        if (typeof video.canPlayType !== 'function') return false;
        return Boolean(
            video.canPlayType('video/webm; codecs="vp9, vorbis"')
            || video.canPlayType('video/webm'),
        );
    }

    function resolveVideoSource() {
        if (reducedMotionQuery.matches) return '';
        if (mobileQuery.matches) {
            return video.dataset.srcMobileMp4 || video.dataset.srcDesktopMp4 || '';
        }
        if (supportsWebmPlayback()) {
            return video.dataset.srcDesktopWebm || video.dataset.srcDesktopMp4 || '';
        }
        return video.dataset.srcDesktopMp4 || video.dataset.srcDesktopWebm || '';
    }

    function playVideo() {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                setVideoActive(false);
            });
        }
    }

    function syncHeroBackgroundVideo() {
        const nextSource = resolveVideoSource();

        if (!nextSource) {
            video.hidden = true;
            clearVideoSource();
            return;
        }

        video.hidden = false;

        if (activeSource !== nextSource) {
            activeSource = nextSource;
            setVideoActive(false);
            video.src = nextSource;
            video.load();
        }

        if (!pausedByMenu && document.visibilityState === 'visible') {
            playVideo();
        }
    }

    function resumeVideoIfPossible() {
        if (!activeSource || pausedByMenu || reducedMotionQuery.matches) return;
        if (document.visibilityState !== 'visible') return;
        playVideo();
    }

    function bindMediaQueryChange(query, listener) {
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', listener);
            return;
        }
        if (typeof query.addListener === 'function') {
            query.addListener(listener);
        }
    }

    const handleQueryChange = () => {
        syncHeroBackgroundVideo();
    };

    bindMediaQueryChange(reducedMotionQuery, handleQueryChange);
    bindMediaQueryChange(mobileQuery, handleQueryChange);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            video.pause();
            return;
        }
        resumeVideoIfPossible();
    });

    document.addEventListener('bitbi:mobile-nav-toggle', (event) => {
        pausedByMenu = !!event.detail?.open;
        if (pausedByMenu) {
            video.pause();
            return;
        }
        resumeVideoIfPossible();
    });

    video.addEventListener('playing', () => {
        setVideoActive(true);
    });

    video.addEventListener('error', () => {
        setVideoActive(false);
    });

    syncHeroBackgroundVideo();
}

function initMobileGuestBanner() {
    const hero = document.getElementById('hero');
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (!hero || !menuBtn) return;

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    let banner = null;

    function bindMediaQueryChange(query, listener) {
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', listener);
            return;
        }
        if (typeof query.addListener === 'function') {
            query.addListener(listener);
        }
    }

    function ensureBanner() {
        if (banner?.isConnected) return banner;

        banner = document.createElement('div');
        banner.id = 'mobileGuestBanner';
        banner.className = 'mobile-guest-banner';

        const cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'mobile-guest-banner__cta';
        cta.setAttribute('aria-label', 'Open the menu to create a free BITBI account');
        cta.innerHTML = `
            <span class="mobile-guest-banner__eyebrow">Free Account</span>
            <span class="mobile-guest-banner__title">Create your BITBI account for free</span>
            <span class="mobile-guest-banner__hint">Open the menu to sign in or register</span>
        `;
        cta.addEventListener('click', () => menuBtn.click());

        banner.appendChild(cta);
        hero.appendChild(banner);
        return banner;
    }

    function renderBanner() {
        const { ready, loggedIn } = getAuthState();
        const shouldShow = mobileQuery.matches && ready && !loggedIn;

        if (!shouldShow) {
            if (banner?.isConnected) banner.remove();
            return;
        }

        ensureBanner();
    }

    bindMediaQueryChange(mobileQuery, renderBanner);
    document.addEventListener('bitbi:auth-change', renderBanner);
    renderBanner();
}

const authReady = initAuth().catch(e => console.warn('auth:', e));

try { initHeroBackgroundVideo(); } catch (e) { console.warn('heroVideo:', e); }
try { initMobileGuestBanner(); } catch (e) { console.warn('guestBanner:', e); }

/* Hero particles (index uses more particles, nebulae, connections) */
try { initParticles('heroCanvas', {
    maxParticles: 100,
    particleDensity: 15000,
    nebulaCount: 7,
    showConnections: true,
    connectionDistance: 280,
}); } catch (e) { console.warn('particles:', e); }

/* Binary rain (index uses more columns) */
try { initBinaryRain('binaryRain', {
    maxCols: 30,
    colDivisor: 40,
    charCount: 40,
    minDuration: 14,
    durationRange: 18,
}); } catch (e) { console.warn('binaryRain:', e); }

/* Navbar */
try { initMobileNav(); } catch (e) { console.warn('mobileNav FAILED:', e); }
try { initWalletController(); } catch (e) { console.warn('wallet FAILED:', e); }
try { initGlobalAudioUI(); } catch (e) { console.warn('globalAudio FAILED:', e); }

/* Models overlay */
try { initModelsOverlay(); } catch (e) { console.warn('modelsOverlay:', e); }

/* Scroll reveal */
let revealObserver = null;
try { revealObserver = initScrollReveal(); } catch (e) { console.warn('scrollReveal:', e); }

/* Sections */
try { initGallery(); } catch (e) { console.warn('gallery:', e); }
try { initVideoGallery(); } catch (e) { console.warn('videoGallery:', e); }
try { initSoundLab(revealObserver); } catch (e) { console.warn('soundLab:', e); }
try { initCategoryCarousel(); } catch (e) { console.warn('categoryCarousel:', e); }

/* Binary footer */
try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn('binaryFooter:', e); }

/* Smooth scroll */
try { initSmoothScroll(); } catch (e) { console.warn('smoothScroll:', e); }

/* Contact form */
try { initContact(); } catch (e) { console.warn('contact:', e); }

/* Cookie consent */
try { initCookieConsent(); } catch (e) { console.warn('cookieConsent:', e); }

/* Auth UI (non-blocking — awaited after all visual content renders) */
await authReady;
try { initAuthModal(); } catch (e) { console.warn('authModal:', e); }
try { initAuthNav(); } catch (e) { console.warn('authNav:', e); }
try { initLockedSections(revealObserver); } catch (e) { console.warn('lockedSections:', e); }

/* Load user favorites (updates star button states) */
loadFavorites().catch(e => console.warn('favorites:', e));

/* Reload favorites on auth change */
document.addEventListener('bitbi:auth-change', () => {
    loadFavorites().catch(e => console.warn('favorites:', e));
});

/* Gallery mode toggle (Explore / Create) */
try {
    const modeBtns = document.querySelectorAll('.gallery-mode__btn');
    const explorePane = document.getElementById('galleryExplore');
    const studioPane = document.getElementById('galleryStudio');
    if (modeBtns.length && explorePane && studioPane) {
        let studioInited = false;
        let currentMode = 'explore';
        let pendingCreate = false;
        const createBtn = document.querySelector('.gallery-mode__btn[data-mode="create"]');

        function setGalleryMode(mode) {
            currentMode = mode;
            pendingCreate = false;
            modeBtns.forEach(btn => {
                const active = btn.dataset.mode === mode;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', String(active));
                btn.tabIndex = active ? 0 : -1;
            });
            explorePane.style.display = mode === 'explore' ? '' : 'none';
            studioPane.style.display = mode === 'create' ? '' : 'none';
            if (mode === 'create' && !studioInited) {
                studioInited = true;
                initGalleryStudio();
            }
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode === currentMode) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register');
                        return;
                    }
                }
                setGalleryMode(mode);
            });
        });

        document.addEventListener('bitbi:auth-change', () => {
            const { loggedIn } = getAuthState();
            if (createBtn) {
                createBtn.classList.toggle('gallery-mode__btn--locked', !loggedIn);
            }
            if (loggedIn && pendingCreate) {
                setGalleryMode('create');
            }
            if (!loggedIn && currentMode === 'create') {
                setGalleryMode('explore');
            }
        });

        /* Sync button to current auth state (event already fired during initAuth) */
        const { loggedIn } = getAuthState();
        if (createBtn && loggedIn) {
            createBtn.classList.remove('gallery-mode__btn--locked');
        }
    }
} catch (e) { console.warn('galleryMode:', e); }
