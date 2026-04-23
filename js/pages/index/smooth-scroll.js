/* ============================================================
   BITBI — Smooth scroll for anchor links
   ============================================================ */

export function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        const href = a.getAttribute('href');
        if (a.hasAttribute('data-category-link') || href === '#contact') return;
        a.addEventListener('click', (e) => {
            if (href === '#') return;
            e.preventDefault();
            try {
                const target = document.querySelector(href);
                target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch { /* invalid selector */ }
        });
    });
}
