/* ============================================================
   BITBI — Binary Footer Text Generator
   ============================================================ */

export function initBinaryFooter(elementId, charCount = 800) {
    let s = '';
    for (let i = 0; i < charCount; i++) s += Math.round(Math.random());
    const el = document.getElementById(elementId);
    if (el) el.textContent = s;
}
