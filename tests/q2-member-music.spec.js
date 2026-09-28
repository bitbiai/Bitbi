const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

test('Canvas contributors real owner/project caller resolves frozen branches beyond history', async () => {
  const db=new SqliteD1Database(); applyAuthMigrations(db);
  try { const {canvasContributorsCase}=await import('./helpers/canvas-contributors-control.mjs');
    expect(await canvasContributorsCase({...createAuthTestEnv(),DB:db})).toEqual({nodes:47,edges:47,legacyIncomplete:true});
    expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally {db.close();}
});

for (const role of ['user', 'admin']) for (const name of ['prompt', 'plan-opus', 'plan-large', 'explicit-duration', 'selected-org', 'missing-usage', 'invalid-usage', 'overrun', 'failed', 'custom-revision', 'durable']) {
  test(`ElevenLabs member real caller ${role} ${name}`, async () => {
    const db = new SqliteD1Database(); applyAuthMigrations(db);
    try {
      const { elevenLabsMemberCase } = await import('./helpers/elevenlabs-member-control.mjs');
      const media = Object.fromEntries(['mp3', 'opus'].map(ext => [ext, fs.readFileSync(`tests/fixtures/media/member-music.${ext}`).toString('base64')]));
      const result = await elevenLabsMemberCase({ ...createAuthTestEnv(), DB: db }, name, role, media);
      expect(result.calls).toBe(1);
      await test.info().attach('music-caller-result', { body: JSON.stringify(result), contentType: 'application/json' });
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { db.close(); }
  });
}
