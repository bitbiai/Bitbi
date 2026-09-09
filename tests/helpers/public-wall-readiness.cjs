// The current visible layout is the contract, not an old ready attribute on a
// hidden grid. Shared by the real browser wait and deterministic countercases.
function wallIssue(s) {
  if (s.active !== s.category || s.hidden || s.transitioning) return 'inactive-or-transitioning';
  if (!s.token || s.ready !== 'true') return 'generation-not-ready';
  if (![s.width, s.available, s.measured, s.resolved, s.columns, s.overflow, ...s.columnWidths, ...s.cardWidths].every(Number.isFinite)) return 'missing-layout-measurement';
  if (!(s.width > 0) || !(s.available > 0) || Math.abs(s.measured - s.available) > 0.5) return 'stale-or-missing-width';
  if (!s.cards || s.cards !== s.expectedCards || !s.identities) return 'missing-or-changed-cards';
  if (s.columns < 1 || s.columnWidths.length !== s.columns) return 'missing-columns';
  if (!(s.resolved > 0) || [...s.columnWidths, ...s.cardWidths].some(w => Math.abs(w - s.resolved) > 2)) return 'unresolved-card-geometry';
  if (s.cardWidths.length !== s.cards || s.overflow > 4) return 'incomplete-or-overflowing-layout';
  return null;
}

function createWallWindow() {
  let previous = '', count = 0;
  return s => {
    const key = JSON.stringify([s.category, s.viewport, s.token, s.available, s.resolved, s.cards]);
    if (wallIssue(s)) { previous = ''; count = 0; return false; }
    count = key === previous ? count + 1 : 1; previous = key;
    return count >= 3;
  };
}
module.exports = { wallIssue, createWallWindow };
