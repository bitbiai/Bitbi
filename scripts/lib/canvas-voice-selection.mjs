import assert from 'node:assert/strict';
// Closed Voice/application boundary. Shared Canvas mutations retain all Canvas
// route/native coverage; unrelated account, media processing and dependency
// changes fall back to the ordinary selector. This does not reuse old reports.
export const CANVAS_VOICE_FILES = new Set([
  'js/pages/canvas/voice.js', 'js/pages/canvas/voice-audio.js', 'js/pages/canvas/voice-settings.js',
  'js/pages/canvas/agent-conversation-actions.js', 'tests/helpers/canvas-voice-browser.cjs',
  'js/shared/canvas-voice-settings.mjs', 'js/shared/canvas-conversation-decision-intent.mjs',
  'workers/auth/src/lib/canvas-voice-accounting.js', 'workers/auth/src/lib/canvas-voice-owner.js',
  'workers/auth/src/lib/canvas-voice-relay.js', 'workers/auth/src/lib/canvas-voice-tools.js',
  'workers/auth/src/lib/canvas-voice-conversation.js', 'workers/auth/src/lib/canvas-voice-settings.js',
  'workers/auth/src/lib/canvas-voice-diagnostics.js', 'workers/auth/src/lib/canvas-voice-presentation.js',
  'workers/auth/src/lib/canvas-voice-project-continuity.js', 'workers/auth/src/lib/canvas-voice-decisions.js',
  'workers/auth/src/lib/canvas-voice-actions.js', 'workers/shared/canvas-agent/voice.mjs',
  'workers/auth/src/lib/canvas-agent-actions.js', 'workers/auth/src/lib/canvas-agent-conversation-decisions.js',
  'workers/auth/src/lib/canvas-agent-conversation.js',
  'workers/auth/src/routes/canvas.js', 'workers/auth/src/routes/canvas-agent-conversation.js',
  'tests/canvas-voice-audio.test.mjs', 'tests/canvas-voice-relay.test.mjs', 'tests/canvas-voice-settings.test.mjs',
  'tests/canvas-voice-diagnostics.test.mjs', 'tests/canvas-voice-presentation.test.mjs',
  'tests/helpers/canvas-voice-continuity-control.mjs', 'tests/helpers/canvas-voice-accounting-control.mjs',
  'tests/helpers/canvas-voice-conversation-control.mjs', 'tests/q2-canvas-voice-accounting.spec.js',
  'tests/helpers/canvas-voice-actions-control.mjs', 'tests/helpers/canvas-voice-tools-control.mjs',
  'tests/helpers/canvas-voice-owner-control.mjs', 'tests/helpers/canvas-voice-settings-control.mjs',
  'tests/helpers/canvas-agent-media-completion-control.mjs', 'tests/helpers/canvas-agent-model-operation-control.mjs',
  'tests/helpers/canvas-voice-native-browser.cjs', 'tests/helpers/canvas-conversation-decisions-control.mjs',
  'tests/helpers/canvas-conversation-persisted-ui.cjs', 'tests/helpers/canvas-voice-text-control.mjs',
  'tests/helpers/canvas-voice-native-launcher.mjs', 'tests/helpers/canvas-voice-production-start.mjs',
  'tests/q2-canvas-voice-actions.spec.js', 'tests/q2-canvas-voice-film.spec.js',
  'tests/q2-canvas-voice-contract.spec.js', 'tests/q2-canvas-conversation-decisions.spec.js',
  'tests/helpers/q2-runtime/canvas-voice.mjs', 'tests/helpers/q2-runtime/control.mjs',
  'tests/helpers/q2-runtime/environment.mjs', 'tests/helpers/q2-runtime/linux-hosted.mjs',
  'tests/helpers/q2-runtime/voice-owner.mjs', 'tests/helpers/q2-runtime/voice-owner-lifecycle.mjs',
  'tests/helpers/q2-runtime/voice-browser-bridge.mjs',
  'tests/helpers/q2-runtime/voice-browser-child.mjs', 'tests/helpers/q2-runtime/voice-journey-provider.mjs',
  'tests/helpers/q2-runtime/voice-lifecycle-provider.mjs',
  'tests/helpers/q2-runtime/voice-provider.mjs',
  'tests/helpers/q2-runtime/voice-readiness-worker.mjs',
  'scripts/test-canvas-voice-browser-native.mjs', 'tests/canvas-voice-browser-bridge.test.mjs',
  'scripts/test-q2-runtime-launcher.mjs', 'scripts/lib/canvas-voice-selection.mjs', 'scripts/test-canvas-voice-selection.mjs',
]);
export const isCanvasVoiceScope = (files, isDocumentation, tooling) => files.some(file =>
  file.startsWith('workers/auth/src/lib/canvas-voice-') || file.startsWith('js/pages/canvas/voice'))
  && files.every(file => isDocumentation(file) || CANVAS_VOICE_FILES.has(file) || tooling.has(file));

export function verifyCanvasVoiceDiscovery(rows, standard) {
  assert(Array.isArray(standard) && standard.length > rows.length, 'Missing independent complete Canvas discovery');
  const match = row => ['chromium','webkit-canvas'].includes(row.project) && row.file === 'canvas.spec.js'
    && /Canvas Voice|Canvas conversation|Canvas autonomy|Canvas editable film|Canvas agent|Canvas AI workspace/.test(row.title);
  const key = row => `${row.project}:${row.file}:${row.title}`;
  assert.deepEqual(rows.map(key).sort(), standard.filter(match).map(key).sort(), 'Voice discovery lost or added affected Canvas cases');
  assert.equal(new Set(rows.map(key)).size, rows.length, 'Duplicate Voice discovery');
  for (const engine of ['chromium','webkit-canvas']) {
    assert(rows.some(row => row.project === engine && row.title.startsWith('Canvas Voice')), 'Missing Voice browser coverage');
    for (const locale of ['en','de']) for (const title of [
      `Canvas conversation ${locale}: natural immediate approval and pending bee`,
      `Canvas conversation ${locale}: assistant selection and natural budget approval`,
      `Canvas editable film ${locale}: rerun remove reorder sound export reopen`,
      `Canvas AI workspace ${locale}: layout`,
    ]) assert.equal(rows.filter(row => row.project === engine && row.title === title).length, 1, 'Missing retained text/button/manual-edit coverage');
  }
  for (const row of rows) assert.equal(row.expectedStatus, 'passed', 'Required Voice case must execute');
}

export function verifyCanvasVoiceNativeBrowserReport(report, sourceSha) {
  assert.equal(report?.schema, 1, 'Missing native Voice browser evidence');
  assert.equal(report.sourceSha, sourceSha, 'Native Voice evidence belongs to another candidate');
  assert.equal(report.records?.length, 2, 'Both native Voice browser journeys must execute');
  for (const [name, rate] of [['canvas_voice_browser_chromium_en',48000],['canvas_voice_browser_webkit_de',44100]]) {
    const rows = report.records.filter(row => row.name === name); assert.equal(rows.length,1,'Missing/duplicate native Voice journey');
    const row=rows[0]; assert.equal(row.status,'PASS'); assert.equal(row.connections,1); assert.equal(row.microphoneCalls,1);
    assert.equal(row.runCount,1); assert.equal(row.replayRunCount,1); assert.match(row.productionRun,/^[a-f0-9]{32}$/);
    assert.equal(row.captureSampleRate,rate); assert(row.turns>=8 && row.captureDurationMs>25000 && row.appends>200);
    for(const key of ['workletLoaded','sessionCompleted','productionSurvivesVoiceStop','syntheticMicrophone','syntheticProvider','bargeInVerified'])assert.equal(row[key],true,key);
    for(const key of ['retainedInterruptionMs','silenceFrames'])assert(Number.isSafeInteger(row[key]) && row[key]>0, 'Missing native Voice '+key);
    assert.equal(row.savedBrief?.duration?.targetDurationSeconds,12);
    for(const key of ['story','style','audio'])assert(row.savedBrief.fields[key]?.value,'Missing saved creative field');
  }
}
