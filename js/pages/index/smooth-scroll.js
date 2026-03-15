/* ============================================================
   BITBI — Smooth scroll for anchor links
   ============================================================ */

export function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', (e) => {
            const href = a.getAttribute('href');
            if (href === '#') return;
            e.preventDefault();
            try {
                const target = document.querySelector(href);
                target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch { /* invalid selector */ }
        });
    });
}
