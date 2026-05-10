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
import { initNewsPulse } from '../../shared/news-pulse.js?v=__ASSET_VERSION__';
import { initAuth, getAuthState } from '../../shared/auth-state.js';
import { initAuthModal, openAuthModal } from '../../shared/auth-modal.js';
import { initGalleryStudio } from './studio.js?v=__ASSET_VERSION__';
import { initSoundLabCreate } from './soundlab-create.js?v=__ASSET_VERSION__';
import { initVideoCreate } from './video-create.js?v=__ASSET_VERSION__';
import { initAuthNav } from './auth-nav.js';
import { initContact } from './contact.js?v=__ASSET_VERSION__';
import {
    HOMEPAGE_MODELS_OVERLAY_EXCLUDED_MODEL_IDS,
    initModelsOverlay,
} from '../../shared/models-overlay.js?v=__ASSET_VERSION__';
import { loadFavorites } from '../../shared/favorites.js';
import { initWalletController } from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { initGlobalAudioUI } from '../../shared/audio/audio-ui.js?v=__ASSET_VERSION__';
import { clearGenerateLabContext } from '../../shared/generate-lab-context.js?v=__ASSET_VERSION__';
import { initLocaleSwitcher, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';

try {
    if (!window.name || window.name === 'bitbi-generate-lab') {
        window.name = 'bitbi-main';
    }
} catch {
    /* Browser may block access to window.name in rare embedded contexts. */
}

try { clearGenerateLabContext(); } catch { /* Session storage may be unavailable. */ }

function initHeroBackgroundVideo() {
    const video = document.querySelector('[data-hero-video]');
    if (!video) return;

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const HERO_VIDEO_PLAYBACK_RATE = 1.5;
    let activeSource = '';
    let pausedByMenu = false;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    // defaultPlaybackRate persists across video.load(); playbackRate is the
    // currently-applied rate. Some browsers reset playbackRate when the src
    // changes, so we also re-apply it inside playVideo() and on loadedmetadata.
    video.defaultPlaybackRate = HERO_VIDEO_PLAYBACK_RATE;
    video.playbackRate = HERO_VIDEO_PLAYBACK_RATE;
    video.addEventListener('loadedmetadata', () => {
        video.playbackRate = HERO_VIDEO_PLAYBACK_RATE;
    });

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
        if (video.playbackRate !== HERO_VIDEO_PLAYBACK_RATE) {
            video.playbackRate = HERO_VIDEO_PLAYBACK_RATE;
        }
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

    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    let banner = null;
    let cta = null;
    let eyebrow = null;
    let title = null;
    let hint = null;

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

        cta = document.createElement('button');
        cta.type = 'button';
        cta.className = 'mobile-guest-banner__cta';
        eyebrow = document.createElement('span');
        eyebrow.className = 'mobile-guest-banner__eyebrow';

        title = document.createElement('span');
        title.className = 'mobile-guest-banner__title';

        hint = document.createElement('span');
        hint.className = 'mobile-guest-banner__hint';

        cta.append(eyebrow, title, hint);
        cta.addEventListener('click', () => {
            if (desktopQuery.matches) {
                openAuthModal('register');
                return;
            }
            menuBtn.click();
        });

        banner.appendChild(cta);
        hero.appendChild(banner);
        return banner;
    }

    function syncBannerCopy() {
        if (!cta || !eyebrow || !title || !hint) return;

        eyebrow.textContent = localeText('index.freeAccount');
        title.textContent = localeText('index.createAccountFree');

        if (desktopQuery.matches) {
            cta.setAttribute('aria-label', localeText('index.createFreeAccountAria'));
            hint.textContent = localeText('index.signInOrRegister');
            return;
        }

        cta.setAttribute('aria-label', localeText('index.openMenuCreateAccountAria'));
        hint.textContent = localeText('index.openMenuSignIn');
    }

    function renderBanner() {
        const { ready, loggedIn } = getAuthState();
        const shouldShow = ready && !loggedIn;

        if (!shouldShow) {
            if (banner?.isConnected) banner.remove();
            return;
        }

        ensureBanner();
        syncBannerCopy();
    }

    bindMediaQueryChange(desktopQuery, renderBanner);
    document.addEventListener('bitbi:auth-change', renderBanner);
    renderBanner();
}

function initHeroModelsCtaPlacement() {
    const wrap = document.querySelector('.hero__models-cta-wrap');
    const button = wrap?.querySelector('.hero__models-cta');
    const logo = document.querySelector('.site-nav__logo');
    const galleryLink = document.querySelector('.site-nav__links [data-category-link="gallery"]');
    const hero = document.querySelector('#hero');
    if (!wrap || !button || !logo || !galleryLink || !hero) return;

    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    let frame = 0;

    const place = () => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => {
            if (!desktopQuery.matches) {
                wrap.style.removeProperty('--hero-models-cta-inline-start');
                return;
            }

            const logoRect = logo.getBoundingClientRect();
            const galleryRect = galleryLink.getBoundingClientRect();
            const buttonRect = button.getBoundingClientRect();
            const heroRect = hero.getBoundingClientRect();
            if (!logoRect.width || !galleryRect.width || !buttonRect.width || !heroRect.width) return;

            const spaceCenter = logoRect.right + ((galleryRect.left - logoRect.right) / 2);
            const minLeft = heroRect.left + 16;
            const maxLeft = galleryRect.left - buttonRect.width - 12;
            const left = Math.min(Math.max(spaceCenter - (buttonRect.width / 2), minLeft), maxLeft);
            wrap.style.setProperty('--hero-models-cta-inline-start', `${Math.max(0, left - heroRect.left)}px`);
        });
    };

    place();
    window.addEventListener('resize', place, { passive: true });
    if (typeof desktopQuery.addEventListener === 'function') {
        desktopQuery.addEventListener('change', place);
    } else if (typeof desktopQuery.addListener === 'function') {
        desktopQuery.addListener(place);
    }
    document.fonts?.ready?.then(place).catch(() => {});
}

const authReady = initAuth().catch(e => console.warn('auth:', e));

try { initHeroBackgroundVideo(); } catch (e) { console.warn('heroVideo:', e); }
try { initHeroModelsCtaPlacement(); } catch (e) { console.warn('heroModelsCta:', e); }
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
try {
    initModelsOverlay(document, {
        excludeModelIds: HOMEPAGE_MODELS_OVERLAY_EXCLUDED_MODEL_IDS,
    });
} catch (e) { console.warn('modelsOverlay:', e); }

/* Scroll reveal */
let revealObserver = null;
try { revealObserver = initScrollReveal(); } catch (e) { console.warn('scrollReveal:', e); }

/* Sections */
try { initNewsPulse(document, { getAuthState }); } catch (e) { console.warn('newsPulse:', e); }
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
try { initLocaleSwitcher(); } catch (e) { console.warn('localeSwitcher:', e); }

/* Auth UI (non-blocking — awaited after all visual content renders) */
await authReady;
try { initAuthModal(); } catch (e) { console.warn('authModal:', e); }
try { initAuthNav(); } catch (e) { console.warn('authNav:', e); }
document.dispatchEvent(new CustomEvent('bitbi:homepage-auth-ui-ready'));

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

/* Video mode toggle (Explore / Create) */
try {
    const modeBtns = document.querySelectorAll('#video-creations .video-mode__btn[data-video-mode]');
    const explorePane = document.getElementById('videoExplore');
    const paginationPane = document.getElementById('videoPagination');
    const createPane = document.getElementById('videoCreate');
    if (modeBtns.length && explorePane && createPane) {
        let createInited = false;
        let currentMode = 'explore';
        let pendingCreate = false;
        let paginationDisplayBeforeCreate = paginationPane?.style.display || '';
        const createBtn = document.querySelector('#video-creations .video-mode__btn[data-video-mode="create"]');

        function setVideoMode(mode) {
            currentMode = mode;
            pendingCreate = false;
            modeBtns.forEach(btn => {
                const active = btn.dataset.videoMode === mode;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', String(active));
                btn.tabIndex = active ? 0 : -1;
            });
            explorePane.style.display = mode === 'explore' ? '' : 'none';
            if (paginationPane) {
                if (mode === 'create') {
                    paginationDisplayBeforeCreate = paginationPane.style.display;
                    paginationPane.style.display = 'none';
                } else {
                    paginationPane.style.display = paginationDisplayBeforeCreate;
                }
            }
            createPane.style.display = mode === 'create' ? '' : 'none';
            if (mode === 'create' && !createInited) {
                createInited = true;
                initVideoCreate();
            }
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.videoMode;
                if (mode === currentMode) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register');
                        return;
                    }
                }
                setVideoMode(mode);
            });
        });

        document.addEventListener('bitbi:auth-change', () => {
            const { loggedIn } = getAuthState();
            if (createBtn) {
                createBtn.classList.toggle('video-mode__btn--locked', !loggedIn);
            }
            if (loggedIn && pendingCreate) {
                setVideoMode('create');
            }
            if (!loggedIn && currentMode === 'create') {
                setVideoMode('explore');
            }
        });

        const { loggedIn } = getAuthState();
        if (createBtn) {
            createBtn.classList.toggle('video-mode__btn--locked', !loggedIn);
        }
    }
} catch (e) { console.warn('videoMode:', e); }

/* Sound Lab mode toggle (Explore / Create) */
try {
    const modeBtns = document.querySelectorAll('#soundlab .video-mode__btn[data-sound-mode]');
    const explorePane = document.getElementById('soundLabExplore');
    const createPane = document.getElementById('soundLabCreate');
    if (modeBtns.length && explorePane && createPane) {
        let createInited = false;
        let currentMode = 'explore';
        let pendingCreate = false;
        const createBtn = document.querySelector('#soundlab .video-mode__btn[data-sound-mode="create"]');

        function setSoundMode(mode) {
            currentMode = mode;
            pendingCreate = false;
            modeBtns.forEach(btn => {
                const active = btn.dataset.soundMode === mode;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', String(active));
                btn.tabIndex = active ? 0 : -1;
            });
            explorePane.style.display = mode === 'explore' ? '' : 'none';
            createPane.style.display = mode === 'create' ? '' : 'none';
            if (mode === 'create' && !createInited) {
                createInited = true;
                initSoundLabCreate();
            }
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.soundMode;
                if (mode === currentMode) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register');
                        return;
                    }
                }
                setSoundMode(mode);
            });
        });

        document.addEventListener('bitbi:auth-change', () => {
            const { loggedIn } = getAuthState();
            if (createBtn) {
                createBtn.classList.toggle('video-mode__btn--locked', !loggedIn);
            }
            if (loggedIn && pendingCreate) {
                setSoundMode('create');
            }
            if (!loggedIn && currentMode === 'create') {
                setSoundMode('explore');
            }
        });

        const { loggedIn } = getAuthState();
        if (createBtn) {
            createBtn.classList.toggle('video-mode__btn--locked', !loggedIn);
        }
    }
} catch (e) { console.warn('soundLabMode:', e); }
