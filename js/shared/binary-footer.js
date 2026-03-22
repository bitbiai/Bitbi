/* ============================================================
   BITBI — Binary Footer Text Generator
   ============================================================ */

export function initBinaryFooter(elementId, charCount = 800) {
    const el = document.getElementById(elementId);
    if (!el) return;
    let s = '';
    for (let i = 0; i < charCount; i++) s += Math.round(Math.random());
    el.textContent = s;
}
