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
import { initAuthEntryActions } from '../../shared/auth-entry-actions.js?v=__ASSET_VERSION__';
import { initCreationStreamAnchor } from './creation-stream-anchor.js?v=__ASSET_VERSION__';
import { initLatestModelsVideoModule } from './latest-models-video-module.js?v=__ASSET_VERSION__';
import { initHomepageHeroResponsiveScale } from './hero-responsive-scale.js?v=__ASSET_VERSION__';
import { initAuthNav } from './auth-nav.js';
import { initContact } from './contact.js?v=__ASSET_VERSION__';
import { loadFavorites } from '../../shared/favorites.js';
import { initWalletController } from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { initGlobalAudioUI } from '../../shared/audio/audio-ui.js?v=__ASSET_VERSION__';
import { clearGenerateLabContext } from '../../shared/generate-lab-context.js?v=__ASSET_VERSION__';
import { initLocaleSwitcher, localeText } from '../../shared/locale.js?v=__ASSET_VERSION__';
import { initHelpMenu } from '../../shared/help-menu.js?v=__ASSET_VERSION__';

try {
    if (!window.name || window.name === 'bitbi-generate-lab') {
        window.name = 'bitbi-main';
    }
} catch {
    /* Browser may block access to window.name in rare embedded contexts. */
}

try { clearGenerateLabContext(); } catch { /* Session storage may be unavailable. */ }

const createModulePromises = {
    galleryStudio: null,
    videoCreate: null,
    soundLabCreate: null,
};
const HOMEPAGE_MODELS_OVERLAY_EXCLUDED_MODEL_IDS = Object.freeze([
    '@cf/black-forest-labs/flux-2-dev',
]);
const HOMEPAGE_ASSETS_MANAGER_STYLES_ID = 'bitbiHomepageAssetsManagerStyles';
const HOMEPAGE_ASSETS_MANAGER_STYLES_HREF = '/css/account/assets-manager.css?v=__ASSET_VERSION__';
let modelsOverlayModulePromise = null;
let modelsOverlayInitialized = false;
let homepageAssetsManagerStylesPromise = null;

function findLoadedHomepageAssetsManagerStyles() {
    return document.getElementById(HOMEPAGE_ASSETS_MANAGER_STYLES_ID)
        || document.querySelector('link[rel="stylesheet"][href*="css/account/assets-manager.css"]');
}

function loadHomepageAssetsManagerStyles() {
    const existing = findLoadedHomepageAssetsManagerStyles();
    if (existing) return Promise.resolve(existing);
    if (homepageAssetsManagerStylesPromise) return homepageAssetsManagerStylesPromise;

    homepageAssetsManagerStylesPromise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.id = HOMEPAGE_ASSETS_MANAGER_STYLES_ID;
        link.rel = 'stylesheet';
        link.href = HOMEPAGE_ASSETS_MANAGER_STYLES_HREF;
        link.addEventListener('load', () => resolve(link), { once: true });
        link.addEventListener('error', () => {
            homepageAssetsManagerStylesPromise = null;
            reject(new Error('Homepage Assets Manager stylesheet failed to load'));
        }, { once: true });
        document.head.appendChild(link);
    });

    return homepageAssetsManagerStylesPromise;
}

function ensureHomepageAssetsManagerStyles() {
    return loadHomepageAssetsManagerStyles().catch((error) => {
        console.warn('homepageAssetsManagerStyles:', error);
    });
}

function loadCreateModule(cacheKey, importer) {
    if (!createModulePromises[cacheKey]) {
        createModulePromises[cacheKey] = importer().catch((error) => {
            createModulePromises[cacheKey] = null;
            throw error;
        });
    }
    return createModulePromises[cacheKey];
}

function initCreateModule(cacheKey, importer, exportName, warningLabel) {
    return Promise.all([
        ensureHomepageAssetsManagerStyles(),
        loadCreateModule(cacheKey, importer),
    ])
        .then(([, module]) => {
            const init = module?.[exportName];
            if (typeof init !== 'function') {
                throw new Error(`${exportName} export unavailable`);
            }
            init();
        })
        .catch((error) => {
            console.warn(`${warningLabel}:`, error);
            throw error;
        });
}

function initGalleryStudioLazy() {
    return initCreateModule(
        'galleryStudio',
        () => import('./studio.js?v=__ASSET_VERSION__'),
        'initGalleryStudio',
        'galleryStudio',
    );
}

function initVideoCreateLazy() {
    return initCreateModule(
        'videoCreate',
        () => import('./video-create.js?v=__ASSET_VERSION__'),
        'initVideoCreate',
        'videoCreate',
    );
}

function initSoundLabCreateLazy() {
    return initCreateModule(
        'soundLabCreate',
        () => import('./soundlab-create.js?v=__ASSET_VERSION__'),
        'initSoundLabCreate',
        'soundLabCreate',
    );
}

function loadModelsOverlayModule() {
    if (!modelsOverlayModulePromise) {
        modelsOverlayModulePromise = import('../../shared/models-overlay.js?v=__ASSET_VERSION__')
            .catch((error) => {
                modelsOverlayModulePromise = null;
                throw error;
            });
    }
    return modelsOverlayModulePromise;
}

async function initModelsOverlayLazy() {
    const module = await loadModelsOverlayModule();
    if (!modelsOverlayInitialized) {
        if (typeof module?.initModelsOverlay !== 'function') {
            throw new Error('initModelsOverlay export unavailable');
        }
        module.initModelsOverlay(document, {
            excludeModelIds: HOMEPAGE_MODELS_OVERLAY_EXCLUDED_MODEL_IDS,
        });
        modelsOverlayInitialized = true;
    }
    return module;
}

function closeMobileNavForModelsOverlay() {
    document.getElementById('mobileNavClose')?.click();
}

function openModelsOverlayFromModule(module, { isMobile = false } = {}) {
    if (isMobile && typeof module?.openModelsOverlay === 'function') {
        module.openModelsOverlay();
        return;
    }
    if (!isMobile && typeof module?.toggleModelsOverlay === 'function') {
        module.toggleModelsOverlay();
        return;
    }
    if (typeof module?.openModelsOverlay === 'function') {
        module.openModelsOverlay();
    }
}

function initDeferredModelsOverlay() {
    const triggers = document.querySelectorAll('[data-models-link]');
    const handleLazyTrigger = (event) => {
        if (modelsOverlayInitialized) return;

        event.preventDefault();
        const trigger = event.currentTarget;
        const isMobile = trigger?.dataset?.modelsLink === 'mobile';
        const requestedAt = performance.now();
        if (isMobile) closeMobileNavForModelsOverlay();

        initModelsOverlayLazy()
            .then((module) => {
                const openNow = () => openModelsOverlayFromModule(module, { isMobile });
                const remainingDelay = isMobile ? Math.max(0, 120 - (performance.now() - requestedAt)) : 0;
                if (remainingDelay > 0) {
                    window.setTimeout(openNow, remainingDelay);
                } else {
                    openNow();
                }
            })
            .catch((error) => {
                console.warn('modelsOverlay:', error);
            });
    };

    triggers.forEach((trigger) => {
        if (trigger.dataset.modelsOverlayLazyBound === 'true') return;
        trigger.dataset.modelsOverlayLazyBound = 'true';
        trigger.addEventListener('click', handleLazyTrigger);
    });

    const syncModelsHash = () => {
        if (window.location.hash !== '#models') return;
        initModelsOverlayLazy()
            .then((module) => {
                if (window.location.hash === '#models') {
                    module.openModelsOverlay?.();
                }
            })
            .catch((error) => {
                console.warn('modelsOverlay:', error);
            });
    };

    window.addEventListener('hashchange', syncModelsHash);
    if (window.location.hash === '#models') {
        requestAnimationFrame(syncModelsHash);
    }
}

function initMobileGuestBanner() {
    const headerBar = document.querySelector('#navbar .site-nav__bar');
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (!headerBar || !menuBtn) return;

    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    let banner = null;
    let cta = null;
    let title = null;

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
        title = document.createElement('span');
        title.className = 'mobile-guest-banner__title';

        cta.append(title);
        cta.addEventListener('click', () => {
            openAuthModal('register', { contextKey: 'authRecovery.publicMessage' });
        });

        banner.appendChild(cta);
        headerBar.appendChild(banner);
        return banner;
    }

    function syncBannerCopy() {
        if (!cta || !title) return;

        title.textContent = localeText('index.createAccountFree');

        if (desktopQuery.matches) {
            cta.setAttribute('aria-label', localeText('index.createFreeAccountAria'));
            return;
        }

        cta.setAttribute('aria-label', localeText('index.openMenuCreateAccountAria'));
    }

    function renderBanner() {
        const { ready, loggedIn } = getAuthState();
        const shouldShow = ready && !loggedIn && desktopQuery.matches;

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
    const wrap = document.querySelector('.hero__models-cta-wrap--right, .hero__models-cta-wrap:not(.hero__models-cta-wrap--left)');
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

try { initHomepageHeroResponsiveScale(); } catch (e) { console.warn('heroResponsiveScale:', e); }
try { initHeroModelsCtaPlacement(); } catch (e) { console.warn('heroModelsCta:', e); }
try { initCreationStreamAnchor(); } catch (e) { console.warn('creationStreamAnchor:', e); }
try { initLatestModelsVideoModule(); } catch (e) { console.warn('latestModelsVideoModule:', e); }
try { initMobileGuestBanner(); } catch (e) { console.warn('guestBanner:', e); }

/* Hero particles (index uses more particles, nebulae, connections) */
try { initParticles('heroCanvas', {
    maxParticles: 0,
    particleDensity: 15000,
    nebulaCount: 0,
    showConnections: false,
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
try { initHelpMenu(); } catch (e) { console.warn('helpMenu FAILED:', e); }
try { initGlobalAudioUI(); } catch (e) { console.warn('globalAudio FAILED:', e); }

/* Models overlay */
try {
    initDeferredModelsOverlay();
} catch (e) { console.warn('modelsOverlay:', e); }

/* Scroll reveal */
let revealObserver = null;
try { revealObserver = initScrollReveal(); } catch (e) { console.warn('scrollReveal:', e); }

/* Sections */
try {
    const newsPulse = document.querySelector('[data-news-pulse]');
    if (!newsPulse?.dataset.newsPulseDisabled) {
        initNewsPulse(document, { getAuthState });
    }
} catch (e) { console.warn('newsPulse:', e); }
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
try { initAuthEntryActions(); } catch (e) { console.warn('authEntryActions:', e); }
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
        let studioReady = false;
        let studioInitPromise = null;
        let currentMode = 'explore';
        let pendingCreate = false;
        let createModeLoadRequested = false;
        const createBtn = document.querySelector('.gallery-mode__btn[data-mode="create"]');

        function ensureGalleryStudioReady() {
            if (studioReady) return Promise.resolve();
            if (!studioInitPromise) {
                studioInitPromise = initGalleryStudioLazy()
                    .then(() => {
                        studioReady = true;
                    })
                    .catch((error) => {
                        studioInitPromise = null;
                        throw error;
                    });
            }
            return studioInitPromise;
        }

        studioPane.addEventListener('click', (event) => {
            const button = event.target.closest?.('#galStudioGenerate');
            if (!button || studioReady) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            ensureGalleryStudioReady()
                .then(() => {
                    button.click();
                })
                .catch(() => {});
        }, true);

        function renderGalleryMode(mode) {
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
        }

        function setGalleryMode(mode) {
            if (mode === 'create' && !studioReady) {
                createModeLoadRequested = true;
                ensureGalleryStudioReady()
                    .then(() => {
                        if (createModeLoadRequested) renderGalleryMode(mode);
                    })
                    .catch(() => {
                        createModeLoadRequested = false;
                    });
                return;
            }
            createModeLoadRequested = false;
            renderGalleryMode(mode);
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                if (mode === currentMode && !(mode === 'explore' && createModeLoadRequested)) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register', { contextKey: 'authRecovery.publicMessage' });
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
        let createReady = false;
        let createInitPromise = null;
        let currentMode = 'explore';
        let pendingCreate = false;
        let createModeLoadRequested = false;
        let paginationDisplayBeforeCreate = paginationPane?.style.display || '';
        const createBtn = document.querySelector('#video-creations .video-mode__btn[data-video-mode="create"]');

        function ensureVideoCreateReady() {
            if (createReady) return Promise.resolve();
            if (!createInitPromise) {
                createInitPromise = initVideoCreateLazy()
                    .then(() => {
                        createReady = true;
                    })
                    .catch((error) => {
                        createInitPromise = null;
                        throw error;
                    });
            }
            return createInitPromise;
        }

        createPane.addEventListener('click', (event) => {
            const button = event.target.closest?.('#videoGenerate');
            if (!button || createReady) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            ensureVideoCreateReady()
                .then(() => {
                    button.click();
                })
                .catch(() => {});
        }, true);

        function renderVideoMode(mode) {
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
        }

        function setVideoMode(mode) {
            if (mode === 'create' && !createReady) {
                createModeLoadRequested = true;
                ensureVideoCreateReady()
                    .then(() => {
                        if (createModeLoadRequested) renderVideoMode(mode);
                    })
                    .catch(() => {
                        createModeLoadRequested = false;
                    });
                return;
            }
            createModeLoadRequested = false;
            renderVideoMode(mode);
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.videoMode;
                if (mode === currentMode && !(mode === 'explore' && createModeLoadRequested)) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register', { contextKey: 'authRecovery.publicMessage' });
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
        let createReady = false;
        let createInitPromise = null;
        let currentMode = 'explore';
        let pendingCreate = false;
        let createModeLoadRequested = false;
        const createBtn = document.querySelector('#soundlab .video-mode__btn[data-sound-mode="create"]');

        function ensureSoundLabCreateReady() {
            if (createReady) return Promise.resolve();
            if (!createInitPromise) {
                createInitPromise = initSoundLabCreateLazy()
                    .then(() => {
                        createReady = true;
                    })
                    .catch((error) => {
                        createInitPromise = null;
                        throw error;
                    });
            }
            return createInitPromise;
        }

        createPane.addEventListener('click', (event) => {
            const button = event.target.closest?.('#soundMusicGenerate');
            if (!button || createReady) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            ensureSoundLabCreateReady()
                .then(() => {
                    button.click();
                })
                .catch(() => {});
        }, true);

        function renderSoundMode(mode) {
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
        }

        function setSoundMode(mode) {
            if (mode === 'create' && !createReady) {
                createModeLoadRequested = true;
                ensureSoundLabCreateReady()
                    .then(() => {
                        if (createModeLoadRequested) renderSoundMode(mode);
                    })
                    .catch(() => {
                        createModeLoadRequested = false;
                    });
                return;
            }
            createModeLoadRequested = false;
            renderSoundMode(mode);
        }

        modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.soundMode;
                if (mode === currentMode && !(mode === 'explore' && createModeLoadRequested)) return;
                if (mode === 'create') {
                    const { loggedIn } = getAuthState();
                    if (!loggedIn) {
                        pendingCreate = true;
                        openAuthModal('register', { contextKey: 'authRecovery.publicMessage' });
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
