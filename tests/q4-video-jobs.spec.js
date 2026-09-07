const { test, expect } = require('@playwright/test');
const { videoFixture, deferred, completed, controlledClock, interceptDatabase } = require('./helpers/q4-video-jobs.js');

test('Q4 B01 actual queue handler never adopts the replacement processing token', async () => {
  const firstClaim = deferred(); const releaseFirst = deferred();
  const secondClaim = deferred(); const releaseSecond = deferred();
  const f = await videoFixture(async () => completed());
  let acquisitions = 0; const tokens = [];
  const prepare = interceptDatabase(f.db, async ({ sql, bindings, method, execute }) => {
    const result = await execute();
    if (method === 'run' && sql.includes("SET status = 'starting', attempt_count") && result.meta.changes) {
      tokens.push(bindings[0]); acquisitions += 1;
      if (acquisitions === 1) { firstClaim.resolve(); await releaseFirst.promise; }
      else if (acquisitions === 2) { secondClaim.resolve(); await releaseSecond.promise; }
    }
    return result;
  });
  let first; let second;
  try {
    first = f.deliver(); await firstClaim.promise;
    await prepare("UPDATE ai_video_jobs_v2 SET locked_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.job.id).run();
    second = f.deliver(); await secondClaim.promise;
    releaseFirst.resolve(); await first;
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(f.calls.create, 'First handler cannot create under the paused second claim').toBe(0);
    releaseSecond.resolve(); await second;
    expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 1, ack: 2, retry: [] });
    expect(await f.row()).toMatchObject({ status: 'succeeded', processing_token: tokens[1] });
    expect((await f.usage()).count).toBe(1);
  } finally { releaseFirst.resolve(); releaseSecond.resolve(); await Promise.allSettled([first, second].filter(Boolean)); f.db.close(); }
});

test('Q4 B02 121-second create keeps its live lease and finishes through actual queue', async () => {
  const started = deferred(); const finish = deferred(); const clock = controlledClock();
  const f = await videoFixture(async () => { started.resolve(); await finish.promise; return completed(); });
  let running;
  try {
    running = f.deliver(); await started.promise;
    const token = (await f.row()).processing_token;
    await clock.advance(121000);
    finish.resolve(); await running;
    expect(await f.row()).toMatchObject({ status: 'succeeded', provider_outcome: 'succeeded', processing_token: token });
    expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 1, ack: 1, retry: [] });
    expect((await f.usage()).count).toBe(1);
    expect(f.env.USER_IMAGES.objects.size).toBe(1);
    expect(clock.pending()).toBe(0);
  } finally { finish.resolve(); if (running) await running; clock.restore(); f.db.close(); }
});

test('Q4 B02 expired claim retains a complete dispatch-bound receipt without reviving unknown', async () => {
  const started = deferred(); const finish = deferred(); const clock = controlledClock();
  const f = await videoFixture(async () => { started.resolve(); await finish.promise; return completed(); });
  let running;
  try {
    running = f.deliver(); await started.promise;
    const dispatch = (await f.row()).dispatch_token;
    await clock.advance(121000, { runTimers: false });
    await f.deliver(); finish.resolve(); await running;
    const row = await f.row();
    expect(row).toMatchObject({ provider_outcome: 'unknown', late_outcome: 'succeeded', dispatch_token: dispatch });
    expect(JSON.parse(row.provider_result_json)).toMatchObject({ status: 'succeeded', providerTaskId: 'q4-task', videoUrl: 'https://fixture.invalid/q4-video.mp4' });
    expect(row.late_evidence_json).not.toContain('fixture.invalid');
    await f.deliver();
    expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 0, ack: 3, retry: [] });
    expect((await f.usage()).count).toBe(0);
    expect(f.env.USER_IMAGES.objects.size).toBe(0);
  } finally { finish.resolve(); if (running) await running; clock.restore(); f.db.close(); }
});

for (const phase of ['before-usage', 'after-usage']) {
  test(`Q4 B02 ${phase} failure resumes settlement without another create, poll or download`, async () => {
    const f = await videoFixture(async () => completed());
    let fail = true;
    interceptDatabase(f.db, async ({ sql, method, execute }) => {
      if (method === 'run' && sql.includes('INSERT OR IGNORE INTO platform_budget_usage_events') && fail) {
        fail = false;
        if (phase === 'after-usage') await execute();
        throw new Error('Synthetic usage persistence/response failure');
      }
      return execute();
    });
    try {
      await f.deliver();
      expect(await f.row()).toMatchObject({ status: 'succeeded', provider_outcome: 'succeeded' });
      expect(f.calls.retry).toHaveLength(1);
      expect(f.calls.ack).toBe(0);
      expect((await f.usage()).count).toBe(phase === 'after-usage' ? 1 : 0);
      await f.deliver();
      expect((await f.usage()).count).toBe(1);
      await f.deliver();
      expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 1, ack: 2 });
      expect((await f.usage()).count).toBe(1);
      const event = await f.db.prepare('SELECT * FROM platform_budget_usage_events WHERE source_job_id=?').bind(f.job.id).first();
      const row = await f.row();
      expect(event).toMatchObject({ source_job_id: row.id, actor_user_id: row.user_id,
        units: row.platform_exposure_units, window_day: row.platform_window_day, window_month: row.platform_window_month });
    } finally { f.db.close(); }
  });
}

test('Q4 B02 lost receipt-write response resumes known completion after the prior lease ends', async () => {
  const clock = controlledClock(); const f = await videoFixture(async () => completed());
  let fail = true;
  interceptDatabase(f.db, async ({ sql, method, execute }) => {
    const result = await execute();
    if (fail && method === 'run' && sql.includes("AND provider_result_json = '{}'")) {
      fail = false; throw new Error('Synthetic persisted receipt response lost');
    }
    return result;
  });
  try {
    await f.deliver();
    expect(JSON.parse((await f.row()).provider_result_json).status).toBe('succeeded');
    await f.deliver();
    expect(f.calls.retry).toHaveLength(2);
    expect(f.calls.ack, 'Known uncompleted receipt must not be silently acknowledged while locked').toBe(0);
    await clock.advance(121000); await f.deliver();
    expect(await f.row()).toMatchObject({ status: 'succeeded', provider_outcome: 'succeeded' });
    expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 1, ack: 1 });
    expect((await f.usage()).count).toBe(1);
  } finally { clock.restore(); f.db.close(); }
});

for (const action of ['cancel', 'replace-token', 'renewal-error']) {
  test(`Q4 B02 ${action} fences a held provider result and preserves its private receipt`, async () => {
    const clock = controlledClock(); const started = deferred(); const finish = deferred();
    const f = await videoFixture(async () => { started.resolve(); await finish.promise; return completed(); });
    let running;
    try {
      running = f.deliver(); await started.promise;
      if (action === 'cancel') await f.db.prepare("UPDATE ai_video_jobs_v2 SET status='cancelled' WHERE id=?").bind(f.job.id).run();
      else if (action === 'replace-token') await f.db.prepare("UPDATE ai_video_jobs_v2 SET processing_token='foreign-q4-token' WHERE id=?").bind(f.job.id).run();
      else interceptDatabase(f.db, ({ sql, execute }) => {
        if (sql.includes('SET locked_until = ? WHERE')) throw new Error('Synthetic lease renewal unavailable');
        return execute();
      });
      await clock.advance(40000); finish.resolve(); await running;
      const row = await f.row();
      expect(row.status).not.toBe('succeeded');
      if (action === 'cancel') expect(row.status).toBe('cancelled');
      if (action === 'replace-token') expect(row.processing_token).toBe('foreign-q4-token');
      if (action === 'renewal-error') expect(row.provider_outcome).toBe('unknown');
      expect(JSON.parse(row.provider_result_json)).toMatchObject({ status: 'succeeded', providerTaskId: 'q4-task' });
      expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 0, ack: action === 'replace-token' ? 0 : 1 });
      expect(f.calls.retry).toHaveLength(action === 'replace-token' ? 1 : 0);
      expect((await f.usage()).count).toBe(0);
      expect(clock.pending()).toBe(0);
      if (action === 'replace-token') {
        await clock.advance(121000); await f.deliver();
        expect((await f.row()).status).toBe('succeeded');
        expect(f.calls.create).toBe(1); expect((await f.usage()).count).toBe(1);
      }
    } finally { finish.resolve(); if (running) await running; clock.restore(); f.db.close(); }
  });
}

test('Q4 B02 pending create polls the same provider task exactly once before settlement', async () => {
  const clock = controlledClock();
  const f = await videoFixture(async request => {
    const body = await request.json();
    if (new URL(request.url).pathname.endsWith('/create')) return Response.json({ ok: true,
      result: { status: 'provider_pending', providerTaskId: 'q4-task', retryAfterSeconds: 20 } });
    expect(body.taskId || body.providerTaskId).toBe('q4-task');
    return completed();
  });
  try {
    await f.deliver(); expect(f.calls).toMatchObject({ create: 1, poll: 0, download: 0, ack: 1 });
    expect((await f.row()).provider_task_id).toBe('q4-task');
    await clock.advance(21000); await f.deliver(f.env.AI_VIDEO_JOBS_QUEUE.messages.shift());
    expect(await f.row()).toMatchObject({ status: 'succeeded', provider_task_id: 'q4-task' });
    expect(f.calls).toMatchObject({ create: 1, poll: 1, download: 1, ack: 2, retry: [] });
    expect((await f.usage()).count).toBe(1);
  } finally { clock.restore(); f.db.close(); }
});

for (const duration of [599000, 600000]) {
  test(`Q4 B02 ${duration / 1000}-second provider boundary respects the existing finite timeout`, async () => {
    const clock = controlledClock(); const started = deferred(); const finish = deferred();
    const f = await videoFixture(async () => { started.resolve(); await finish.promise; return completed(); });
    let running;
    try {
      running = f.deliver(); await started.promise;
      await clock.advance(duration);
      if (duration === 599000) finish.resolve();
      await running;
      if (duration === 599000) {
        expect(await f.row()).toMatchObject({ status: 'succeeded', provider_outcome: 'succeeded' });
        expect((await f.usage()).count).toBe(1); expect(f.calls.download).toBe(1);
      } else {
        expect((await f.row()).provider_outcome).toBe('unknown');
        finish.resolve(); await Promise.resolve(); await f.deliver();
        expect((await f.row()).provider_outcome).toBe('unknown');
        expect((await f.usage()).count).toBe(0); expect(f.calls.download).toBe(0);
      }
      expect(f.calls.create).toBe(1); expect(f.calls.poll).toBe(0); expect(clock.pending()).toBe(0);
    } finally { finish.resolve(); if (running) await running; clock.restore(); f.db.close(); }
  });
}

for (const stage of ['checkpoint', 'finalize']) {
  test(`Q4 B02 expired ${stage} CAS retains a delivery and reuses the durable receipt`, async () => {
    const clock = controlledClock(); const f = await videoFixture(async () => completed());
    let expired = false;
    const prepare = interceptDatabase(f.db, async ({ sql, method, execute }) => {
      if (!expired && method === 'run' && sql.startsWith(stage === 'checkpoint'
        ? "UPDATE ai_video_jobs_v2 SET provider_outcome = 'succeeded'" : "UPDATE ai_video_jobs_v2 SET status = 'succeeded'")) {
        expired = true;
        await prepare("UPDATE ai_video_jobs_v2 SET locked_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.job.id).run();
      }
      return execute();
    });
    try {
      await f.deliver();
      expect((await f.row()).status).not.toBe('succeeded');
      expect((await f.usage()).count).toBe(0);
      expect(f.calls.retry).toHaveLength(1);
      expect(f.calls.ack).toBe(0);
      expect(JSON.parse((await f.row()).provider_result_json).status).toBe('succeeded');
      await f.deliver();
      expect((await f.row()).status).toBe('succeeded');
      expect((await f.usage()).count).toBe(1);
      expect(f.calls.create).toBe(1); expect(f.calls.poll).toBe(0);
      expect(f.calls.download).toBe(stage === 'checkpoint' ? 1 : 2);
      expect(f.env.USER_IMAGES.objects.size).toBe(stage === 'checkpoint' ? 1 : 2);
      // A finished old R2 put may remain private; it cannot replace the new
      // claim's published key. No D1/R2 transaction or orphan elimination claim.
      const row = await f.row(); expect(row.output_r2_key).toContain(row.processing_token);
    } finally { clock.restore(); f.db.close(); }
  });
}
