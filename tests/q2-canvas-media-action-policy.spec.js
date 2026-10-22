const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

for (const name of ['parallel', 'historical', 'unknown', 'text', 'resume-outer', 'resume-model']) test(`Canvas media action policy ${name} preserves original accounting`, async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const { canvasMediaActionPolicyCase } = await import('./helpers/canvas-agent-media-action-policy-control.mjs');
    expect(await canvasMediaActionPolicyCase({ ...createAuthTestEnv(), DB }, name)).toEqual({ case: name, paidProviderCalls: 0 });
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally { DB.close(); }
});
