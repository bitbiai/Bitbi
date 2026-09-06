const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Real browser modules and existing HTTP contracts, entirely synthetic APIs.
// Run inside the repository's loopback-only browser isolation. No Worker imports.
const users = ['A', 'B'].map(name => ({ id: `q3-user-${name}`, email: `${name.toLowerCase()}@example.test`, role: 'user', status: 'active', created_at: '2026-09-01T12:00:00Z' }));
const orgs = ['A', 'B'].map(name => ({ id: `q3-org-${name}`, name: `Organization ${name}`, status: 'active' }));
const ok = body => ({ status: 200, body: { ok: true, ...body } });
const renderSettled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function setup(page, baseURL, handler = () => null) {
  const unexpected = [];
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) { unexpected.push(url.pathname); return route.abort(); }
    if (process.env.OMA2_Q3_CONTEXT_BASELINE && /^\/js\/pages\/admin\/(?:users|user-storage|user-actions|fable-data-center|control-plane\/billing)\.js$/.test(url.pathname)) {
      const source = path.join(process.env.OMA2_Q3_CONTEXT_BASELINE, url.pathname);
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(source, 'utf8') });
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let result = await handler(request, url);
    const admin = { id: 'q3-admin', email: 'admin@example.test', role: 'admin' };
    if (!result && url.pathname === '/api/admin/me') result = ok({ user: admin });
    if (!result && url.pathname === '/api/me') result = ok({ loggedIn: true, user: admin });
    if (!result && url.pathname === '/api/admin/users') result = ok({ users, has_more: false });
    if (!result && url.pathname === '/api/admin/orgs') {
      const search = url.searchParams.get('search');
      result = ok({ organizations: orgs.filter(org => !search || org.name === search) });
    }
    if (!result) {
      if (!['GET', 'HEAD'].includes(request.method())) unexpected.push(`${request.method()} ${url.pathname}`);
      result = { status: 503, body: { ok: false, error: 'Unconfigured synthetic read' } };
    }
    if (result.abort) return route.abort('failed');
    return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
  });
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
  return unexpected;
}
async function open(page, section) {
  await page.goto('/admin/index.html#' + section);
  await expect(page.locator('#adminPanel')).toBeVisible();
}
async function userInfo(page, user) {
  const desktop = page.locator('#userTbody tr').filter({ hasText: user.email });
  // Layout comes from the viewport, not a pre-response visibility race.
  if (page.viewportSize().width >= 600) await desktop.getByRole('button', { name: 'Info', exact: true }).click();
  else {
    const card = page.locator('.admin-mobile-card').filter({ hasText: user.email });
    await card.locator('.admin-mobile-card__header').click();
    await card.getByRole('button', { name: 'Info', exact: true }).click();
  }
}
async function userDetail(page, user, action) {
  await userInfo(page, user);
  await page.locator(`#userInfoModal [data-info-action="${action}"]`).click();
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`Q3 context ${viewport.width}px`, () => {
    test.use({ viewport });
    for (const failure of [false, true]) {
      test(`U04 old user credit ${failure ? 'error' : 'success'} cannot replace B after close/reopen`, async ({ page, baseURL }) => {
        const held = deferred(); let aStarted = false;
        const unexpected = await setup(page, baseURL, async (request, url) => {
          const match = url.pathname.match(/\/admin\/users\/(q3-user-[AB])\/billing$/);
          if (!match) return null;
          if (match[1] === users[0].id) { aStarted = true; await held.promise; if (failure) return { status: 503, body: { ok: false, error: 'A-only failure' } }; }
          return ok({ billing: { userId: match[1], email: match[1] === users[0].id ? users[0].email : users[1].email, balance: { current: match[1] === users[0].id ? 111 : 222 }, transactions: [] } });
        });
        await open(page, 'users');
        await userDetail(page, users[0], 'credits');
        await expect.poll(() => aStarted).toBe(true);
        await page.locator('#userCreditModal').press('Escape');
        await userDetail(page, users[1], 'credits');
        await expect(page.locator('#userCreditModalBody')).toContainText('222 credits');
        const oldResponse = page.waitForResponse(response => response.url().includes('/q3-user-A/billing'));
        held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
        await expect(page.locator('#userCreditModalSubtitle')).toContainText(users[1].email);
        await expect(page.locator('#userCreditModalBody')).not.toContainText('111 credits');
        await expect(page.locator('#userCreditModalBody')).not.toContainText('A-only failure');
        await page.locator('#userCreditModal').press('Escape');
        expect(unexpected).toEqual([]);
      });
    }

    test('U04 storage pagination ignores an old owner, deduplicates rows and recovers its own page', async ({ page, baseURL }) => {
      const held = deferred(); let aStarted = false; let bPages = 0;
      const asset = (id, name) => ({ id, title: name, asset_type: 'image', visibility: 'private', size_bytes: 20 });
      const unexpected = await setup(page, baseURL, async (request, url) => {
        const match = url.pathname.match(/\/admin\/users\/(q3-user-[AB])\/storage$/);
        if (!match) return null;
        if (match[1] === users[0].id) { aStarted = true; await held.promise; return ok({ data: { user: users[0], assets: [asset('a', 'A private metadata')], folders: [] } }); }
        bPages += 1;
        const next = url.searchParams.get('cursor');
        return ok({ data: { user: users[1], folders: [], assets: next ? [asset('b1', 'B first'), asset('b2', 'B second page')] : [asset('b1', 'B first')], has_more: !next, next_cursor: next ? null : 'b-page-2' } });
      });
      await open(page, 'users');
      await userDetail(page, users[0], 'usage');
      await expect.poll(() => aStarted).toBe(true);
      await page.locator('#userStorageModal').press('Escape');
      await userDetail(page, users[1], 'usage');
      await expect(page.locator('#userStorageModalBody')).toContainText('B first');
      const oldResponse = page.waitForResponse(response => response.url().includes('/q3-user-A/storage'));
      held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
      await page.locator('#userStorageModalBody').getByRole('button', { name: 'Load more assets' }).dblclick();
      await expect(page.locator('#userStorageModalBody')).toContainText('B second page');
      await expect(page.locator('#userStorageModalBody .admin-usage-modal__asset-name').filter({ hasText: 'B first' })).toHaveCount(1);
      await expect(page.locator('#userStorageModalBody')).not.toContainText('A private metadata');
      expect(bPages).toBe(2); expect(unexpected).toEqual([]);
    });

    test('U03/U05 grant freezes original inputs, blocks duplicate submit and retries the same intent without replacing B billing', async ({ page, baseURL }) => {
      const lookup = deferred(); const grant = deferred(); let lookupStarted = false; const writes = []; let first = true;
      const unexpected = await setup(page, baseURL, async (request, url) => {
        if (url.pathname === '/api/admin/orgs' && url.searchParams.get('search') === orgs[0].name) {
          lookupStarted = true; await lookup.promise; return ok({ organizations: [orgs[0]] });
        }
        if (url.pathname.endsWith('/credits/grant')) {
          writes.push({ path: url.pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
          if (first) { first = false; await grant.promise; return { abort: true }; }
          return ok({ ledgerEntry: { balanceAfter: 5050 } });
        }
        if (url.pathname === `/api/admin/orgs/${orgs[1].id}/billing`) return ok({ billing: { creditBalance: 777, planCode: 'B-only' } });
        return null;
      });
      page.on('dialog', dialog => dialog.accept());
      await open(page, 'billing');
      await page.locator('#creditGrantOrgSearch').fill(orgs[0].name);
      await page.locator('#creditGrantAmount').fill('50');
      await page.locator('#creditGrantReason').fill('Original A adjustment');
      const submit = page.locator('#creditGrantForm button[type="submit"]');
      await submit.click(); await expect.poll(() => lookupStarted).toBe(true);
      await expect(submit).toBeDisabled();
      await page.locator('#creditGrantAmount').fill('999');
      await page.locator('#creditGrantReason').fill('Later unsent draft');
      lookup.resolve(); await expect.poll(() => writes.length).toBe(1);
      await page.locator('#orgBillingSearch').fill(orgs[1].name);
      await page.locator('#orgBillingLookupForm button[type="submit"]').click();
      await expect(page.locator('#orgBillingDetail')).toContainText('777');
      grant.resolve();
      const retry = page.locator('#creditGrantResult').getByRole('button', { name: 'Retry this exact grant' });
      await expect(retry).toBeVisible();
      await retry.dblclick();
      await expect(page.locator('#creditGrantResult')).toContainText('Balance after: 5050');
      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(writes[1]);
      expect(writes[0].body).toEqual({ amount: 50, reason: 'Original A adjustment' });
      expect(writes[0].path).toContain(orgs[0].id);
      await expect(page.locator('#orgBillingSearch')).toHaveValue(orgs[1].name);
      await expect(page.locator('#orgBillingDetail')).toContainText('777');
      await expect(page.locator('#orgBillingDetail')).not.toContainText('5050');
      expect(unexpected).toEqual([]);
    });
  });
}

const fableSettings = { effort: 'high', effectiveMaxOutputTokens: 16384, preset: 'general', presetVersion: 1, memoryMode: 'standard', webSearchEnabled: false, webFetchEnabled: false };
function conversation(id) { return { id, title: `Conversation ${id}`, ownerEmail: 'owner@example.test', ownerId: 'owner', modelId: 'anthropic/claude-fable-5', state: 'active', settings: fableSettings, counts: { messages: 0, turns: 0 }, adminRevisionVersion: id === 'A' ? 4 : 8 }; }
function detail(id) { return ok({ conversation: conversation(id), memory: { uncoveredEstimatedTokens: 0 }, storage: { transcriptBytes: 0, privateProviderBytes: 0 } }); }
async function setupFable(page, baseURL, handler) {
  return setup(page, baseURL, async (request, url) => {
    const custom = await handler(request, url); if (custom) return custom;
    if (!url.pathname.startsWith('/api/admin/fable-chat-data/')) return null;
    if (url.pathname.endsWith('/overview')) return ok({ statistics: { activeConversations: 2 } });
    if (url.pathname.endsWith('/conversations')) return ok({ conversations: ['A', 'B'].map(conversation), total: 2 });
    if (/\/conversations\/[AB]$/.test(url.pathname)) return detail(url.pathname.split('/').at(-1));
    return ok({ messages: [], attempts: [], checkpoints: [], usage: [], total: 0 });
  });
}
async function openFable(page) {
  await open(page, 'ai-lab');
  await page.locator('#fableDataOpen').click();
  await expect(page.locator('#fableDataConversationList')).toContainText('Conversation A');
}

test('U05 Fable stale conversation and transcript reads cannot replace a newer selection', async ({ page, baseURL }) => {
  const held = deferred(); let started = false;
  const unexpected = await setupFable(page, baseURL, async (request, url) => {
    if (url.pathname.endsWith('/conversations/A')) { started = true; await held.promise; return detail('A'); }
    return null;
  });
  await openFable(page);
  await page.getByRole('button', { name: 'Open Conversation A', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Open Conversation B', exact: true }).click();
  await expect(page.locator('#fableDataDetailTitle')).toHaveText('Conversation B');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/conversations/A'));
  held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
  await expect(page.locator('#fableDataDetailIdentity')).toContainText('B');
  await expect(page.locator('#fableDataPanelOverview')).toContainText('B');
  await page.locator('#fableDataClose').click();
  await expect(page.locator('#fableDataOpen')).toBeFocused();
  expect(unexpected).toEqual([]);
});

test('U05 Fable confirmation retains A identity/revision through a context switch and an explicit retry', async ({ page, baseURL }) => {
  const writes = []; let fail = true;
  const unexpected = await setupFable(page, baseURL, async (request, url) => {
    if (request.method() === 'PATCH' && /\/conversations\/[AB]$/.test(url.pathname)) {
      writes.push({ path: url.pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (fail) { fail = false; return { status: 503, body: { ok: false, error: 'Synthetic response lost' } }; }
      return ok({ result: { recorded: true } });
    }
    return null;
  });
  await openFable(page);
  await page.getByRole('button', { name: 'Open Conversation A', exact: true }).click();
  await expect(page.locator('#fableDataDetailTitle')).toHaveText('Conversation A');
  await page.locator('#fableDataDetailActions').getByRole('button', { name: 'Rename', exact: true }).click();
  await page.locator('#fableDataDialog input[name="title"]').fill('A new title');
  await page.locator('#fableDataDialog textarea[name="reason"]').fill('Synthetic change');
  // Force a newer request through the real handler while a confirmation is open.
  // This is a deterministic concurrency fixture, not an assertion that the modal permits pointer access behind it.
  await page.getByRole('button', { name: 'Open Conversation B', exact: true }).evaluate(button => button.click());
  await expect(page.locator('#fableDataDetailTitle')).toHaveText('Conversation B');
  await page.locator('#fableDataDialogConfirm').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toMatch(/\/A$/);
  expect(writes[0].body).toMatchObject({ operation: 'rename', title: 'A new title', expectedRevision: 4 });
  await expect(page.locator('#fableDataDetailTitle')).toHaveText('Conversation B');
  await page.getByRole('button', { name: 'Open Conversation A', exact: true }).click();
  await page.locator('#fableDataDetailActions').getByRole('button', { name: 'Retry original operation' }).click();
  await page.locator('#fableDataDialogConfirm').dblclick();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(unexpected).toEqual([]);
});

for (const failure of [false, true]) {
  test(`U05 organization billing ${failure ? 'error' : 'success'} from A cannot overwrite B or a cleared lookup`, async ({ page, baseURL }) => {
    const held = deferred(); let started = false;
    const unexpected = await setup(page, baseURL, async (request, url) => {
      if (url.pathname === `/api/admin/orgs/${orgs[0].id}/billing`) {
        started = true; await held.promise;
        return failure ? { status: 503, body: { ok: false, error: 'Old A lookup failed' } } : ok({ billing: { creditBalance: 111, planCode: 'A-plan' } });
      }
      if (url.pathname === `/api/admin/orgs/${orgs[1].id}/billing`) return ok({ billing: { creditBalance: 222, planCode: 'B-plan' } });
      return null;
    });
    await open(page, 'billing');
    const lookup = page.locator('#orgBillingSearch');
    const submit = page.locator('#orgBillingLookupForm button[type="submit"]');
    await lookup.fill(orgs[0].name); await submit.click();
    await expect.poll(() => started).toBe(true);
    await lookup.fill(orgs[1].name); await submit.click();
    await expect(page.locator('#orgBillingDetail')).toContainText('222');
    const oldResponse = page.waitForResponse(response => response.url().includes(`/${orgs[0].id}/billing`));
    held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
    await expect(page.locator('#orgBillingDetail')).toContainText('B-plan');
    await expect(page.locator('#orgBillingDetail')).not.toContainText('111');
    await expect(page.locator('#orgBillingDetail')).not.toContainText('Old A lookup failed');
    await lookup.fill('Unknown organization');
    await expect(page.locator('#orgBillingDetail')).toBeEmpty();
    expect(unexpected).toEqual([]);
  });
}

test('U03 duplicate user deletion intent opens one confirmation and sends one immutable target', async ({ page, baseURL }) => {
  const held = deferred(); const writes = [];
  const unexpected = await setup(page, baseURL, async (request, url) => {
    if (request.method() === 'DELETE' && url.pathname === `/api/admin/users/${users[0].id}`) {
      writes.push({ path: url.pathname, body: request.postDataJSON() }); await held.promise;
      return ok({ message: 'Synthetic user removed' });
    }
    return null;
  });
  await open(page, 'users');
  const row = page.locator('#userTbody tr').filter({ hasText: users[0].email });
  // Dispatch the same real handler twice, including before its first awaited confirmation.
  await row.getByRole('button', { name: 'Delete', exact: true }).evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('[data-testid="admin-delete-user-dialog"]')).toHaveCount(1);
  await page.locator('[data-testid="admin-delete-confirm-input"]').fill(users[0].email);
  await page.locator('[data-testid="admin-delete-submit"]').dblclick();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toContain(users[0].id);
  held.resolve();
  await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  expect(unexpected).toEqual([]);
});

test('U04 delayed storage reconciliation and completed A mutation do not repaint reopened B', async ({ page, baseURL }) => {
  const reconciliation = deferred(); const mutation = deferred(); let reconStarted = false; let writeStarted = false;
  const unexpected = await setup(page, baseURL, async (request, url) => {
    if (url.pathname.endsWith('/storage/reconciliation')) {
      reconStarted = true; await reconciliation.promise;
      return ok({ data: { reconciliation: { recommendation: 'A-only reconciliation', knownAssetBytes: 121212 } } });
    }
    if (request.method() === 'PATCH' && url.pathname.includes('/assets/a/rename')) {
      writeStarted = true; await mutation.promise; return ok({});
    }
    const match = url.pathname.match(/\/admin\/users\/(q3-user-[AB])\/storage$/);
    if (match) {
      const user = match[1] === users[0].id ? users[0] : users[1];
      return ok({ data: { user, folders: [], assets: [{ id: user === users[0] ? 'a' : 'b', title: user === users[0] ? 'A original' : 'B original', asset_type: 'image', visibility: 'private' }] } });
    }
    return null;
  });
  await open(page, 'users'); await userDetail(page, users[0], 'usage');
  await page.locator('#userStorageModalBody').getByRole('button', { name: 'Run D1 metadata reconciliation' }).click();
  await expect.poll(() => reconStarted).toBe(true);
  page.once('dialog', dialog => dialog.accept('A revised'));
  await page.locator('#userStorageModalBody').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect.poll(() => writeStarted).toBe(true);
  await page.locator('#userStorageModal').press('Escape'); await userDetail(page, users[1], 'usage');
  await expect(page.locator('#userStorageModalBody')).toContainText('B original');
  const oldReconciliation = page.waitForResponse(response => response.url().endsWith('/storage/reconciliation'));
  reconciliation.resolve(); await (await oldReconciliation).finished();
  const oldWrite = page.waitForResponse(response => response.url().endsWith('/assets/a/rename'));
  mutation.resolve(); await (await oldWrite).finished(); await renderSettled(page);
  await expect(page.locator('#userStorageModalBody')).toContainText('B original');
  await expect(page.locator('#userStorageModalBody')).not.toContainText('A-only reconciliation');
  await expect(page.locator('#userStorageModalSubtitle')).toContainText(users[1].email);
  expect(unexpected).toEqual([]);
});

test('U05 late Fable transcript remains with its original conversation', async ({ page, baseURL }) => {
  const held = deferred(); let started = false;
  const unexpected = await setupFable(page, baseURL, async (request, url) => {
    if (url.pathname.endsWith('/A/transcript')) {
      started = true; await held.promise;
      return ok({ messages: [{ id: 'message-A', turnId: 'turn-A', content: 'Private A transcript', role: 'user', state: 'succeeded' }], total: 1 });
    }
    if (url.pathname.endsWith('/B/transcript')) return ok({ messages: [{ id: 'message-B', turnId: 'turn-B', content: 'Current B transcript', role: 'user', state: 'succeeded' }], total: 1 });
    return null;
  });
  await openFable(page);
  await page.getByRole('button', { name: 'Open Conversation A', exact: true }).click();
  await expect(page.locator('#fableDataDetailTitle')).toHaveText('Conversation A');
  await page.locator('[data-fable-tab="transcript"]').click(); await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Open Conversation B', exact: true }).click();
  await expect(page.locator('#fableDataPanelTranscript')).toContainText('Current B transcript');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/A/transcript'));
  held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
  await expect(page.locator('#fableDataPanelTranscript')).not.toContainText('Private A transcript');
  await expect(page.locator('#fableDataPanelTranscript')).toContainText('Current B transcript');
  expect(unexpected).toEqual([]);
});

test('U03 lifecycle action preserves original request and approval note; duplicate actions and late export cannot affect B', async ({ page, baseURL }) => {
  const held = deferred(); const exported = deferred(); const writes = []; let exportStarted = false; let failed = false; let approved = false;
  const requestFor = id => ({ id, type: 'erasure', status: id === 'request-A' && approved ? 'approved' : 'planned', subjectUserId: id === 'request-A' ? users[0].id : users[1].id, dryRun: true, approvalRequired: true, createdAt: '2026-09-01T12:00:00Z' });
  const unexpected = await setup(page, baseURL, async (request, url) => {
    if (url.pathname === '/api/admin/data-lifecycle/requests') return ok({ requests: ['request-A', 'request-B'].map(requestFor) });
    if (url.pathname === '/api/admin/data-lifecycle/archives') return ok({ archives: [] });
    if (url.pathname.endsWith('/request-A/evidence')) { exportStarted = true; await exported.promise; return ok({ evidence: 'A-only synthetic evidence' }); }
    if (request.method() === 'POST' && url.pathname.startsWith('/api/admin/data-lifecycle/requests/')) {
      writes.push({ path: url.pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (!failed) { failed = true; await held.promise; return { status: 503, body: { ok: false, error: 'A approval response unknown' } }; }
      approved = true; return ok({ request: requestFor('request-A') });
    }
    const match = url.pathname.match(/\/data-lifecycle\/requests\/(request-[AB])$/);
    if (match) return ok({ request: requestFor(match[1]), items: [{ resourceType: 'user', tableName: 'users', action: 'retain', status: 'planned', summary: { email: match[1] === 'request-A' ? users[0].email : users[1].email } }] });
    return null;
  });
  await open(page, 'lifecycle');
  await page.locator('[data-lifecycle-request-open="request-A"]').click();
  const dialog = page.getByRole('dialog', { name: 'Data Lifecycle Request Detail' });
  const approval = dialog.locator('.admin-lifecycle-detail__panel').filter({ has: page.getByRole('heading', { name: 'Approval', exact: true }) });
  await approval.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog).toContainText('Approval acknowledgement is required.'); expect(writes).toHaveLength(0);
  await approval.locator('input[type="checkbox"]').check();
  await approval.locator('textarea').fill('Original approval A');
  await approval.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await dialog.getByRole('button', { name: 'Generate Plan', exact: true }).click();
  expect(writes).toHaveLength(1);
  await approval.locator('textarea').fill('New unsent approval B');
  await dialog.locator('.admin-lifecycle-detail__header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-lifecycle-request-open="request-B"]').click();
  await expect(dialog).toContainText(users[1].id);
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/request-A/approve'));
  held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
  await expect(dialog).toContainText(users[1].id);
  await expect(dialog).not.toContainText('Approve: Backend dependency is unavailable');
  await dialog.locator('.admin-lifecycle-detail__header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-lifecycle-request-open="request-A"]').click();
  await expect(dialog).toContainText('Approve: Backend dependency is unavailable or fail-closed. Status: 503');
  await approval.locator('input[type="checkbox"]').check();
  await approval.locator('textarea').fill('Different note must not replace original');
  await approval.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body.reason).toBe('Original approval A');
  await expect(dialog).toContainText('approved');
  let downloads = 0; page.on('download', () => { downloads += 1; });
  await dialog.getByRole('button', { name: 'Export Evidence JSON', exact: true }).click();
  await expect.poll(() => exportStarted).toBe(true);
  await dialog.locator('.admin-lifecycle-detail__header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-lifecycle-request-open="request-B"]').click();
  const exportResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/request-A/evidence'));
  exported.resolve(); await (await exportResponse).finished(); await renderSettled(page);
  expect(downloads).toBe(0);
  await expect(dialog).toContainText(users[1].id);
  expect(unexpected).toEqual([]);
});

test('Q2 pack detail distinguishes validated checkout, recorded action state and completed fulfillment evidence', async ({ page, baseURL }) => {
  const event = { id: 'event-pack', eventType: 'checkout.session.completed', processingStatus: 'planned', provider: 'stripe', providerMode: 'live', verificationStatus: 'verified_live_signature', payloadSummary: { creditPackValidatedCheckoutId: 'checkout-existing' }, actions: [{ actionType: 'checkout.session.completed', status: 'planned', dryRun: false, summary: { fulfillmentStatus: 'completed', checkoutStatus: 'completed', ledgerEntryLinked: true, creditGrantStatus: 'granted' } }] };
  const unexpected = await setup(page, baseURL, (request, url) => {
    if (url.pathname === '/api/admin/billing/events') return ok({ events: [event] });
    if (url.pathname === '/api/admin/billing/events/event-pack') return ok({ event });
    return null;
  });
  await open(page, 'billing-events');
  await page.locator('#billingEventsList').getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('#billingEventDetail')).toContainText('Validated checkout reference');
  await expect(page.locator('#billingEventDetail')).toContainText('checkout-existing');
  await expect(page.locator('#billingEventDetail')).toContainText('Fulfillment: completed');
  await expect(page.locator('#billingEventDetail')).toContainText('Ledger linked: yes; entry ID not reported');
  await expect(page.locator('#billingEventDetail')).toContainText('planned');
  expect(unexpected).toEqual([]);
});

test('U03 storage deletion retry retains its original target, reason and key after an unknown response', async ({ page, baseURL }) => {
  const writes = []; let deleted = false; let reason = 'Original deletion review';
  const unexpected = await setup(page, baseURL, (request, url) => {
    if (url.pathname === `/api/admin/users/${users[0].id}/storage`) return ok({ data: { user: users[0], folders: [], assets: deleted ? [] : [{ id: 'delete-A', title: 'A selected asset', asset_type: 'image', visibility: 'private' }] } });
    if (url.pathname === `/api/admin/users/${users[0].id}/assets/delete-A` && request.method() === 'DELETE') {
      writes.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (writes.length === 1) return { abort: true };
      deleted = true; return ok({});
    }
    return null;
  });
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? reason : undefined));
  await open(page, 'users'); await userDetail(page, users[0], 'usage');
  const deleteButton = page.locator('#userStorageModalBody').getByRole('button', { name: 'Delete', exact: true });
  await deleteButton.click();
  await expect(page.locator('#userStorageModalBody [role="alert"]')).toBeVisible();
  reason = 'A later annotation must not replace the original intent';
  await deleteButton.click();
  await expect(page.locator('#userStorageModalBody')).toContainText('No Assets Manager files');
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body).toMatchObject({ reason: 'Original deletion review', targetUserId: users[0].id, assetId: 'delete-A', confirm: true });
  expect(unexpected).toEqual([]);
});

test('U03 member grant retries the same purchase-independent adjustment without duplicate credit intent', async ({ page, baseURL }) => {
  const writes = [];
  const unexpected = await setup(page, baseURL, (request, url) => {
    if (url.pathname === '/api/admin/users' && url.searchParams.get('search') === users[0].email) return ok({ users: [users[0]] });
    if (url.pathname === `/api/admin/users/${users[0].id}/credits/grant`) {
      writes.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (writes.length === 1) return { status: 503, body: { ok: false, error: 'Member adjustment not confirmed' } };
      return ok({ ledgerEntry: { balanceAfter: 88 } });
    }
    return null;
  });
  page.on('dialog', dialog => dialog.accept());
  await open(page, 'billing');
  await page.locator('#creditGrantUserSearch').fill(users[0].email);
  await page.locator('#userCreditGrantAmount').fill('25');
  await page.locator('#userCreditGrantReason').fill('Original member adjustment');
  await page.locator('#userCreditGrantForm button[type="submit"]').click();
  const retry = page.locator('#userCreditGrantResult').getByRole('button', { name: 'Retry this exact grant' });
  await expect(retry).toBeVisible();
  await page.locator('#creditGrantUserSearch').fill(users[1].email);
  await page.locator('#userCreditGrantAmount').fill('400');
  await retry.dblclick();
  await expect(page.locator('#userCreditGrantResult')).toContainText('Balance after: 88');
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body).toEqual({ amount: 25, reason: 'Original member adjustment' });
  await expect(page.locator('#creditGrantUserSearch')).toHaveValue(users[1].email);
  expect(unexpected).toEqual([]);
});

for (const failure of [false, true]) for (const close of [false, true]) {
  test(`Q3 review exact user link ${failure ? 'error' : 'success'} cannot ${close ? 'reopen a closed dialog' : 'replace row-selected B'}`, async ({ page, baseURL }) => {
    const held = deferred(); let started = false;
    const unexpected = await setup(page, baseURL, async (_request, url) => {
      if (url.pathname === '/api/admin/users/q3-linked-A/billing') {
        started = true; await held.promise;
        return failure ? { status: 403, body: { ok: false, error: 'Old linked A denied' } } : ok({ billing: { userId: 'q3-linked-A', email: 'linked-a@example.test', role: 'user', status: 'active' } });
      }
      return null;
    });
    await open(page, 'users');
    await expect(page.locator('#userTbody')).toContainText(users[1].email);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('admin:open-context', { detail: { section: 'users', userId: 'q3-linked-A' } })));
    await expect.poll(() => started).toBe(true);
    await expect(page.locator('#userInfoModal')).toBeVisible();
    if (close) await page.locator('#userInfoModal').press('Escape');
    else await page.locator('#userTbody tr').filter({ hasText: users[1].email }).getByRole('button', { name: 'Info', exact: true }).evaluate(button => button.click());
    const oldResponse = page.waitForResponse(response => response.url().includes('/q3-linked-A/billing'));
    held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
    if (close) await expect(page.locator('#userInfoModal')).toBeHidden();
    else await expect(page.locator('#userInfoModalSubtitle')).toContainText(users[1].email);
    await expect(page.locator('#adminToast')).not.toContainText('Old linked A denied');
    expect(unexpected).toEqual([]);
  });
}

test('Q3 review delayed org context cannot replace manual B; failed new context clears previous billing', async ({ page, baseURL }) => {
  const held = deferred(); let started = false; let directBFails = false;
  const unexpected = await setup(page, baseURL, async (_request, url) => {
    if (url.pathname === `/api/admin/orgs/${orgs[0].id}`) { started = true; await held.promise; return ok({ organization: orgs[0] }); }
    if (url.pathname === `/api/admin/orgs/${orgs[1].id}`) return directBFails ? { status: 403, body: { ok: false, error: 'B denied' } } : ok({ organization: orgs[1] });
    if (url.pathname.endsWith('/billing') && url.pathname.includes('/admin/orgs/')) return ok({ billing: { creditBalance: url.pathname.includes(orgs[0].id) ? 111 : 222, planCode: 'fixture' } });
    return null;
  });
  await open(page, 'billing');
  const navigate = orgId => page.evaluate(id => document.dispatchEvent(new CustomEvent('admin:open-context', { detail: { section: 'billing', orgId: id } })), orgId);
  await navigate(orgs[0].id); await expect.poll(() => started).toBe(true);
  await page.locator('#orgBillingSearch').fill(orgs[1].name);
  await page.locator('#orgBillingLookupForm button[type="submit"]').click();
  await expect(page.locator('#orgBillingDetail')).toContainText('222');
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/orgs/${orgs[0].id}`);
  held.resolve(); await (await oldResponse).finished(); await renderSettled(page);
  await expect(page.locator('#orgBillingSearch')).toHaveValue(orgs[1].name);
  await expect(page.locator('#orgBillingDetail')).toContainText('222');
  await expect(page.locator('#orgBillingDetail')).not.toContainText('111');
  directBFails = true; await navigate(orgs[1].id);
  await expect(page.locator('#orgBillingState')).toContainText('Requested organization unavailable');
  await expect(page.locator('#orgBillingDetail')).toBeEmpty();
  await expect(page.locator('#orgBillingSearch')).toHaveValue('');
  expect(unexpected).toEqual([]);
});

test('Q3 review reconciliation links only actual local event IDs, with explicit provider reference fallback', async ({ page, baseURL }) => {
  const eventId = 'bpe_' + 'a'.repeat(32); const eventReads = [];
  const unexpected = await setup(page, baseURL, async (_request, url) => {
    if (url.pathname === '/api/admin/billing/reconciliation') return ok({ generatedAt: '2026-09-06T12:00:00Z', sections: [{ id: 'checkout_sessions', title: 'Checkout Sessions', items: [
      { id: 'local', title: 'Live checkout webhook events lack linked local ledger evidence.', refs: { id: eventId, providerEventId: 'evt_fixture_A' } },
      { id: 'external', title: 'Ledger-linked live checkout sessions are missing billing event links.', refs: { id: 'checkout_fixture_B', providerEventId: 'evt_fixture_B' } },
    ] }] });
    if (/\/admin\/billing\/events\/.+/.test(url.pathname)) { eventReads.push(url.pathname); return ok({ event: { id: eventId, providerEventId: 'evt_fixture_A', status: 'stored' }, actions: [] }); }
    return null;
  });
  await open(page, 'billing-events');
  const panel = page.locator('#billingReconciliationPanel');
  await expect(panel.getByRole('button', { name: 'Inspect event', exact: true })).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Copy provider event reference' })).toHaveCount(2);
  await expect(panel).toContainText('Local event reference not reported.');
  await panel.getByRole('button', { name: 'Inspect event', exact: true }).click();
  await expect.poll(() => eventReads.length).toBe(1);
  expect(eventReads[0]).toMatch(new RegExp('/' + eventId + '$'));
  expect(unexpected).toEqual([]);
});

test('Q3 review lifecycle returns from interrupted read without a permanent loading state', async ({ page, baseURL }) => {
  const held = deferred(); let reads = 0;
  const unexpected = await setup(page, baseURL, async (_request, url) => {
    if (url.pathname === '/api/admin/data-lifecycle/requests') { reads += 1; if (reads === 2) await held.promise; return ok({ requests: [] }); }
    if (url.pathname === '/api/admin/data-lifecycle/archives') return ok({ archives: [] });
    return null;
  });
  await open(page, 'lifecycle'); await expect(page.locator('#lifecycleRequestsState')).toContainText('No lifecycle requests found.');
  await page.locator('#lifecycleRequestsRefresh').click(); await expect.poll(() => reads).toBe(2);
  await page.evaluate(() => { location.hash = 'users'; }); await expect(page.locator('#userTbody')).toContainText(users[0].email);
  await page.evaluate(() => { location.hash = 'lifecycle'; });
  await expect.poll(() => reads).toBe(3);
  await expect(page.locator('#lifecycleRequestsState')).toContainText('No lifecycle requests found.');
  held.resolve(); await renderSettled(page);
  expect(unexpected).toEqual([]);
});

for (const action of ['Archive', 'Restore']) {
  test(`Q3 review ${action.toLowerCase()} retains original intent across hidden completion and explicit retry`, async ({ page, baseURL }) => {
    const id = 'bpe_' + 'b'.repeat(32); const held = deferred(); const writes = []; let eventReads = 0; let archived = action === 'Restore';
    const endpoint = `/api/admin/billing/operator-archive${action === 'Restore' ? '/restore' : ''}`;
    const unexpected = await setup(page, baseURL, async (request, url) => {
      if (request.method() === 'POST' && url.pathname === endpoint) {
        writes.push({ path: url.pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
        if (writes.length === 1) { await held.promise; return { status: 503, body: { ok: false, error: 'Original operation outcome unknown' } }; }
        archived = action === 'Archive'; return ok({ reused: true, run: { status: 'applied' } });
      }
      if (url.pathname === '/api/admin/billing/events') { eventReads += 1; return ok({ events: archived ? [] : [{ id, eventType: 'checkout.session.completed', providerEventId: 'evt_original', provider: 'stripe' }] }); }
      if (url.pathname === '/api/admin/billing/operator-archive') return ok({ archiveItems: archived ? [{ itemType: 'billing_provider_event', itemId: id, archivedAt: '2026-09-06T10:00:00Z', reason: 'Synthetic original' }] : [] });
      if (url.pathname === '/api/admin/billing/reviews') return ok({ reviews: [] });
      return null;
    });
    page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'Original reason' : undefined));
    await open(page, 'billing-events');
    const control = action === 'Archive'
      ? page.locator('#billingEventsList').getByRole('button', { name: 'Archive', exact: true })
      : page.locator('#billingArchiveList').getByRole('button', { name: 'Restore visibility', exact: true });
    if (action === 'Restore') await page.locator('#billingArchiveList summary').click();
    await control.dblclick(); await expect.poll(() => writes.length).toBe(1);
    const readsBefore = eventReads;
    await page.evaluate(() => { location.hash = 'users'; }); await expect(page.locator('#userTbody')).toContainText(users[0].email);
    const response = page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname === endpoint);
    held.resolve(); await (await response).finished(); await renderSettled(page);
    expect(eventReads).toBe(readsBefore); expect(writes).toHaveLength(1);
    await page.evaluate(() => { location.hash = 'billing-events'; });
    await page.getByRole('button', { name: `Retry original ${action.toLowerCase()}`, exact: true }).dblclick();
    await expect.poll(() => writes.length).toBe(2); expect(writes[1]).toEqual(writes[0]);
    await expect(page.locator(`#${action === 'Archive' ? 'billingEventsState' : 'billingArchiveState'}Operations`)).toContainText('current record state is not verified');
    expect(eventReads).toBe(readsBefore);
    await page.getByRole('button', { name: 'Refresh affected billing views', exact: true }).click();
    await expect.poll(() => eventReads).toBe(readsBefore + 1);
    expect(unexpected).toEqual([]);
  });
}

test('Q3 review resolution has one immutable intent and no hidden refresh after success', async ({ page, baseURL }) => {
  const id = 'bpe_' + 'c'.repeat(32); const held = deferred(); const writes = []; let reads = 0; let resolved = false;
  const review = () => ({ id, reviewState: resolved ? 'resolved' : 'needs_review', eventType: 'invoice.paid', providerEventId: 'evt_review', providerMode: 'test', safeIdentifiers: { customerId: 'cus_synthetic' } });
  const unexpected = await setup(page, baseURL, async (request, url) => {
    if (url.pathname === '/api/admin/billing/reviews') { reads += 1; return ok({ reviews: [review()] }); }
    if (url.pathname === `/api/admin/billing/reviews/${id}`) return ok({ review: review() });
    if (url.pathname === `/api/admin/billing/reviews/${id}/resolution`) {
      writes.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (writes.length === 1) return { status: 503, body: { ok: false, error: 'Resolution response unknown' } };
      await held.promise; resolved = true; return ok({ reused: true });
    }
    return null;
  });
  await open(page, 'billing-events'); await page.getByRole('button', { name: 'Inspect Review', exact: true }).click();
  await page.locator('#billingReviewResolutionNote').fill('Original resolution note');
  await page.getByRole('button', { name: 'Mark Resolved', exact: true }).click();
  await expect(page.locator('#billingReviewResolutionState')).toContainText('confirmation are required'); expect(writes).toHaveLength(0);
  await page.locator('#billingReviewResolutionConfirm').check();
  await page.getByRole('button', { name: 'Mark Resolved', exact: true }).dblclick();
  await expect.poll(() => writes.length).toBe(1);
  await page.locator('#billingReviewResolutionNote').fill('Changed unsubmitted note');
  await page.getByRole('button', { name: 'Mark Dismissed', exact: true }).click(); expect(writes).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Retry original resolution', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body).toEqual({ resolution_status: 'resolved', resolution_note: 'Original resolution note' });
  const before = reads; await page.evaluate(() => { location.hash = 'users'; });
  await expect(page.locator('#userTbody')).toContainText(users[0].email);
  const response = page.waitForResponse(res => res.request().method() === 'POST' && res.url().includes('/resolution'));
  held.resolve(); await (await response).finished(); await renderSettled(page); expect(reads).toBe(before);
  await page.evaluate(() => { location.hash = 'billing-events'; });
  await expect.poll(() => reads).toBe(before + 1);
  await page.getByRole('button', { name: 'Inspect Review', exact: true }).click();
  await expect(page.locator('#billingReviewDetail')).toContainText('resolved');
  await expect(page.locator('#billingReviewResolutionForm')).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('Q3 review billing refresh resumes after leaving a previously loaded section', async ({ page, baseURL }) => {
  const held = deferred(); let reads = 0;
  const unexpected = await setup(page, baseURL, async (_request, url) => {
    if (url.pathname === '/api/admin/billing/events') { reads += 1; if (reads === 2) await held.promise; return ok({ events: [] }); }
    return null;
  });
  await open(page, 'billing-events');
  await expect(page.locator('#billingEventsState')).toContainText('No');
  await page.locator('#billingEventsFilter button[type="submit"]').click(); await expect.poll(() => reads).toBe(2);
  await page.evaluate(() => { location.hash = 'users'; }); await expect(page.locator('#userTbody')).toContainText(users[0].email);
  await page.evaluate(() => { location.hash = 'billing-events'; });
  await expect.poll(() => reads).toBe(3);
  await expect(page.locator('#billingEventsState')).not.toContainText('Loading');
  held.resolve(); await renderSettled(page); expect(unexpected).toEqual([]);
});

for (const explicit of [true, false]) test(`Q3 review archive cycle ${explicit ? 'allows explicit confirmed opposite operation' : 'retains guard without opposite-operation confirmation'}`, async ({ page, baseURL }) => {
  const id = 'bpe_' + 'd'.repeat(32); const writes = []; let archived = false;
  const unexpected = await setup(page, baseURL, async (request, url) => {
    if (request.method() === 'POST' && url.pathname.startsWith('/api/admin/billing/operator-archive')) {
      writes.push({ path: url.pathname, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      archived = !url.pathname.endsWith('/restore'); return ok({ ...(writes.length !== 2 || explicit ? { reused: false } : {}), run: { status: 'applied' } });
    }
    if (url.pathname === '/api/admin/billing/events') return ok({ events: archived ? [] : [{ id, providerEventId: 'evt_cycle', eventType: 'checkout.session.completed', provider: 'stripe' }] });
    if (url.pathname === '/api/admin/billing/operator-archive') return ok({ archiveItems: archived ? [{ itemType: 'billing_provider_event', itemId: id, archivedAt: '2026-09-06T10:00:00Z' }] : [] });
    return null;
  });
  page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'Intentional visibility cycle' : undefined));
  await open(page, 'billing-events');
  await page.locator('#billingEventsList').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await page.getByRole('button', { name: 'Refresh affected billing views', exact: true }).first().click();
  await page.locator('#billingArchiveList summary').click();
  await page.getByRole('button', { name: 'Restore visibility', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  await page.getByRole('button', { name: 'Refresh affected billing views', exact: true }).first().click();
  await page.locator('#billingEventsList').getByRole('button', { name: 'Archive', exact: true }).click();
  if (explicit) {
    await expect.poll(() => writes.length).toBe(3);
    expect(writes[2].path).toEqual(writes[0].path); expect(writes[2].body).toEqual(writes[0].body);
    expect(writes[2].key).not.toEqual(writes[0].key);
  } else { await renderSettled(page); expect(writes).toHaveLength(2); }
  expect(unexpected).toEqual([]);
});
