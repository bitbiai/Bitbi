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

/* Hero particles (index uses more particles, nebulae, connections) */
initParticles('heroCanvas', {
    maxParticles: 100,
    particleDensity: 15000,
    nebulaCount: 7,
    showConnections: true,
    connectionDistance: 280,
});

/* Binary rain (index uses more columns) */
initBinaryRain('binaryRain', {
    maxCols: 30,
    colDivisor: 40,
    charCount: 40,
    minDuration: 14,
    durationRange: 18,
});

/* Navbar */
initNavbar();
initMobileNav();

/* Scroll reveal */
const revealObserver = initScrollReveal();

/* Sections */
initExperiments(revealObserver);
initGallery();
initSoundLab(revealObserver);
initMarkets();

/* Binary footer */
initBinaryFooter('binaryFooter');

/* Smooth scroll */
initSmoothScroll();

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

initCookieConsent({
    onConsent: applyConsent,
    ytEnableBtnId: 'ytEnableBtn',
});
