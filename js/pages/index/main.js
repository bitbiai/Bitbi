/* ============================================================
   BITBI — Index page entry point
   Initializes all page modules
   ============================================================ */

import { initNavbar, initMobileNav } from './navbar.js';
import { initExperiments } from './experiments.js';
import { initGallery } from './gallery.js';
import { initSoundLab } from './soundlab.js';
import { initMarkets } from './markets.js';
import { initSmoothScroll } from './smooth-scroll.js';
import { initScrollReveal } from '../../shared/scroll-reveal.js';
import { initParticles } from '../../shared/particles.js';
import { initBinaryRain } from '../../shared/binary-rain.js';
import { initBinaryFooter } from '../../shared/binary-footer.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import { initAuth } from '../../shared/auth-state.js';
import { initAuthModal } from '../../shared/auth-modal.js';
import { initAuthNav } from './auth-nav.js';
import { initLockedSections } from './locked-sections.js';
import { initContact } from './contact.js';


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
try { initNavbar(); } catch (e) { console.warn('navbar:', e); }
try { initMobileNav(); } catch (e) { console.warn('mobileNav FAILED:', e); }

/* Scroll reveal */
let revealObserver = null;
try { revealObserver = initScrollReveal(); } catch (e) { console.warn('scrollReveal:', e); }

/* Sections */
try { initExperiments(revealObserver); } catch (e) { console.warn('experiments:', e); }
try { initGallery(); } catch (e) { console.warn('gallery:', e); }
try { initSoundLab(revealObserver); } catch (e) { console.warn('soundLab:', e); }
try { initMarkets(); } catch (e) { console.warn('markets:', e); }

/* Binary footer */
try { initBinaryFooter('binaryFooter'); } catch (e) { console.warn('binaryFooter:', e); }

/* Smooth scroll */
try { initSmoothScroll(); } catch (e) { console.warn('smoothScroll:', e); }

/* Contact form */
try { initContact(); } catch (e) { console.warn('contact:', e); }

/* Cookie consent with YouTube control */
function applyConsent(c) {
    const frame = document.getElementById('ytFrame');
    const placeholder = document.getElementById('ytPlaceholder');
    if (frame && placeholder) {
        if (c.marketing) {
            frame.src = frame.getAttribute('data-src');
            frame.style.display = '';
            placeholder.style.display = 'none';
        } else {
            frame.removeAttribute('src');
            frame.style.display = 'none';
            placeholder.style.display = 'flex';
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
