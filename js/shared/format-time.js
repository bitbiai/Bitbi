/* ============================================================
   BITBI — Shared time formatting utility
   Formats seconds as m:ss for audio players.
   ============================================================ */

export function formatTime(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}
