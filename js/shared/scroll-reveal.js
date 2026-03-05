/* ============================================================
   BITBI — Scroll Reveal (IntersectionObserver)
   ============================================================ */

export function initScrollReveal() {
    /* If user prefers reduced motion, show all elements immediately */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
        return null;
    }

    const observer = new IntersectionObserver(
        (entries) => entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        }),
        { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    return observer;
}
