const fs = require('node:fs');
const path = require('node:path');
const { SqliteD1Database, applyAuthMigrations } = require('./sqlite-d1.js');
const { createAuthTestEnv } = require('./auth-worker-harness.js');

exports.completionUi = async ({ page, expect, locale, mockSharedAuth, createCanvasApiMock, info }) => {
  const { canvasCompletionFixture } = await import('./canvas-completion-control.mjs');
  const DB = new SqliteD1Database(); applyAuthMigrations(DB);
  const media = name => fs.readFileSync(path.join(__dirname, '../fixtures/media', name)).toString('base64');
  const f = await canvasCompletionFixture({ ...createAuthTestEnv(), DB }, {
    videoBase64: media('canvas-end-frame.mp4'), imageBase64: media('h3-frame.png'), musicBase64: media('member-music.mp3'),
  });
  const de = locale === 'de', errors = [], admissions = []; let stripped = 0, delivered = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: de ? 390 : 1440, height: 900 });
  await mockSharedAuth(page); createCanvasApiMock(page);
  await f.prepare(7);
  await page.route(/\/api\/(account\/canvas\/|ai\/(generation-jobs\/|text-assets\/|images\/))/, async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname.startsWith('/api/ai/generation-jobs/') && method === 'GET' && f.calls.length === delivered) {
      await f.deliver({ attachmentGap: delivered === 0 }); delivered++;
    }
    const response = await f.request(url.pathname + url.search, method, request.postData(), {
      ...(request.headers()['idempotency-key'] ? { 'Idempotency-Key': request.headers()['idempotency-key'] } : {}),
    });
    const headers = Object.fromEntries(response.headers), status = response.status;
    if (url.pathname.endsWith('/run') && response.ok && status !== 202) {
      const body = await response.json();
      expect(body.data.run.output.sourceVersion).toMatch(/^[a-f0-9]{64}$/);
      if (body.data.run.node_id === f.nodes[7] && !stripped) {
        // Exact observed browser state, with canonical storage deliberately intact.
        delete body.data.run.output.sourceVersion; stripped++;
      }
      return route.fulfill({ status, headers, body: JSON.stringify(body) });
    }
    if (url.pathname.endsWith('/full-video') && method === 'POST') {
      const body = await response.json(); expect(response.ok, JSON.stringify(body)).toBe(true);
      admissions.push(body.data.export.recipe);
      return route.fulfill({ status, headers, body: JSON.stringify(body) });
    }
    await route.fulfill({ status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  const openInspector = async id => {
    if (de && await page.locator('#canvasInspectorToggle').getAttribute('aria-expanded') === 'true') await page.locator('#canvasInspectorToggle').click();
    await page.locator(`[data-node-id="${id}"]`).press('Enter');
    if (de && !(await page.locator('#canvasInspectorBody').isVisible())) await page.locator('#canvasInspectorToggle').click();
  };
  try {
    await page.goto(de ? '/de/canvas/' : '/canvas/');
    for (const index of [7, 8]) {
      await openInspector(f.nodes[index]);
      const inspector = page.locator('#canvasInspectorBody');
      await expect(inspector.getByRole('textbox', {name: de ? 'Titel' : 'Title', exact:true})).toHaveValue(index === 7 ? 'Out' : 'Next');
      if (index === 8) {
        const method = inspector.getByRole('combobox', { name: de ? 'Video weiterverwenden' : 'Reuse video' });
        await method.selectOption('last_frame');
        await expect(inspector.getByRole('img', { name: de ? 'Letztes Frame als Startbild' : 'Last frame as start image' })).toBeVisible();
        await expect(method).toHaveValue('last_frame');
      }
      const run = inspector.getByRole('button', { name: de ? 'Ausführen' : 'Run', exact: true }); await expect(run).toBeEnabled();
      const observed = page.waitForResponse(response => response.url().includes('/api/ai/generation-jobs/'));
      await run.click(); await observed;
      await require('./canvas-inspector-actions.cjs').openCanvasSettings(page,'merge');
      const group = inspector.locator('.canvas-clip-sequence');
      await expect(group.getByRole('radio', { name: de ? 'Diese Kette zusammenfügen' : 'Merge this chain' })).toBeChecked();
      await expect(group.locator('li')).toHaveCount(index + 1);
      await expect(group.locator('li').nth(6)).toContainText('Final · Seedance');
      await expect(group.locator('li').last()).toContainText(index === 7 ? 'Out · MiniMax H3' : 'Next · MiniMax H3');
      await expect(inspector.getByRole('button', { name: de ? 'Gesamtes Video mit Hintergrundmusik erstellen' : 'Create full video with background music', exact: true })).toBeEnabled();
      expect(f.calls).toHaveLength(index - 6);
    }
    expect(stripped).toBe(1);
    const projectPath = `/api/account/canvas/projects/${f.project}`;
    const graph = (await (await f.request(projectPath)).json()).data;
    const output = graph.nodes.find(n => n.id === f.nodes[8]).output;
    const view = (await (await f.request(`${projectPath}/runs/${output.runId}/full-video`)).json()).data;
    const controls = await page.evaluate(async ({ graph, view, runId }) => {
      const { clipSequence } = await import('/js/pages/canvas/merge-clips.js');
      const { canvasMergeStrand } = await import('/js/shared/canvas-export.mjs');
      const state = { projectId: graph.project.id, nodes: graph.nodes, edges: graph.edges, models: [] };
      const endpoint = state.nodes.find(n => n.output?.runId === runId), canonical = endpoint.output.sourceVersion;
      const box = document.createElement('div'), abort = new AbortController();
      const sequence = clipSequence(box, runId, false, abort.signal, () => {}, () => state);
      delete endpoint.output.sourceVersion; sequence.update(view);
      const repaired = sequence.valid && endpoint.output.sourceVersion === canonical;
      endpoint.output.sourceVersion = 'f'.repeat(64); sequence.update(view);
      const replaced = { valid: sequence.valid, text: box.textContent, version: endpoint.output.sourceVersion };
      state.nodes = state.nodes.filter(n => n !== endpoint); sequence.update(view);
      const deleted = { valid: sequence.valid, text: box.textContent };
      abort.abort();
      return { repaired, replaced, deleted, missing: canvasMergeStrand([], [], undefined).error };
    }, { graph, view, runId: output.runId });
    expect(controls.repaired).toBe(true); expect(controls.replaced.valid).toBe(false);
    expect(controls.replaced.version).toBe('f'.repeat(64)); expect(controls.replaced.text).toContain('endpoint video output');
    expect(controls.deleted.valid).toBe(false); expect(controls.deleted.text).toContain('selected endpoint is missing');
    expect(controls.missing).toBe('canvas_chain_endpoint_missing');
    await page.reload(); await openInspector(f.nodes[8]);
    await expect(page.locator('.canvas-clip-sequence li')).toHaveCount(9);
    const create = page.getByRole('button', { name: de ? 'Gesamtes Video mit Hintergrundmusik erstellen' : 'Create full video with background music', exact: true });
    await create.focus(); await page.keyboard.press('Enter');
    await expect.poll(() => admissions.length).toBe(1);
    expect(admissions[0].videos.map(c => c.runId)).toEqual(view.chain.clips.map(c => c.runId));
    expect(admissions[0].backgroundMusic).toMatchObject({ enabled: true, gain: .5, musicAssetId: f.musicId });
    expect(f.calls).toHaveLength(2); expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`completion-${locale}.png`) });
  } finally { if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' }); DB.close(); }
};
