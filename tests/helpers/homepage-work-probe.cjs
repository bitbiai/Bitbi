const assert = require('node:assert/strict');

// Runs in the page. Keep the observer passive: no DOM/style/layout reads and
// no monkey patching of clocks, observers or product callbacks.
function installHomepageWorkProbe() {
  const entries = [];
  const state = { supported: false, overflow: false, error: '', entries };
  const record = list => {
    for (const entry of list) entries.push({ startTime: entry.startTime, duration: entry.duration });
    if (entries.length > 2000) state.overflow = true;
  };
  state.flush = () => {
    if (state.observer) record(state.observer.takeRecords());
    return { supported: state.supported, overflow: state.overflow, error: state.error, entries: entries.slice() };
  };
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      state.observer = new PerformanceObserver(list => record(list.getEntries()));
      state.observer.observe({ type: 'longtask', buffered: true });
      state.supported = true;
    }
  } catch (error) { state.error = String(error.message || error); }
  window.__homepageWorkProbe = state;
}

function summarizeTaskWindow(probe, startTime, endTime) {
  assert.ok(Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime, 'Invalid real-time work window');
  // Include an input/completion task that STARTED before the boundary. Entry
  // delivery time is irrelevant; a late observer notification is not a new task.
  const entries = probe.entries.filter(entry => entry.startTime < endTime && entry.startTime + entry.duration > startTime);
  return {
    supported: probe.supported, overflow: probe.overflow, error: probe.error,
    startTime, endTime, entries, count: entries.length,
    maxLongTaskMs: Math.max(0, ...entries.map(entry => entry.duration)),
    blockingMs: entries.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
  };
}

function assertHomepageWorkBudget(window) {
  assert.equal(window.supported, true, 'Native Long Tasks measurement unavailable; no performance pass');
  assert.equal(window.overflow, false, 'Work observer overflow; incomplete measurement');
  assert.equal(window.error, '', 'Work observer failed');
  assert.ok(window.maxLongTaskMs <= 50, `Homepage work exceeds 50 ms: ${window.maxLongTaskMs} ms`);
}

module.exports = { installHomepageWorkProbe, summarizeTaskWindow, assertHomepageWorkBudget };
