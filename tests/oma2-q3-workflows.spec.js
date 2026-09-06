const { test, expect } = require('@playwright/test');

// Gated, actual Admin page journeys. All records and effects below are synthetic.
// Shapes follow the existing Admin API serializers; no Worker/Stripe/R2 is started.
// Only the external frozen-baseline comparison runner sets this switch.
// Normal repository execution requires the new direct context paths.
const BASELINE_CONTEXT = process.env.Q3_BASELINE_CONTEXT === '1';
const DATE = '2026-09-06T10:00:00.000Z';
const ADMIN = { id: 'q3-admin', email: 'operator@example.test', role: 'admin', status: 'active' };
const MEMBER = { id: 'q3-user', email: 'member@example.test', display_name: 'Synthetic Member', role: 'user', status: 'active', email_verified_at: DATE, created_at: DATE };
const ORG = { id: 'q3-org', name: 'Synthetic Studio', slug: 'synthetic-studio', status: 'active', memberCount: 1, createdByEmail: MEMBER.email, createdAt: DATE };
const EVENT = { id: 'q3-event', provider: 'stripe', providerMode: 'test', eventType: 'checkout.session.completed', processingStatus: 'planned', verificationStatus: 'verified_test_signature', organizationId: ORG.id, userId: MEMBER.id, receivedAt: DATE, payloadSummary: { creditPackId: 'credits_5000', credits: 5000, creditPackValidatedCheckoutId: 'q3-checkout', checkoutSessionIdPresent: true }, actions: [{ actionType: 'checkout.session.completed', status: 'planned', dryRun: false, summary: { fulfillmentStatus: 'completed', checkoutStatus: 'completed', ledgerEntryLinked: true, creditGrantStatus: 'granted', credits: 5000 } }] };
const ATTEMPT = { attemptId: 'q3-attempt', organizationId: ORG.id, userId: MEMBER.id, feature: 'ai.text.generate', status: 'unknown', providerStatus: 'unknown', billingStatus: 'reserved', creditCost: 3, replay: { available: false, status: 'outcome_unknown' }, updatedAt: DATE, route: '/api/ai/generate-text', result: { model: 'synthetic-model', promptLength: 20 }, error: { code: 'provider_outcome_unknown' } };
const LIFECYCLE = { id: 'q3-lifecycle', type: 'delete', status: 'planned', subjectUserId: MEMBER.id, dryRun: true, reason: 'Synthetic retention review; no execution requested.', requestedByAdminId: ADMIN.id, approvalRequired: true, createdAt: DATE, updatedAt: DATE, expiresAt: '2026-10-06T10:00:00.000Z' };
const r2Object = key => ({ type: 'object', bucket: 'USER_IMAGES', key, name: key, size: 8, contentType: 'text/plain', owner: { userId: MEMBER.id, label: 'Synthetic Member' }, appLink: { linked: false, links: [] } });

async function fixture(page, baseURL, { storageError = false } = {}) {
  const origin = new URL(baseURL).origin;
  const observed = { requests: [], writes: [], unexpected: [] };
  let news = { id: 'q3-news', title: 'Synthetic News', summary: 'Editor-owned EN content', locale: 'en', source: 'Synthetic source', url: 'https://example.test/story', category: 'AI', status: 'active', published_at: '2026-06-17T10:12:34.567Z', expires_at: null };
  let preset = { maxWidth: 1080, fps: 24, durationSeconds: 6, crf: 28, posterWidth: 720, encoderPreset: 'slow', audio: false };
  const budget = { switchKey: 'ENABLE_ADMIN_AI_TEXT_BUDGET', flagName: 'ENABLE_ADMIN_AI_TEXT_BUDGET', label: 'Admin Text Budget', description: 'Synthetic current control', budgetScope: 'platform_admin_lab_budget', masterFlagStatus: 'enabled', masterConfigured: true, masterEnabled: true, appSwitchStatus: 'disabled', appSwitchEnabled: false, appSwitchAvailable: true, effectiveEnabled: false, disabledReason: 'admin_switch_disabled', liveCapStatus: 'cap_enforced', updatedAt: DATE };
  const reply = async (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: status < 400, ...body }) });
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (url.origin !== origin) { observed.unexpected.push('external:' + url.origin); return route.abort(); }
    if (!path.startsWith('/api/')) return route.continue();
    observed.requests.push({ method: req.method(), path, query: url.searchParams.toString() });
    if (!['GET', 'HEAD'].includes(req.method())) {
      const input = req.postDataJSON(); observed.writes.push({ path, method: req.method(), body: input, key: req.headers()['idempotency-key'] });
      if (path === '/api/admin/news-pulse/items/q3-news' && req.method() === 'PATCH') { news = { ...news, ...input }; return reply(route, { data: { item: news } }); }
      if (path === '/api/admin/homepage/hero-videos/preset' && req.method() === 'PATCH') { preset = input.preset; return reply(route, { data: { preset_status: { preset } } }); }
      if (path === '/api/admin/ai/budget-switches/' + budget.switchKey && req.method() === 'PATCH') { budget.appSwitchEnabled = input.enabled; budget.appSwitchStatus = input.enabled ? 'enabled' : 'disabled'; budget.effectiveEnabled = input.enabled && budget.masterEnabled; return reply(route, { switch: budget, event: { id: 'q3-switch-event', replayed: false, createdAt: DATE } }); }
      observed.unexpected.push(req.method() + ':' + path); return reply(route, { error: 'Unexpected synthetic mutation' }, 503);
    }
    if (path === '/api/admin/me') return reply(route, { user: ADMIN });
    if (path === '/api/me') return reply(route, { loggedIn: true, user: ADMIN });
    if (path === '/api/wallet/status') return reply(route, { authenticated: true, linked_wallet: null });
    if (path === '/api/admin/stats') return reply(route, { stats: { totalUsers: 2, activeUsers: 2, admins: 1, verifiedUsers: 2, disabledUsers: 0, recentRegistrations: 0 } });
    if (path === '/api/admin/registration/status') return reply(route, { registration: { enabled: true, settingPresent: true, storageAvailable: true, updatedAt: DATE } });
    if (path === '/api/admin/users') return reply(route, { users: [MEMBER], next_cursor: null, has_more: false });
    if (path === '/api/admin/users/q3-user/billing') return reply(route, { billing: { userId: MEMBER.id, email: MEMBER.email, role: MEMBER.role, status: MEMBER.status, creditBalance: 5000, dailyCreditAllowance: 10, balance: { current: 5000, available: 5000 }, transactions: [] } });
    if (path === '/api/admin/orgs') return reply(route, { organizations: [ORG] });
    if (path === '/api/admin/orgs/q3-org') return reply(route, { organization: ORG, members: [{ userId: MEMBER.id, email: MEMBER.email, role: 'owner', status: 'active', createdAt: DATE }] });
    if (path === '/api/admin/orgs/q3-org/user-access') return reply(route, { users: [{ userId: MEMBER.id, email: MEMBER.email, accountRole: 'user', accountStatus: 'active', assigned: true, membership: { role: 'owner', status: 'active' } }] });
    if (path === '/api/admin/orgs/q3-org/billing') return reply(route, { billing: { organizationId: ORG.id, plan: { name: 'Synthetic plan' }, creditBalance: 5000, livePaymentProviderEnabled: false, entitlements: [] } });
    if (path === '/api/admin/billing/plans') return reply(route, { plans: [{ id: 'q3-plan', name: 'Synthetic plan', code: 'synthetic', monthlyCreditGrant: 5000, entitlements: [] }] });
    if (path === '/api/admin/billing/events') return reply(route, { events: [EVENT], livePaymentProviderEnabled: false });
    if (path === '/api/admin/billing/events/q3-event') return reply(route, { event: EVENT, livePaymentProviderEnabled: false });
    if (path === '/api/admin/billing/evidence/status') return reply(route, { generatedAt: DATE, source: 'synthetic_config_only', productionReadiness: 'blocked', liveBillingReadiness: 'blocked', stripeCallsMade: false, creditMutationPerformed: false, redactedResponse: true, creditPacks: { status: 'evidence_required' }, subscription: { status: 'evidence_required' } });
    if (path === '/api/admin/billing/reconciliation') return reply(route, { generatedAt: DATE, source: 'synthetic_local_d1_read', verdict: 'review_required', summary: {}, sections: [], notes: ['Synthetic bounded review only.'] });
    if (path === '/api/admin/billing/reviews') return reply(route, { reviews: [] });
    if (path === '/api/admin/billing/operator-archive') return reply(route, { archiveItems: [] });
    if (path === '/api/admin/billing/live-readiness/status') return reply(route, { generatedAt: DATE, source: 'synthetic_config_only', finalVerdict: { status: 'blocked_pending_operator_evidence' }, evidenceChecklist: [], actions: {} });
    if (path === '/api/admin/ai/usage-attempts') return reply(route, { attempts: [ATTEMPT] });
    if (path === '/api/admin/ai/usage-attempts/q3-attempt') return reply(route, { attempt: ATTEMPT });
    if (path === '/api/admin/ai/budget-switches') return reply(route, { summary: { totalSwitches: 1, masterEnabledCount: 1, appEnabledCount: Number(budget.appSwitchEnabled), effectiveEnabledCount: Number(budget.effectiveEnabled), liveBudgetCapsStatus: 'cap_enforced' }, switches: [budget] });
    if (path === '/api/admin/ai/platform-budget-caps') return reply(route, { budgetScope: 'platform_admin_lab_budget', liveBudgetCapsStatus: 'cap_enforced', capEnforced: true, generatedAt: DATE, windows: [{ windowType: 'daily', windowValue: '2026-09-06', usedUnits: 12, remainingUnits: 88, capStatus: 'available', limit: { limitUnits: 100, updatedAt: DATE, mode: 'enforce', status: 'active' } }] });
    if (path === '/api/admin/ai/platform-budget-usage') return reply(route, { usage: { budgetScope: 'platform_admin_lab_budget', operationUsage: [], recentEvents: [] } });
    if (path === '/api/admin/ai/platform-budget-reconciliation') return reply(route, { reconciliation: { budgetScope: 'platform_admin_lab_budget', verdict: 'no_candidates', summary: {}, repairApplied: false, candidates: [], findings: [] } });
    if (path === '/api/admin/ai/platform-budget-repair-report') return reply(route, { report: { budgetScope: 'platform_admin_lab_budget', source: 'synthetic_local_read', generatedAt: DATE, summary: {}, automaticRepair: false, actions: [] } });
    if (path === '/api/admin/ai/platform-budget-evidence-archives') return reply(route, { budgetScope: 'platform_admin_lab_budget', archives: [] });
    if (path === '/api/admin/r2/buckets') return reply(route, { data: { buckets: [{ id: 'USER_IMAGES', displayName: 'Synthetic images' }] } });
    if (path === '/api/admin/r2/objects') return reply(route, { data: url.searchParams.get('cursor') === 'q3-next' ? { objects: [r2Object('second-page.txt')], hasMore: false } : { objects: [r2Object('first-page.txt')], cursor: 'q3-next', hasMore: true } });
    if (path === '/api/admin/r2/objects/detail') return reply(route, { data: { object: r2Object(url.searchParams.get('key')) } });
    if (path === '/api/admin/data-lifecycle/requests') return reply(route, { requests: [LIFECYCLE] });
    if (path === '/api/admin/data-lifecycle/requests/q3-lifecycle') return reply(route, { request: LIFECYCLE, items: [{ id: 'q3-retention', resourceType: 'billing', resourceId: 'q3-ledger', tableName: 'member_credit_ledger', action: 'retain', status: 'planned', summary: { reason: 'Financial evidence retained' } }, { id: 'q3-block', resourceType: 'r2_object', resourceId: 'q3-private-alias', action: 'manual_review_required', status: 'blocked', summary: { reason: 'Ownership review required' } }] });
    if (path === '/api/admin/data-lifecycle/exports') return reply(route, { archives: [] });
    if (path === '/api/admin/tenant-assets/domains/evidence') return storageError ? reply(route, { error: 'Synthetic evidence unavailable' }, 503) : reply(route, { report: { source: 'synthetic-domain-metadata', generatedAt: DATE, domains: [] } });
    if (path === '/api/admin/tenant-assets/access-switch/status') return reply(route, { status: { generatedAt: DATE, currentMode: 'off', sourceOfTruth: 'legacy_user_id_runtime_access_checks', runtimeSwitchRepoSupported: false, liveSwitchEnabled: false, tenantIsolationClaimed: false, productionReadiness: 'blocked' } });
    if (path === '/api/admin/tenant-assets/legacy-media-reset/status') return reply(route, { status: { generatedAt: DATE, dryRunAvailable: true, confirmedExecutionGate: { name: 'ENABLE_LEGACY_MEDIA_RESET_CONFIRMED_EXECUTION', enabled: false, valueExposed: false }, confirmedReadiness: 'blocked', dangerousOperationsApproved: false, productionReadiness: 'blocked', tenantIsolationClaimed: false } });
    if (path === '/api/admin/tenant-assets/manual-review/evidence') return reply(route, { report: { summary: {}, items: [], generatedAt: DATE } });
    if (path === '/api/admin/news-pulse/overview') return reply(route, { data: { counts: { active: 1 }, generated_at: DATE } });
    if (path === '/api/admin/news-pulse/visibility') return reply(route, { data: { settings: { desktop: { enabled: true }, mobile: { enabled: true } } } });
    if (path === '/api/admin/news-pulse/items') return reply(route, { data: { items: [news], has_more: false } });
    if (path === '/api/admin/news-pulse/items/q3-news') return reply(route, { data: { item: news } });
    if (path === '/api/admin/homepage/hero-videos') return reply(route, { data: { slots: [], preset_status: { preset }, feature_status: { features: {} } } });
    if (path === '/api/admin/homepage/hero-videos/candidates') return reply(route, { data: { candidates: [] } });
    if (path === '/api/admin/homepage/hero-videos/derivatives') return reply(route, { data: { derivatives: [] } });
    observed.unexpected.push(req.method() + ':' + path); return reply(route, { error: 'Unconfigured synthetic read' }, 503);
  });
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', ts: Date.now(), necessary: true, analytics: false, marketing: false })));
  return observed;
}
async function open(page, hash) {
  await page.goto('/admin/index.html#' + hash);
  await expect(page.locator('#adminPanel')).toBeVisible();
  await expect(page.locator('#adminDenied')).not.toBeVisible();
}
async function nav(page, section, steps) {
  const link = page.locator(`#adminNav a[data-section="${section}"]`);
  if (!await link.isVisible()) {
    const toggle = page.locator('#adminNavToggle');
    if (await toggle.isVisible()) { await toggle.click(); steps?.push('Open navigation'); }
    const group = link.locator('xpath=ancestor::details');
    if (await group.count() && !await group.getAttribute('open')) { await group.locator('summary').click(); steps?.push('Open navigation group'); }
    if (!await link.isVisible()) {
      const legacyToggle = link.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " admin-nav__group ")][1]').locator('.admin-nav__group-toggle');
      if (await legacyToggle.count()) { await legacyToggle.click(); steps?.push('Open navigation group'); }
    }
  }
  await link.click(); steps?.push('Navigate ' + section);
}
async function attachSteps(testInfo, task, steps, identifierReentries = 0) {
  await testInfo.attach('journey-' + task, { body: JSON.stringify({ task, build: BASELINE_CONTEXT ? 'frozen-189c043d829862ca1e5aa3980b34e760716d9ff2' : 'working-tree', source: 'synthetic agent walkthrough', viewport: testInfo.titlePath.find(value => /\d+px$/.test(value)), steps, countedInteractions: steps.length, identifierReentries, userStudy: false }), contentType: 'application/json' });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) test.describe(`Q3 integrated workflows ${viewport.width}px`, () => {
  test.use({ viewport, timezoneId: 'Europe/Berlin' });

  test('1 user identity, authoritative membership and direct return retain context', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL); const steps = [];
    await open(page, 'users');
    await page.locator('#searchInput').fill(MEMBER.email); steps.push('Enter user search');
    await page.locator('#searchInput').press('Enter'); steps.push('Submit user search');
    if (viewport.width < 600) { await page.locator('.admin-mobile-card__header').filter({ hasText: 'Synthetic Member' }).click(); steps.push('Expand user actions'); }
    const visibleInfo = page.locator('#sectionUsers').getByRole('button', { name: 'Info', exact: true }).filter({ visible: true });
    await visibleInfo.click(); steps.push('Inspect user');
    await expect(page.locator('#userInfoModalBody')).toContainText(MEMBER.email);
    await expect(page.locator('#userInfoModalBody')).toContainText('active');
    await expect(page.locator('#userInfoModalBody')).toContainText('user');
    await page.keyboard.press('Escape'); steps.push('Close user detail');
    await nav(page, 'orgs', steps);
    await page.locator('#orgsList').getByRole('button', { name: 'Inspect', exact: true }).click(); steps.push('Inspect known organization');
    await expect(page.locator('#orgDetail')).toContainText(ORG.name);
    await expect(page.locator('#orgDetail')).toContainText('owner');
    await page.locator('#orgDetail').getByRole('button', { name: MEMBER.email, exact: true }).click(); steps.push('Open exact member identity');
    await expect(page.locator('#userInfoModalBody')).toContainText(MEMBER.email);
    expect(new URL(page.url()).hash).toBe('#users');
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'membership-to-user', steps);
  });

  test('2 pack event exposes receipt versus fulfillment and exact organization credits', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL); const steps = [];
    await open(page, 'billing-events');
    await page.locator('#billingEventsList').getByRole('button', { name: 'Inspect', exact: true }).click(); steps.push('Inspect pack event');
    const detail = page.locator('#billingEventDetail');
    await expect(detail).toContainText('q3-checkout');
    await expect(detail).toContainText('completed');
    await expect(detail).toContainText('5000');
    await expect(detail).toContainText('planned');
    await detail.getByRole('button', { name: 'Inspect organization credits', exact: true }).click(); steps.push('Open event organization credits');
    await expect(page.locator('#orgBillingDetail')).toContainText(ORG.name);
    await expect(page.locator('#orgBillingDetail')).toContainText('5000');
    expect(seen.requests.some(r => r.path === '/api/admin/orgs/q3-org/billing')).toBe(true);
    expect(new URL(page.url()).hash).toBe('#billing'); expect(new URL(page.url()).search).toBe('');
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'event-to-organization-credits', steps);
  });

  test('3 unknown AI outcome connects to exact identity and controls without redispatch', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL); const steps = [];
    await open(page, 'ai-usage');
    await page.locator('#aiAttemptsList').getByRole('button', { name: 'Inspect', exact: true }).click(); steps.push('Inspect unknown attempt');
    const detail = page.locator('#aiAttemptDetail');
    await expect(detail).toContainText('unknown'); await expect(detail).toContainText('reserved');
    await expect(detail).toContainText('synthetic-model');
    await detail.getByRole('button', { name: 'Inspect user', exact: true }).click(); steps.push('Open exact attempt user');
    await expect(page.locator('#userInfoModalBody')).toContainText(MEMBER.email);
    await page.keyboard.press('Escape'); steps.push('Close user detail');
    await nav(page, 'ai-usage', steps);
    await page.locator('#aiAttemptsList').getByRole('button', { name: 'Inspect', exact: true }).click(); steps.push('Reopen known attempt');
    await detail.getByRole('link', { name: 'Open budget controls', exact: true }).click(); steps.push('Open budget controls');
    await expect(page.locator('#aiBudgetSwitchesSummary')).toContainText('Cloudflare master flag enabled AND app switch enabled');
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'attempt-to-user-and-budget', steps);
  });

  test('4 effective budget and master boundary stay clear during synthetic app switch update', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'ai-budget-switches');
    await expect(page.locator('#aiBudgetSwitchesSummary')).toContainText('Cloudflare master flag enabled AND app switch enabled');
    await expect(page.locator('#platformBudgetCapsState')).toContainText('after Cloudflare master and D1 app switches');
    const row = page.locator('#aiBudgetSwitchesList tr').filter({ hasText: 'Admin Text Budget' });
    await expect(row).toContainText('disabled');
    const dialogs = []; page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(dialog.type() === 'prompt' ? 'Synthetic operator app switch change' : undefined); });
    await row.getByRole('button', { name: /Enable/i }).click();
    await expect.poll(() => seen.writes.length).toBe(1);
    await expect(row).toContainText('enabled');
    expect(seen.writes[0].path).toBe('/api/admin/ai/budget-switches/ENABLE_ADMIN_AI_TEXT_BUDGET');
    expect(seen.writes[0].key).toBeTruthy();
    expect(dialogs.join(' ')).toContain('does not change Cloudflare variables');
    expect(seen.unexpected).toEqual([]);
  });

  test('5 R2 second page and detail retain bucket and keyboard selection', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'object-storage');
    await expect(page.locator('#objectStorageTable')).toContainText('first-page.txt');
    await page.getByRole('button', { name: 'Load more', exact: true }).press('Enter');
    await page.getByRole('checkbox', { name: 'Select second-page.txt', exact: true }).check();
    await page.locator('#objectStorageDetailsBtn').press('Enter');
    await expect(page.locator('#objectStorageDetail')).toContainText('second-page.txt');
    await expect(page.locator('#objectStorageDetail')).toContainText('USER_IMAGES');
    expect(seen.requests.some(r => r.path === '/api/admin/r2/objects' && r.query.includes('cursor=q3-next'))).toBe(true);
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });

  test('6 lifecycle plan exposes retention and blocks approval without executing deletion', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'lifecycle');
    await page.locator('[data-lifecycle-request-open="q3-lifecycle"]').click();
    const dialog = page.getByRole('dialog', { name: 'Data Lifecycle Request Detail', exact: true });
    await expect(dialog).toContainText('Blocked plan items require manual review');
    await expect(dialog).toContainText('Billing/credit ledger');
    await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true }).first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-lifecycle-request-open="q3-lifecycle"]')).toBeFocused();
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });

  test('7 metadata and failed evidence reads never become current storage readiness', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL, { storageError: true });
    await open(page, 'tenant-assets');
    const center = page.locator('#tenantAssetCenter');
    await expect(center.getByRole('heading', { name: 'Current storage integrity: not verified' })).toBeVisible();
    await expect(center).toContainText('2026-06-17T00:00:00.000Z');
    await expect(center.locator('[role="alert"]')).toBeVisible();
    await nav(page, 'billing-events');
    await expect(page.locator('#billingEvidencePanel')).toContainText('synthetic_config_only');
    await expect(page.locator('#billingEvidencePanel')).toContainText('blocked');
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });

  test('8 News and Hero edits save and reopen without UTC drift or refresh loss', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'news-feed-agent');
    await page.locator('[data-news-pulse-edit="q3-news"]').click();
    await page.locator('#newsPulseEditTitle').fill('Edited synthetic News');
    await page.locator('#newsPulseEditReason').fill('Synthetic title correction');
    await page.getByRole('button', { name: 'Save item', exact: true }).click();
    await expect.poll(() => seen.writes.length).toBe(1);
    expect(seen.writes[0].body.published_at).toBe('2026-06-17T10:12:34.567Z');
    await nav(page, 'homepage-hero-videos');
    await page.locator('[data-preset-field="maxWidth"]').fill('720');
    await page.locator('[data-field="reason"]').fill('Synthetic Hero preset correction');
    await page.locator('#homepageHeroVideosAdmin').getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
    await page.getByRole('button', { name: 'Save preset', exact: true }).click();
    await expect.poll(() => seen.writes.length).toBe(2);
    await nav(page, 'news-feed-agent');
    await page.locator('[data-news-pulse-edit="q3-news"]').click();
    await expect(page.locator('#newsPulseEditTitle')).toHaveValue('Edited synthetic News');
    await nav(page, 'homepage-hero-videos');
    await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
    expect(seen.writes.map(w => w.path)).toEqual(['/api/admin/news-pulse/items/q3-news', '/api/admin/homepage/hero-videos/preset']);
    expect(seen.unexpected).toEqual([]);
  });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) test.describe(`Q3 context path comparison ${viewport.width}px`, () => {
  test.use({ viewport });
  async function findUserManually(page, steps) {
    await nav(page, 'users', steps);
    await page.locator('#searchInput').fill(MEMBER.email); steps.push('Re-enter known member email');
    await page.locator('#searchInput').press('Enter'); steps.push('Submit user search');
    if (viewport.width < 600) { await page.locator('.admin-mobile-card__header').filter({ hasText: 'Synthetic Member' }).click(); steps.push('Expand user actions'); }
    await page.locator('#sectionUsers').getByRole('button', { name: 'Info', exact: true }).filter({ visible: true }).click(); steps.push('Inspect matched user');
  }
  test('organization membership to user detail', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'orgs');
    await page.locator('#orgsList').getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.locator('#orgDetail')).toContainText(MEMBER.email);
    const steps = [];
    if (BASELINE_CONTEXT) await findUserManually(page, steps);
    else { await page.locator('#orgDetail').getByRole('button', { name: MEMBER.email, exact: true }).click(); steps.push('Open exact member identity'); }
    await expect(page.locator('#userInfoModalBody')).toContainText(MEMBER.email);
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'org-member-to-user', steps, Number(BASELINE_CONTEXT));
  });
  test('organization detail to its credits', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'orgs');
    await page.locator('#orgsList').getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.locator('#orgDetail')).toContainText(ORG.name);
    const steps = [];
    if (BASELINE_CONTEXT) {
      await nav(page, 'billing', steps);
      await page.locator('#orgBillingSearch').fill(ORG.name); steps.push('Re-enter exact known organization name');
      await page.locator('#orgBillingLookupForm').getByRole('button', { name: 'Find Billing', exact: true }).click(); steps.push('Submit organization billing search');
    } else { await page.locator('#orgDetail').getByRole('button', { name: 'Inspect organization credits', exact: true }).click(); steps.push('Open exact organization credits'); }
    await expect(page.locator('#orgBillingDetail')).toContainText(ORG.name);
    await expect(page.locator('#orgBillingDetail')).toContainText('5000');
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'org-detail-to-credits', steps, Number(BASELINE_CONTEXT));
  });
  test('AI attempt to its user identity', async ({ page, baseURL }, testInfo) => {
    const seen = await fixture(page, baseURL);
    await open(page, 'ai-usage');
    await page.locator('#aiAttemptsList').getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.locator('#aiAttemptDetail')).toContainText(MEMBER.id);
    const steps = [];
    // The task brief supplies this member email; no name/ID matching is inferred.
    if (BASELINE_CONTEXT) await findUserManually(page, steps);
    else { await page.locator('#aiAttemptDetail').getByRole('button', { name: 'Inspect user', exact: true }).click(); steps.push('Open exact attempt user'); }
    await expect(page.locator('#userInfoModalBody')).toContainText(MEMBER.email);
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
    await attachSteps(testInfo, 'attempt-to-user', steps, Number(BASELINE_CONTEXT));
  });
  test('pending R2 refresh resumes after leaving without stale completion', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL); let count = 0, held;
    await page.route('**/api/admin/r2/objects?*', async route => {
      count += 1;
      if (count === 2) { held = route; return; }
      await route.fallback();
    });
    await open(page, 'object-storage');
    await expect(page.locator('#objectStorageTable')).toContainText('first-page.txt');
    await page.locator('#objectStorageRefreshBtn').click();
    await expect.poll(() => Boolean(held)).toBe(true);
    await nav(page, 'users');
    await nav(page, 'object-storage');
    await expect(page.locator('#objectStorageTable')).toContainText('first-page.txt');
    await held.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { objects: [r2Object('stale-refresh.txt')], hasMore: false } }) });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#objectStorageTable')).not.toContainText('stale-refresh.txt');
    expect(count).toBe(3); expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });
  test('pending Hero entry reloads on return and ignores the abandoned read', async ({ page, baseURL }) => {
    const seen = await fixture(page, baseURL); let count = 0, held;
    await page.route('**/api/admin/homepage/hero-videos', async route => {
      count += 1;
      if (count === 1) { held = route; return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { slots: [], preset_status: { preset: { maxWidth: 720, fps: 24 } }, feature_status: { features: {} } } }) });
    });
    await open(page, 'homepage-hero-videos');
    await expect.poll(() => Boolean(held)).toBe(true);
    await nav(page, 'users');
    await expect(page.locator('#userTbody tr, #userMobileList .admin-mobile-card').filter({ visible: true }).first()).toBeVisible();
    await nav(page, 'homepage-hero-videos');
    await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
    await held.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { slots: [], preset_status: { preset: { maxWidth: 1080 } }, feature_status: { features: {} } } }) });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('[data-preset-field="maxWidth"]')).toHaveValue('720');
    expect(count).toBe(2); expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });
});

for (const condition of [{ width: 320, scale: 1 }, { width: 390, scale: 1 }, { width: 390, scale: 2 }]) {
  test(`workspace reflow ${condition.width}px and ${condition.scale * 100}% text keeps tasks and table actions reachable`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: condition.width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const seen = await fixture(page, baseURL);
    for (const [route, section] of [['dashboard', 'sectionDashboard'], ['users', 'sectionUsers'], ['object-storage', 'sectionObjectStorage'], ['news-feed-agent', 'sectionNewsFeedAgent'], ['homepage-hero-videos', 'sectionHomepageHeroVideos']]) {
      await open(page, route);
      await expect(page.locator('#' + section)).toHaveAttribute('data-load-state', 'ready');
      if (condition.scale !== 1) await page.evaluate(scale => {
        // Text-only lab approximation. Real device zoom and assistive technology remain separate QA.
        const sizes = [...document.querySelectorAll('body *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)]);
        for (const [el, size] of sizes) if (size) el.style.fontSize = `${size * scale}px`;
      }, condition.scale);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(condition.width + 1);
      if (route === 'users') {
        const search = page.locator('#searchInput'), settings = page.locator('#registrationAvailabilityPanel');
        expect((await search.boundingBox()).y).toBeLessThan((await settings.boundingBox()).y);
        await page.locator('a[href="#registration-settings"]').click();
        await expect(settings).toBeFocused();
        await page.reload(); await expect(settings).toBeFocused();
      }
      if (route === 'homepage-hero-videos') await expect(page.locator('[data-field="upload-aspect-ratio"] option[value="9:16"]')).toHaveText('Portrait (9:16)');
      for (const scroller of await page.locator('.admin-table-wrap').filter({ visible: true }).all()) {
        const overflows = await scroller.evaluate(el => el.scrollWidth > el.clientWidth + 1);
        if (!overflows) continue;
        await expect(scroller).toHaveAttribute('role', 'region');
        expect(await scroller.getAttribute('aria-label')).toBeTruthy();
        await expect(scroller).toHaveAttribute('tabindex', '0');
        await scroller.focus(); await page.keyboard.press('ArrowRight');
        await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      }
    }
    expect(seen.writes).toEqual([]); expect(seen.unexpected).toEqual([]);
  });
}
