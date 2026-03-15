/* ============================================================
   BITBI — Shared tag badge renderer
   ============================================================ */

const DEFAULT_COLOR = '0,240,255';

export function makeTags(tags, colorMap = {}) {
    return tags.map(t => {
        const c = colorMap[t] || DEFAULT_COLOR;
        return `<span style="font-size:10px;font-family:'JetBrains Mono',monospace;background:rgba(${c},0.08);color:rgba(${c},0.8);padding:2px 8px;border-radius:20px">${t}</span>`;
    }).join('');
}
