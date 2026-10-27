const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

for (const name of ['shared', 'isolation', 'replay', 'stale', 'format', 'readonly', 'concurrency', 'correction', 'text', 'tools']) test(`Canvas Voice canonical conversation ${name}`, async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const { canvasVoiceConversationCase } = await import('./helpers/canvas-voice-conversation-control.mjs');
    expect(await canvasVoiceConversationCase({ ...createAuthTestEnv(), DB }, name)).toEqual({ case: name, inferenceCalls: 0, productionActions: 0 });
  } finally { DB.close(); }
});

for (const name of ['persistence', 'replay', 'concurrency', 'ownership', 'validation', 'lifecycle']) test(`Canvas Voice server settings ${name}`, async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const { canvasVoiceSettingsCase } = await import('./helpers/canvas-voice-settings-control.mjs');
    expect(await canvasVoiceSettingsCase({ ...createAuthTestEnv(), DB }, name)).toEqual({ case: name, providerCalls: 0 });
  } finally { DB.close(); }
});

test('Canvas Voice authenticated routes preserve Origin, ownership and stopped admission', async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const { canvasVoiceRouteCase } = await import('./helpers/canvas-voice-route-control.mjs');
    expect(await canvasVoiceRouteCase({ ...createAuthTestEnv(), DB })).toEqual({ case: 'routes', providerCalls: 0 });
  } finally { DB.close(); }
});
