/* ============================================================
   BITBI — Index page entry point
   Initializes all page modules
   ============================================================ */

import { initMobileNav } from './navbar.js';
import { initGallery } from './gallery.js';
import { initSoundLab } from './soundlab.js';
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
import { loadFavorites } from '../../shared/favorites.js';
import { initWalletController } from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import { initGlobalAudioUI } from '../../shared/audio/audio-ui.js?v=__ASSET_VERSION__';


const authReady = initAuth().catch(e => console.warn('auth:', e));

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

/* Scroll reveal */
let revealObserver = null;
try { revealObserver = initScrollReveal(); } catch (e) { console.warn('scrollReveal:', e); }

/* Sections */
try { initGallery(); } catch (e) { console.warn('gallery:', e); }
try { initSoundLab(revealObserver); } catch (e) { console.warn('soundLab:', e); }

/* Binary footer */
try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn('binaryFooter:', e); }

/* Smooth scroll */
try { initSmoothScroll(); } catch (e) { console.warn('smoothScroll:', e); }

/* Contact form */
try { initContact(); } catch (e) { console.warn('contact:', e); }

/* Cookie consent with YouTube control */
const ALLOWED_YOUTUBE_HOSTS = new Set([
    'www.youtube.com',
    'youtube.com',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
]);

function getTrustedYouTubeSrc(frame) {
    const rawSrc = frame.getAttribute('data-src');
    if (!rawSrc) return null;

    try {
        const url = new URL(rawSrc, window.location.href);
        if (url.protocol !== 'https:') return null;
        if (!ALLOWED_YOUTUBE_HOSTS.has(url.hostname)) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function hideYouTubeEmbed(frame, placeholder) {
    frame.removeAttribute('src');
    frame.style.display = 'none';
    placeholder.style.display = 'flex';
}

function applyConsent(c) {
    const frame = document.getElementById('ytFrame');
    const placeholder = document.getElementById('ytPlaceholder');
    if (frame && placeholder) {
        if (c.marketing) {
            const trustedSrc = getTrustedYouTubeSrc(frame);
            if (trustedSrc) {
                frame.src = trustedSrc;
                frame.style.display = '';
                placeholder.style.display = 'none';
            } else {
                hideYouTubeEmbed(frame, placeholder);
            }
        } else {
            hideYouTubeEmbed(frame, placeholder);
        }
    }
}

try { initCookieConsent({
    onConsent: applyConsent,
    ytEnableBtnId: 'ytEnableBtn',
}); } catch (e) { console.warn('cookieConsent:', e); }

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
