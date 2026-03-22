/* ============================================================
   BITBI — Binary Rain Background Effect
   ============================================================ */

export function initBinaryRain(containerId, options = {}) {
    /* Skip if user prefers reduced motion */
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const maxCols = options.maxCols ?? 16;
    const colDivisor = options.colDivisor ?? 50;
    const charCount = options.charCount ?? 24;
    const minDuration = options.minDuration ?? 16;
    const durationRange = options.durationRange ?? 20;

    const el = document.getElementById(containerId);
    if (!el) return;

    const cols = Math.min(maxCols, Math.floor(window.innerWidth / colDivisor));
    for (let i = 0; i < cols; i++) {
        const d = document.createElement('div');
        let t = '';
        for (let j = 0; j < charCount; j++) t += Math.round(Math.random());
        Object.assign(d.style, {
            position: 'absolute',
            left: (i / cols * 100) + '%',
            top: '0',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '9px',
            color: 'rgba(0,240,255,0.05)',
            writingMode: 'vertical-rl',
            animation: `binaryFall ${minDuration + Math.random() * durationRange}s linear ${Math.random() * -15}s infinite`,
            willChange: 'transform'
        });
        d.textContent = t;
        d.setAttribute('aria-hidden', 'true');
        el.appendChild(d);
    }
}
