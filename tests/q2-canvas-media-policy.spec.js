const { test, expect } = require('@playwright/test');
const { SqliteD1Database, applyAuthMigrations } = require('./helpers/sqlite-d1.js');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness.js');

test('Canvas media policy limits have specific localized notification and conversation errors', async () => {
  const { canvasMediaPolicyError, canvasNotificationText } = await import('../js/shared/canvas-notification-contract.mjs');
  const codes=['canvas_agent_media_model_not_allowed','canvas_agent_media_limit_exceeded','canvas_agent_media_limit_below_committed','canvas_agent_media_policy_changed','canvas_agent_media_policy_resume_required','canvas_agent_project_budget_required'];
  for(const german of [false,true]){
    const texts=codes.map(code=>canvasMediaPolicyError(code,german));
    expect(new Set(texts).size).toBe(codes.length);
    for(const [index,code]of codes.entries()){
      expect(texts[index]).not.toContain(code);expect(texts[index].length).toBeGreaterThan(60);
      expect(canvasNotificationText({code:'canvas_client_notice',details:{errorCode:code}},german)).toBe(texts[index]);
      expect(canvasNotificationText({source:'event',code},german)).toBe(texts[index]);
    }
  }
  expect(canvasMediaPolicyError('canvas_agent_provider_unknown',true)).toBeNull();
  expect(canvasMediaPolicyError('canvas_agent_media_limit_exceeded',false)).toContain('not increased');
  expect(canvasMediaPolicyError('canvas_agent_project_budget_required',true)).toContain('Modelllimits allein');
  // Browser ES modules live below the CommonJS test package. This pure copy
  // module has no imports; load its unchanged bytes as an ES module.
  const copySource=require('node:fs').readFileSync(require('node:path').join(__dirname,'../js/pages/canvas/agent-media-policy-copy.js'));
  const {canvasMediaPolicyCopy}=await import('data:text/javascript;base64,'+copySource.toString('base64'));
  expect(canvasMediaPolicyCopy(true).committed).toBe('Insgesamt gebunden');expect(canvasMediaPolicyCopy(false).committed).toBe('Total committed');
  expect(canvasMediaPolicyCopy(true).totalHint).toContain('nicht addieren');expect(canvasMediaPolicyCopy(false).totalHint).toContain('do not add');
});

for (const name of ['api', 'parallel', 'dispatch', 'cumulative', 'context', 'resume', 'accepted-resume']) test(`Canvas media policy ${name} uses real authority and accounting`, async () => {
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  try {
    const { canvasMediaPolicyCase } = await import('./helpers/canvas-agent-media-policy-control.mjs');
    expect(await canvasMediaPolicyCase({ ...createAuthTestEnv(), DB }, name)).toEqual({ case: name, paidProviderCalls: 0 });
    expect((await DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  } finally { DB.close(); }
});
