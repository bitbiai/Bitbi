exports.workspace = async ({ page, expect, locale, info, mockSharedAuth, createCanvasApiMock }) => {
  const de = locale === 'de', id = n => String(n).repeat(32), now = new Date().toISOString();
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockSharedAuth(page);
  const state = createCanvasApiMock(page), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  state.projects = [
    { id: id(1), title: 'A small adventure', locale, created_at: now, updated_at: now },
    { id: id(9), title: 'City portraits', locale, created_at: now, updated_at: now },
  ];
  state.nodes = [
    { id: id(2), project_id: id(1), type: 'image_generation', title: 'Character reference', model_id: '@cf/black-forest-labs/flux-1-schnell', x: 100, y: 80, config: { prompt: 'A small dog in a city park' }, content: {}, created_at: now, updated_at: now },
    { id: id(3), project_id: id(1), type: 'video_generation', title: 'Opening scene', model_id: 'pixverse/v6', x: 430, y: 200, config: { prompt: 'A playful opening shot' }, content: {}, created_at: now, updated_at: now },
    { id: id(4), project_id: id(1), type: 'note', title: 'Creative direction', x: 800, y: 450, config: {}, content: { text: 'Warm light, playful pace. Keep the character consistent.' }, created_at: now, updated_at: now },
  ];
  state.runs = [{ id: id(5), node_id: id(2), project_id: id(1), status: 'running', created_at: now }];
  state.edges = [{ id: id(6), project_id: id(1), source_node_id: id(2), target_node_id: id(3), config: {} }];
  await page.route(`**/api/account/canvas/projects/${id(9)}`, route => route.fulfill({ json: { ok: true, data: { project: state.projects[1], nodes: [], edges: [], runs: [] } } }));
  await page.goto(de ? '/de/canvas/' : '/canvas/');
  const search = page.getByRole('searchbox', { name: de ? 'Projekte suchen' : 'Search projects' });
  const items = page.locator('.canvas-project-item:visible');
  const card = page.locator(`[data-node-id="${id(2)}"]`);
  const menuButton = card.getByRole('button', { name: /^(Node actions|Node-Aktionen):/ });
  const menu = page.getByRole('menu', { name: de ? 'Node-Aktionen' : 'Node actions', exact: true });
  const writes = () => state.requests.filter(request => request.method !== 'GET' && !request.pathname.endsWith('/notifications/read'));
  await expect(items).toHaveCount(2);
  await expect(card.locator('.canvas-node__status')).toHaveText(de ? 'Wird erstellt' : 'Generating');
  state.runs[0].status = 'failed'; state.runs[0].error_code = 'canvas_image_save_pending';
  await page.reload();
  await expect(card.locator('.canvas-node__status')).toHaveText(de ? 'Speicherung ausstehend' : 'Awaiting save');
  state.runs[0].error_code = 'generation_rejected'; await page.reload();
  await expect(card.locator('.canvas-node__status')).toHaveText(de ? 'Fehlgeschlagen' : 'Failed');
  state.runs[0].status = 'running'; delete state.runs[0].error_code; await page.reload();
  await expect(card.locator('.canvas-node__meta')).not.toContainText('100, 80');
  const before = state.nodes.map(node => ({ id: node.id, x: node.x, y: node.y }));
  await search.fill('CITY'); await expect(items).toHaveCount(1);
  await expect(items).toContainText('City portraits');
  await search.fill('no-match'); await expect(items).toHaveCount(0);
  await expect(page.locator('#canvasProjectList')).toContainText(de ? 'Keine passenden Projekte.' : 'No matching projects.');
  await search.fill(''); await expect(items).toHaveCount(2);
  await expect(page.locator('.canvas-project-item__open[aria-current="true"]')).toContainText('A small adventure');
  expect(writes()).toEqual([]);

  const controls = page.locator('.canvas-view-controls'), size = controls.locator('.canvas-workspace-size');
  await expect(size).not.toHaveAttribute('open');
  await size.locator('summary').click();
  await expect(controls.getByRole('spinbutton', { name: de ? 'Breite' : 'Width', exact: true })).toBeVisible();
  await size.locator('summary').press('Escape'); await expect(size).not.toHaveAttribute('open');
  expect(writes()).toEqual([]);

  // A focused menu command changes selection/view only, not generation.
  await menuButton.click(); await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: de ? 'Node in die Mitte holen' : 'Center this node', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();
  await card.press('Shift+F10'); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menuButton).toBeFocused();
  expect(state.nodes.map(node => ({ id: node.id, x: node.x, y: node.y }))).toEqual(before);
  expect(writes()).toEqual([]);

  await controls.getByRole('button', { name: de ? 'Verkleinern' : 'Zoom out', exact: true }).click();
  await card.click({ button: 'right' }); await expect(menu).toBeVisible();
  expect(await menu.evaluate(element => { const r = element.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight; })).toBe(true);
  await menu.getByRole('menuitem', { name: de ? 'Im Inspector bearbeiten' : 'Edit in Inspector', exact: true }).click();
  await expect(page.locator('#canvasInspectorTitle')).toHaveText('Character reference');
  await expect(page.locator('#canvasInspectorTitle')).toBeFocused();
  expect(writes()).toEqual([]);

  // Placement follows the currently visible graph after zoom/pan.
  await page.locator('#canvasViewport').evaluate(element => element.scrollTo(850, 650));
  const expected = await page.locator('#canvasViewport').evaluate(viewport => {
    const zoom = new DOMMatrix(getComputedStyle(document.getElementById('canvasSurface')).transform).a;
    return { x: (viewport.scrollLeft + viewport.clientWidth / 2) / zoom - 115, y: (viewport.scrollTop + viewport.clientHeight / 2) / zoom - 63 };
  });
  await page.locator('#canvasNodeType').selectOption('note'); await page.locator('#canvasAddNode').click();
  await expect.poll(() => state.nodes.length).toBe(4);
  const added = state.nodes.at(-1);
  expect(added.x).toBeCloseTo(expected.x, 1); expect(added.y).toBeCloseTo(expected.y, 1);
  const addedCard = page.locator(`[data-node-id="${added.id}"]`);
  await expect(addedCard).toBeInViewport();
  // Cancelling keeps data; repeated menu opening must not multiply listeners.
  for (let i = 0; i < 3; i++) { await addedCard.locator('.canvas-node__menu').click(); await page.keyboard.press('Escape'); }
  page.once('dialog', dialog => dialog.dismiss());
  await addedCard.locator('.canvas-node__menu').click(); await menu.getByRole('menuitem', { name: de ? 'Node löschen…' : 'Delete node…', exact: true }).click();
  await expect(addedCard).toHaveCount(1); expect(writes().filter(request => request.method === 'DELETE')).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await addedCard.locator('.canvas-node__menu').click(); await menu.getByRole('menuitem', { name: de ? 'Node löschen…' : 'Delete node…', exact: true }).click();
  await expect(addedCard).toHaveCount(0); expect(writes().filter(request => request.method === 'DELETE')).toHaveLength(1);
  expect(writes().filter(request => request.pathname.endsWith('/run'))).toEqual([]);
  await controls.getByRole('button', { name: de ? 'Gesamten Graph einpassen' : 'Fit the whole graph', exact: true }).click();
  const direction = page.locator(`[data-node-id="${id(4)}"]`);
  await direction.locator('.canvas-node__menu').click();
  await menu.getByRole('menuitem', { name: de ? 'Von hier verbinden' : 'Connect from here', exact: true }).click();
  await expect(direction).toHaveClass(/is-source/);
  await page.locator(`[data-node-id="${id(3)}"] [data-port="in"]`).click();
  await expect.poll(() => state.edges.length).toBe(2);
  expect(state.edges.at(-1)).toMatchObject({ source_node_id: id(4), target_node_id: id(3) });
  expect(writes().filter(request => request.method === 'POST' && request.pathname.endsWith('/edges'))).toHaveLength(1);
  expect(writes().filter(request => request.pathname.endsWith('/run'))).toEqual([]);
  await page.screenshot({ path: info.outputPath(`canvas-workspace-${locale}-desktop.png`) });

  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#canvasProjectsToggle').click();
  await search.fill('city'); await expect(items).toHaveCount(1); await items.locator('.canvas-project-item__open').click();
  await expect(page.locator('#canvasProjectTitle')).toHaveValue('City portraits');
  await search.fill(''); await page.locator('.canvas-project-item__open').filter({ hasText: 'A small adventure' }).click();
  await page.locator('#canvasGraphToggle').click();
  await controls.getByRole('button', { name: de ? 'Gesamten Graph einpassen' : 'Fit the whole graph', exact: true }).click();
  await menuButton.click(); await expect(menu).toBeVisible(); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`canvas-workspace-${locale}-compact.png`) });
  expect(errors).toEqual([]);
};
