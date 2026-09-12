const { test, expect } = require('@playwright/test');

// Browser-only regression suite. Every API response is synthetic; external
// requests are aborted. No Worker imports, credentials, payment/provider calls,
// shell commands, fixture files, or writes outside Playwright's own results.
const MODELS = ['@cf/black-forest-labs/flux-1-schnell', '@cf/black-forest-labs/flux-2-klein-9b'];
const ORGS = [
  { id: 'org_q1_alpha', name: 'Q1 Alpha', role: 'owner', status: 'active' },
  { id: 'org_q1_beta', name: 'Q1 Beta', role: 'owner', status: 'active' },
];
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 980 }, { name: 'narrow', width: 390, height: 844 }];

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function settleResponse(page, predicate, release) {
  const response = page.waitForResponse(predicate);
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fixture(page, { loggedIn = true } = {}) {
  const images = await page.evaluate(() => ['#e02020', '#2040e0'].map((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, 12, 8);
    return canvas.toDataURL('image/png');
  }));
  expect(images[0]).not.toBe(images[1]);
  const state = {
    images, saved: [], generates: [], saves: [], checkouts: [], dashboardRequests: [], memberDashboardRequests: 0,
    onSave: null, onGenerate: null, onDashboard: null, onCheckout: null, onMemberDashboard: null,
    references: true,
  };
  await page.addInitScript(() => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ v: '1', necessary: true, analytics: false, marketing: false }));
    localStorage.removeItem('bitbi.activeOrganizationId');
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    if (path === '/api/me') return json(route, { loggedIn, user: loggedIn ? { id: 'q1-member', email: 'q1@example.invalid', role: 'user' } : null });
    if (path === '/api/ai/quota') return json(route, { data: { creditBalance: 1000 } });
    if (path === '/api/ai/folders') return json(route, { data: { folders: [{ id: 'folder-a', name: 'Folder A' }, { id: 'folder-b', name: 'Folder B' }], counts: {}, unfolderedCount: state.saved.length } });
    if (path === '/api/ai/assets' || path === '/api/ai/images') return json(route, { data: { assets: state.saved, images: state.saved, has_more: false, next_cursor: null } });
    if (path === '/api/orgs') return json(route, { organizations: ORGS });
    if (path === '/api/account/credits-dashboard') {
      state.memberDashboardRequests += 1;
      const result = state.onMemberDashboard ? await state.onMemberDashboard(state.memberDashboardRequests) : null;
      return json(route, result?.body || { dashboard: memberDashboard() }, result?.status || 200);
    }
    if (path === '/api/ai/generate-image') {
      const body = route.request().postDataJSON();
      state.generates.push(body);
      if (state.onGenerate) await state.onGenerate(body);
      const index = body.prompt.includes('Beta') ? 1 : 0;
      return json(route, { data: {
        imageBase64: images[index].split(',')[1], mimeType: 'image/png',
        prompt: body.prompt, model: body.model, steps: index ? 7 : 3, seed: index ? 22 : 11,
        width: index ? 768 : 1024, height: index ? 512 : 1024,
        saveReference: state.references ? `q1-ref-${index}` : undefined,
      }, billing: { balance_after: 990 } });
    }
    if (path === '/api/ai/images/save') {
      const body = route.request().postDataJSON();
      state.saves.push(body);
      const result = state.onSave ? await state.onSave(body, state.saves.length) : null;
      if (result) return json(route, result.body, result.status);
      const index = body.prompt.includes('Beta') ? 1 : 0;
      const asset = { id: `q1-saved-${index}`, title: body.prompt, prompt: body.prompt,
        model: body.model, folder_id: body.folder_id || null, asset_type: 'image',
        media_type: 'image', mime_type: 'image/png', url: images[index], file_url: images[index],
        thumb_url: images[index], medium_url: images[index], created_at: '2026-09-06T00:00:00Z' };
      state.saved = [...state.saved.filter((entry) => entry.id !== asset.id), asset];
      return json(route, { data: asset });
    }
    if (/\/orgs\/[^/]+\/(billing\/credits-dashboard|organization-dashboard)$/.test(path)) {
      const organizationId = path.split('/')[3];
      state.dashboardRequests.push(organizationId);
      const result = state.onDashboard ? await state.onDashboard(organizationId, state.dashboardRequests.length) : null;
      return json(route, result?.body || { dashboard: dashboard(organizationId) }, result?.status || 200);
    }
    if (/\/billing\/checkout\/live-credit-pack$/.test(path)) {
      const request = { organizationId: path.startsWith('/api/account/') ? null : path.split('/')[3], body: route.request().postDataJSON() };
      state.checkouts.push(request);
      const result = state.onCheckout ? await state.onCheckout(request) : null;
      return json(route, result?.body || { error: 'Synthetic checkout unavailable' }, result?.status || 503);
    }
    // Empty ancillary reads keep header/gallery bootstrap local. Unexpected
    // mutations fail closed and cannot contact a real API.
    if (route.request().method() !== 'GET') return json(route, { error: 'Unexpected synthetic mutation' }, 400);
    return json(route, { data: { items: [], assets: [], images: [], videos: [], tracks: [] }, items: [], assets: [] });
  });
  return state;
}

function dashboard(id, balance = id === ORGS[0].id ? 111 : 222) {
  const org = ORGS.find((entry) => entry.id === id);
  return {
    organization: { id, name: org.name, accessScope: 'org_owner' },
    access: { platformAdmin: false, organizationRole: 'owner', canUseAdminImageTests: false },
    balance: { current: balance, available: balance, reserved: 0 },
    liveCheckout: { enabled: true, configured: true, mode: 'live' },
    packs: [{ id: `pack-${id}`, credits: balance, displayPrice: id === ORGS[0].id ? '1.11 EUR' : '2.22 EUR' }],
    purchaseHistory: [], recentLedger: [], recentAdminImageTestDebits: [], members: [], warnings: [],
  };
}

function memberDashboard({ pendingReturn = false } = {}) {
  return {
    account: { userId: 'q1-member', role: 'user', status: 'active' },
    balance: { totalCredits: 444, purchasedCredits: 444, subscriptionCredits: 0, legacyOrBonusCredits: 0 },
    liveCheckout: { enabled: true, configured: true, mode: 'live' },
    packs: [{ id: 'q1-member-pack', credits: 100, displayPrice: '1.00 EUR' }],
    purchaseHistory: pendingReturn ? [{ id: 'q1-prior-checkout', checkoutScope: 'member', providerMode: 'live',
      status: 'created', ledgerEntryId: null, credits: 100, amountCents: 100, currency: 'EUR', createdAt: '2026-09-06T00:00:00Z' }] : [],
    transactions: [], subscriptionStatus: 'none', hasActiveSubscription: false,
    canCancelSubscription: false, canReactivateSubscription: false,
  };
}

function controls(page, surface) {
  const lab = surface === 'lab';
  return {
    prompt: page.locator(lab ? '#labPrompt' : '#galStudioPrompt'),
    generate: page.locator(lab ? '#labGenerate' : '#galStudioGenerate'),
    model: page.locator(lab ? '#labImageModel' : '#galStudioModel'),
    folder: page.locator(lab ? '#labFolderSelect' : '#galStudioFolderSelect'),
    image: page.locator(lab ? '#labResultStage .generate-lab__image-output' : '#galStudioPreview img'),
    save: page.locator(lab ? '#labResultStage .generate-lab__result-actions button' : '#galStudioSaveBtn'),
    message: page.locator(lab ? '#labMessage' : '#galStudioGenMsg'),
  };
}

async function openSurface(page, surface, locale) {
  const prefix = locale === 'de' ? '/de' : '';
  await page.goto(surface === 'lab' ? `${prefix}/generate-lab/` : `${prefix}/`);
  if (surface === 'home') {
    const desktopLink = page.locator('#navbar [data-category-link="gallery"]');
    if (await desktopLink.isVisible()) await desktopLink.click();
    else await page.locator('#gallery').scrollIntoViewIfNeeded();
    await page.locator('#galleryCreateTab').click();
    await expect(page.locator('#galleryStudio')).toBeVisible();
  }
  await expect(controls(page, surface).generate).toBeEnabled();
}

async function generate(page, surface, state, index) {
  const ui = controls(page, surface);
  await ui.model.selectOption(MODELS[index]);
  await ui.prompt.fill(index ? 'Beta blue river' : 'Alpha red forest');
  await ui.generate.click();
  await expect(ui.image).toHaveAttribute('src', state.images[index]);
  await ui.folder.selectOption(index ? 'folder-b' : 'folder-a');
  await expect(ui.save).toBeEnabled();
}

function expectSave(body, index, { reference = true } = {}) {
  expect(body).toMatchObject({ prompt: index ? 'Beta blue river' : 'Alpha red forest',
    model: MODELS[index], steps: index ? 7 : 3, seed: index ? 22 : 11,
    folder_id: index ? 'folder-b' : 'folder-a' });
  if (reference) expect(body.save_reference).toBe(`q1-ref-${index}`);
  else expect(body).not.toHaveProperty('save_reference');
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const locale of ['en', 'de']) {
  for (const viewport of VIEWPORTS) {
    test.describe(`OMA2 Q1 member ${locale} ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const surface of ['home', 'lab']) {
        // Generate Lab deliberately offers a navigation fallback below 900px;
        // its hidden desktop controls are not a supported mobile workflow.
        if (surface === 'lab' && viewport.width < 900) continue;
        for (const scenario of ['delayed-success', 'fallback-success', 'failed-retry']) {
          test(`P03 ${surface}: ${scenario}, double click and immutable Alpha completion while Beta is current`, async ({ page }) => {
            const state = await fixture(page);
            const held = gate();
            state.onSave = async (_body, attempt) => {
              if (attempt !== 1) return null;
              await held.promise;
              if (scenario === 'fallback-success') return { status: 400, body: { error: 'Synthetic expired reference', code: 'SAVE_REFERENCE_EXPIRED' } };
              if (scenario === 'failed-retry') return { status: 503, body: { error: 'Synthetic Alpha save unavailable' } };
              return null;
            };
            await openSurface(page, surface, locale);
            await generate(page, surface, state, 0);
            const ui = controls(page, surface);
            await ui.save.click();
            // Dispatch checks the handler guard as well as the disabled control.
            await ui.save.dispatchEvent('click');
            await expect.poll(() => state.saves.length).toBe(1);
            await expect(ui.save).toBeDisabled();
            await generate(page, surface, state, 1);
            await ui.prompt.focus();
            await settleResponse(page, (response) => response.url().endsWith('/api/ai/images/save'), held.release);
            if (scenario === 'failed-retry') {
              const retry = page.locator('[data-image-save-notice] button');
              await expect(retry).toHaveText(locale === 'de' ? 'Dieses Bild erneut speichern' : 'Retry saving this image');
              await expect(page.locator('[data-image-save-notice] img')).toHaveAttribute('src', state.images[0]);
              await expect(page.locator('[data-image-save-notice]')).toContainText('Folder A');
              await expect(ui.prompt).toBeFocused();
              await retry.focus();
              await page.keyboard.press('Enter');
              await expect.poll(() => state.saves.length).toBe(2);
              await expect(page.locator('[data-image-save-state="saved"]')).toContainText('Alpha red forest');
            } else {
              await expect(page.locator('[data-image-save-state="saved"]')).toContainText('Alpha red forest');
              await expect(ui.prompt).toBeFocused();
            }
            await expect(ui.image).toHaveAttribute('src', state.images[1]);
            await expect(ui.save).toBeEnabled();
            await expect(ui.message).not.toContainText('Alpha');
            expectSave(state.saves[0], 0);
            if (scenario === 'fallback-success') {
              expect(state.saves).toHaveLength(2);
              expectSave(state.saves[1], 0, { reference: false });
              expect(state.saves[1].imageData).toBe(state.images[0]);
            }
            if (scenario === 'failed-retry') expectSave(state.saves[1], 0);
            const beforeBeta = state.saves.length;
            await ui.save.click();
            await expect.poll(() => state.saves.length).toBe(beforeBeta + 1);
            expectSave(state.saves.at(-1), 1);
            expect(state.saves.at(-1)).not.toHaveProperty('imageData');
            await expect(ui.message).toContainText(locale === 'de' ? 'Bild gespeichert' : 'Image saved');
            await noHorizontalOverflow(page);
          });
        }

        test(`P03 ${surface}: pending generation guard, normal data save, failure retry and reopen`, async ({ page }) => {
          const state = await fixture(page);
          state.references = false;
          const held = gate();
          state.onGenerate = () => held.promise;
          state.onSave = async (_body, attempt) => attempt === 1
            ? { status: 503, body: { error: 'Synthetic temporary save failure' } } : null;
          await openSurface(page, surface, locale);
          const ui = controls(page, surface);
          await ui.model.selectOption(MODELS[0]);
          await ui.prompt.fill('Alpha red forest');
          await ui.generate.click();
          await ui.generate.dispatchEvent('click');
          await ui.prompt.press('Control+Enter');
          await expect.poll(() => state.generates.length).toBe(1);
          await expect(ui.generate).toBeDisabled();
          await settleResponse(page, (response) => response.url().endsWith('/api/ai/generate-image'), held.release);
          await expect(ui.image).toHaveAttribute('src', state.images[0]);
          await ui.folder.selectOption('folder-a');
          await ui.save.click();
          await expect(ui.message).toContainText('Synthetic temporary save failure');
          await expect(ui.save).toBeEnabled();
          // Retrying must keep the original folder even if the picker changes.
          await ui.folder.selectOption('folder-b');
          await expect(ui.message).toContainText(`${locale === 'de' ? 'Ordner' : 'Folder'}: Folder A`);
          await ui.save.focus();
          await page.keyboard.press('Enter');
          await expect.poll(() => state.saves.length).toBe(2);
          for (const body of state.saves) {
            expectSave(body, 0, { reference: false });
            expect(body.imageData).toBe(state.images[0]);
          }
          await expect(ui.message).toContainText(locale === 'de' ? 'Bild gespeichert' : 'Image saved');
          if (surface === 'lab') {
            const recent = page.locator('#labRecentAssets [data-asset-id="q1-saved-0"]');
            await expect(recent).toBeVisible();
            await recent.click();
            await expect(page.locator('#labResultStage img')).toHaveAttribute('src', state.images[0]);
            await expect(page.locator('#labResultStage .generate-lab__result-actions button')).toHaveCount(0);
          } else {
            await page.locator('#galleryExploreTab').click();
            await expect(page.locator('#galleryStudio')).toBeHidden();
            await page.locator('#galleryCreateTab').click();
            await expect(ui.image).toHaveAttribute('src', state.images[0]);
            await expect(page.locator('#galStudioSaveBar')).not.toHaveClass(/visible/);
          }
          expect(state.saves).toHaveLength(2);
          await noHorizontalOverflow(page);
        });
      }

      if (viewport.width >= 900) test('P03 lab: delayed Alpha save cannot change reopened Beta asset', async ({ page }) => {
        const state = await fixture(page);
        state.saved = [{ id: 'q1-existing-beta', title: 'Saved Beta', asset_type: 'image',
          mime_type: 'image/png', file_url: state.images[1], medium_url: state.images[1], thumb_url: state.images[1] }];
        const held = gate();
        state.onSave = async () => { await held.promise; return null; };
        await openSurface(page, 'lab', locale);
        await generate(page, 'lab', state, 0);
        await controls(page, 'lab').save.click();
        await expect.poll(() => state.saves.length).toBe(1);
        await page.locator('#labRecentAssets [data-asset-id="q1-existing-beta"]').click();
        await expect(page.locator('#labResultStage img')).toHaveAttribute('src', state.images[1]);
        const priorMessage = await controls(page, 'lab').message.textContent();
        await settleResponse(page, (response) => response.url().endsWith('/api/ai/images/save'), held.release);
        await expect(page.locator('[data-image-save-state="saved"]')).toContainText('Alpha red forest');
        await expect(page.locator('#labResultStage img')).toHaveAttribute('src', state.images[1]);
        await expect(controls(page, 'lab').message).toHaveText(priorMessage);
        await expect(controls(page, 'lab').save).toHaveCount(0);
        expectSave(state.saves[0], 0);
      });

      if (viewport.width < 900) test('P03 lab: narrow desktop fallback preserves localized navigation and keyboard activation', async ({ page }) => {
        const state = await fixture(page);
        const prefix = locale === 'de' ? '/de' : '';
        await page.goto(`${prefix}/generate-lab/`);
        const fallback = page.locator('.generate-lab__mobile-fallback');
        await expect(fallback).toBeVisible();
        await expect(page.locator('.generate-lab__desktop')).toBeHidden();
        await expect(fallback.getByRole('heading')).toContainText(locale === 'de' ? 'Desktop' : 'desktop');
        const links = fallback.getByRole('link');
        await expect(links).toHaveCount(3);
        await expect(links.nth(0)).toHaveAttribute('href', `${prefix}/`);
        await expect(links.nth(1)).toHaveAttribute('href', `${prefix}/account/assets-manager.html?source=generate-lab-mobile`);
        await expect(links.nth(2)).toHaveAttribute('href', `${prefix}/account/credits.html?source=generate-lab-mobile`);
        await noHorizontalOverflow(page);
        await links.nth(2).focus();
        await expect(links.nth(2)).toBeFocused();
        const requestedUrl = new URL(await links.nth(2).getAttribute('href'), page.url());
        const navigation = page.waitForRequest((request) => request.isNavigationRequest()
          && request.resourceType() === 'document' && request.url() === requestedUrl.href);
        await page.keyboard.press('Enter');
        expect((await navigation).url()).toBe(requestedUrl.href);
        // Standard serve redirects .html to a clean URL and may drop its query.
        // The exact request above proves the product link preserved its source;
        // the final destination checks navigation/locale without treating that
        // development-server behavior as a product fix or source consumption.
        await expect(page).toHaveURL((url) => url.origin === requestedUrl.origin
          && [`${prefix}/account/credits`, `${prefix}/account/credits.html`].includes(url.pathname));
        expect(state.generates).toHaveLength(0);
        expect(state.saves).toHaveLength(0);
      });

      for (const surface of ['credits', 'organization']) {
        for (const failure of ['503', '403', '404', 'empty', 'mismatched-org']) {
          test(`P08 ${surface}: current ${failure} fails closed and recovers after reload`, async ({ page }) => {
            const state = await fixture(page);
            state.onDashboard = async () => {
              if (failure === 'empty') return { status: 200, body: { dashboard: null } };
              if (failure === 'mismatched-org') return { status: 200, body: { dashboard: dashboard(ORGS[1].id) } };
              return { status: Number(failure), body: { error: `Synthetic current ${failure}` } };
            };
            const route = `${locale === 'de' ? '/de' : ''}/account/${surface}.html`;
            await page.goto(route);
            const picker = page.locator(surface === 'credits' ? '#creditsOrgPicker' : '#organizationPicker');
            await picker.selectOption(ORGS[0].id);
            const denied = failure === '403' || failure === '404';
            await expect(page.locator(`#${surface}${denied ? 'Denied' : 'Error'}`)).toBeVisible();
            await expect(page.locator(`#${surface}Loading`)).toBeHidden();
            await expect(page.locator(`#${surface}Dashboard`)).toBeHidden();
            if (surface === 'credits') await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);
            expect(state.checkouts).toHaveLength(0);
            // Reload uses the same synthetic signed-in user and a repaired
            // dashboard response; no auth/session/permission bypass is mocked.
            state.onDashboard = null;
            await page.reload();
            await picker.selectOption(ORGS[0].id);
            const name = page.locator(surface === 'credits' ? '#creditsOrgName' : '#organizationName');
            await expect(name).toHaveText(ORGS[0].name);
            await expect(page.locator(`#${surface}SummaryGrid`)).toContainText('111');
            await expect(page.locator(`#${surface}Error`)).toBeHidden();
            await expect(page.locator(`#${surface}Denied`)).toBeHidden();
            await expect(page.locator(`#${surface}Dashboard`)).toBeVisible();
            if (surface === 'credits') {
              await expect(page.locator('[data-checkout-pack]')).toBeEnabled();
              await expect(page.locator('[data-checkout-pack]')).toHaveAttribute('data-checkout-pack', `pack-${ORGS[0].id}`);
              await expect(page.locator('#creditsTermsAccepted')).not.toBeChecked();
              await expect(page.locator('#creditsImmediateDeliveryAccepted')).not.toBeChecked();
            }
          });
        }

        for (const staleStatus of [200, 403, 503]) {
          test(`P08 ${surface}: stale Alpha ${staleStatus} cannot replace confirmed Beta or its actions`, async ({ page }) => {
            const state = await fixture(page);
            const held = gate();
            state.onDashboard = async (id) => {
              if (id !== ORGS[0].id) return null;
              await held.promise;
              return staleStatus === 200 ? { status: 200, body: { dashboard: dashboard(id) } }
                : { status: staleStatus, body: { error: 'Synthetic stale Alpha failure' } };
            };
            const prefix = locale === 'de' ? '/de' : '';
            await page.goto(`${prefix}/account/${surface}.html`);
            const picker = page.locator(surface === 'credits' ? '#creditsOrgPicker' : '#organizationPicker');
            const name = page.locator(surface === 'credits' ? '#creditsOrgName' : '#organizationName');
            const summary = page.locator(`#${surface}SummaryGrid`);
            await picker.selectOption(ORGS[0].id);
            await expect.poll(() => state.dashboardRequests.includes(ORGS[0].id)).toBe(true);
            await expect(page.locator(`#${surface}Dashboard`)).toHaveAttribute('aria-busy', 'true');
            if (surface === 'credits') await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);
            await picker.selectOption(ORGS[1].id);
            await expect(name).toHaveText(ORGS[1].name);
            await expect(summary).toContainText('222');
            await settleResponse(page, (response) => response.url().includes(`/api/orgs/${ORGS[0].id}/`), held.release);
            await expect(picker).toHaveValue(ORGS[1].id);
            await expect(name).toHaveText(ORGS[1].name);
            await expect(summary).toContainText('222');
            await expect(summary).not.toContainText('111');
            await expect(page.locator(`#${surface}Error`)).toBeHidden();
            await expect(page.locator(`#${surface}Denied`)).toBeHidden();
            if (surface === 'credits') {
              const checkout = page.locator('[data-checkout-pack]');
              await expect(checkout).toHaveAttribute('data-checkout-pack', `pack-${ORGS[1].id}`);
              await page.locator('#creditsTermsAccepted').check();
              await page.locator('#creditsImmediateDeliveryAccepted').check();
              await checkout.focus();
              await page.keyboard.press('Enter');
              await expect.poll(() => state.checkouts.length).toBe(1);
              expect(state.checkouts[0]).toMatchObject({ organizationId: ORGS[1].id, body: { pack_id: `pack-${ORGS[1].id}` } });
              await expect(name).toHaveText(ORGS[1].name);
            }
            await noHorizontalOverflow(page);
          });
        }

        test(`P08 ${surface}: same-organization generations and clearing selection reject earlier responses`, async ({ page }) => {
          const state = await fixture(page);
          const firstAlpha = gate();
          let alphaLoads = 0;
          state.onDashboard = async (id) => {
            if (id !== ORGS[0].id) return null;
            alphaLoads += 1;
            if (alphaLoads === 1) { await firstAlpha.promise; return { body: { dashboard: dashboard(id, 111) } }; }
            return { body: { dashboard: dashboard(id, 333) } };
          };
          await page.goto(`${locale === 'de' ? '/de' : ''}/account/${surface}.html`);
          const picker = page.locator(surface === 'credits' ? '#creditsOrgPicker' : '#organizationPicker');
          await picker.selectOption(ORGS[0].id);
          await expect.poll(() => alphaLoads).toBe(1);
          await picker.selectOption(ORGS[1].id);
          await expect(page.locator(`#${surface}SummaryGrid`)).toContainText('222');
          await picker.selectOption(ORGS[0].id);
          await expect(page.locator(`#${surface}SummaryGrid`)).toContainText('333');
          await settleResponse(page, (response) => response.url().includes(`/api/orgs/${ORGS[0].id}/`), firstAlpha.release);
          await expect(page.locator(`#${surface}SummaryGrid`)).toContainText('333');
          const cleared = gate();
          state.onDashboard = async (id) => { await cleared.promise; return { body: { dashboard: dashboard(id) } }; };
          await picker.selectOption(ORGS[1].id);
          await expect(page.locator(`#${surface}Dashboard`)).toHaveAttribute('aria-busy', 'true');
          await picker.selectOption('');
          await settleResponse(page, (response) => response.url().includes(`/api/orgs/${ORGS[1].id}/`), cleared.release);
          await expect(picker).toHaveValue('');
          await expect(page.locator(`#${surface}SummaryGrid`)).not.toContainText('222');
          if (surface === 'credits') await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);
        });
      }

      test('P08 credits: changing organization clears old checkout controls and ignores an old checkout response', async ({ page }) => {
        const state = await fixture(page);
        const checkoutGate = gate();
        state.onCheckout = async () => {
          await checkoutGate.promise;
          return { status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/q1-synthetic-only' } };
        };
        await page.goto(`${locale === 'de' ? '/de' : ''}/account/credits.html`);
        const picker = page.locator('#creditsOrgPicker');
        await picker.selectOption(ORGS[0].id);
        await expect(page.locator('#creditsSummaryGrid')).toContainText('111');
        await page.locator('#creditsTermsAccepted').check();
        await page.locator('#creditsImmediateDeliveryAccepted').check();
        await page.locator('[data-checkout-pack]').click();
        await expect.poll(() => state.checkouts.length).toBe(1);
        const betaGate = gate();
        state.onDashboard = async (id) => { await betaGate.promise; return { body: { dashboard: dashboard(id) } }; };
        await picker.selectOption(ORGS[1].id);
        await expect(page.locator('[data-checkout-pack]')).toHaveCount(0);
        await settleResponse(page, (response) => response.url().includes('/billing/checkout/live-credit-pack'), checkoutGate.release);
        await expect(page).toHaveURL(/\/account\/credits(?:\.html)?$/);
        await settleResponse(page, (response) => response.url().includes(`/api/orgs/${ORGS[1].id}/`), betaGate.release);
        await expect(page.locator('#creditsSummaryGrid')).toContainText('222');
        await expect(page.locator('#creditsTermsAccepted')).not.toBeChecked();
        await expect(page.locator('#creditsImmediateDeliveryAccepted')).not.toBeChecked();
        expect(state.checkouts).toHaveLength(1);
        expect(state.checkouts[0].organizationId).toBe(ORGS[0].id);
      });

      for (const checkoutStatus of [200, 503]) {
        test(`P08 member: real return-purchase poll preserves pending checkout and accepts its ${checkoutStatus} response`, async ({ page }) => {
          const state = await fixture(page);
          const checkoutGate = gate();
          state.onMemberDashboard = async (count) => ({ body: { dashboard: memberDashboard({ pendingReturn: count === 1 }) } });
          state.onCheckout = async () => {
            await checkoutGate.promise;
            return checkoutStatus === 200
              ? { status: 200, body: { checkout_url: 'https://checkout.stripe.com/c/pay/q1-synthetic-only' } }
              : { status: 503, body: { error: 'Synthetic pending checkout unavailable' } };
          };
          // Exact synthetic navigation response, fulfilled entirely by
          // Playwright. No request is forwarded to the payment host.
          await page.route('https://checkout.stripe.com/c/pay/q1-synthetic-only', (route) => route.fulfill({
            status: 200, contentType: 'text/html', body: '<h1>Q1 synthetic checkout accepted</h1>',
          }));
          // Avoid serve's .html -> clean URL redirect dropping query parameters.
          // This clean path serves the same static HTML and preserves both inputs.
          await page.goto(`${locale === 'de' ? '/de' : ''}/account/credits?scope=member&checkout=success`);
          await expect(page.locator('#creditsSummaryGrid')).toContainText('444');
          await page.locator('#creditsTermsAccepted').check();
          await page.locator('#creditsImmediateDeliveryAccepted').check();
          await page.locator('[data-checkout-pack]').click();
          await expect.poll(() => state.checkouts.length).toBe(1);
          // Establish that the checkout preceded the real 3000ms timer.
          expect(state.memberDashboardRequests).toBe(1);
          await expect(page.locator('[data-checkout-pack]')).toBeDisabled();
          await expect.poll(() => state.memberDashboardRequests, { timeout: 10000 }).toBe(2);
          await expect(page.locator('#creditsConfigNote')).toBeHidden();
          await expect(page.locator('[data-checkout-pack]')).toBeDisabled();
          await page.locator('[data-checkout-pack]').dispatchEvent('click');
          expect(state.checkouts).toHaveLength(1);
          const response = page.waitForResponse((entry) => entry.url().endsWith('/api/account/billing/checkout/live-credit-pack'));
          checkoutGate.release();
          await (await response).finished();
          if (checkoutStatus === 200) {
            await expect(page.getByRole('heading', { name: 'Q1 synthetic checkout accepted' })).toBeVisible();
          } else {
            await expect(page.locator('[data-checkout-pack]')).toBeEnabled();
            await expect(page.locator('#creditsSummaryGrid')).toContainText('444');
            await expect(page).toHaveURL(/\/account\/credits(?:\.html)?\?scope=member&checkout=success$/);
            state.onCheckout = null;
            await page.locator('[data-checkout-pack]').click();
            await expect.poll(() => state.checkouts.length).toBe(2);
          }
          expect(state.checkouts[0]).toMatchObject({ organizationId: null, body: { pack_id: 'q1-member-pack' } });
        });
      }
    });
  }
}

// Native queue/D1/R2 completion is exercised by member-generation.cases.js through workers.spec.js and
// the normal isolated runtime entry. These cases verify the connected UI only.
for (const language of ['en', 'de']) {
  test(`durable generation ${language}: accepted image is already saved without a browser save request`, async ({page}) => {
    await page.setViewportSize({width:1440,height:980});
    const state=await fixture(page);
    const id='1234567890abcdef1234567890abcdef';
    let accepted=0, reads=0;
    await page.route('**/api/ai/generate-image',async route=>{
      expect(route.request().headers().prefer).toBe('respond-async');accepted++;
      await json(route,{ok:true,data:{job:{id,status:'queued'}}},202);
    });
    await page.route(`**/api/ai/generation-jobs/${id}`,async route=>{
      reads++;
      await json(route,{ok:true,data:{job:{id,status:'succeeded'},result:{ok:true,data:{
        imageBase64:state.images[0].split(',')[1],mimeType:'image/png',prompt:'Alpha red forest',model:MODELS[0],
        asset:{id,title:'Alpha red forest',file_url:state.images[0]},
      }}}});
    });
    await openSurface(page,'lab',language);
    const ui=controls(page,'lab');await ui.prompt.fill('Alpha red forest');await ui.generate.click();
    await expect(ui.image).toHaveAttribute('src',state.images[0]);
    await expect(ui.message).toContainText(language==='de'?'gespeichert':'saved');
    expect(accepted).toBe(1);expect(reads).toBe(1);expect(state.saves).toHaveLength(0);
    expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('bitbi-generation:')))).toEqual([]);
    await noHorizontalOverflow(page);
  });

  test(`durable generation ${language}: restored jobs, preview pending and failed status stay read-only`,async({page})=>{
    await fixture(page);
    const jobs=[{id:'a'.repeat(32),status:'preview_pending',created_at:'2026-09-12T00:00:00Z'},
      {id:'b'.repeat(32),status:'outcome_unknown',created_at:'2026-09-12T00:00:00Z',error_code:'generation_provider_outcome_unknown'}];
    const mutations=[];
    page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')mutations.push(request.method());});
    await page.route('**/api/ai/generation-jobs',route=>json(route,{ok:true,data:{jobs,limit:50}}));
    await page.goto(language==='de'?'/de/account/assets-manager.html':'/account/assets-manager.html');
    const panel=page.locator('#studioSavedAssetsCard [data-generation-jobs]');
    await panel.locator('summary').focus();await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('open','');
    await expect(panel).toContainText(language==='de'?'Vorschau':'preview');
    await expect(panel).toContainText('generation_provider_outcome_unknown');
    await page.setViewportSize({width:390,height:844});await noHorizontalOverflow(page);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(panel).toHaveCount(0);
    expect(mutations).toEqual([]);
  });
}

test('durable generation: a lost acceptance response survives reload with only an opaque intent',async({page})=>{
  await fixture(page);
  const keys=[];let complete=false;
  const id='c'.repeat(32);
  await page.route('**/api/ai/generate-video',async route=>{
    keys.push(route.request().headers()['idempotency-key']);
    if(!complete)return route.abort('connectionreset');
    return json(route,{ok:true,data:{job:{id,status:'queued'}}},202);
  });
  await page.route(`**/api/ai/generation-jobs/${id}`,route=>json(route,{ok:true,data:{job:{id,status:'preview_pending'},result:{ok:true,data:{videoUrl:'/api/ai/text-assets/'+id+'/file',asset:{id}}}}}));
  await page.goto('/');
  const invoke=()=>page.evaluate(async()=>{
    const {apiAiGenerateVideo}=await import('/js/shared/auth-api.js');
    return apiAiGenerateVideo({prompt:'Private synthetic prompt'},{durable:true});
  });
  expect((await invoke()).ok).toBe(false);
  const stored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('bitbi-generation:'))));
  expect(Object.keys(stored)).toHaveLength(1);expect(JSON.stringify(stored)).not.toContain('Private synthetic prompt');
  complete=true;await page.reload();
  const result=await invoke();expect(result.ok).toBe(true);expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);
  expect(result.data.data.generationJob.status).toBe('preview_pending');
});

test('durable generation: explicit preview retry never submits new generation',async({page})=>{
  await fixture(page);let retried=false;const writes=[];
  const id='d'.repeat(32);
  page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')writes.push(new URL(request.url()).pathname);});
  await page.route('**/api/ai/generation-jobs',route=>json(route,{ok:true,data:{jobs:[{id,status:'preview_pending',error_code:retried?null:'preview_retry_exhausted',created_at:'2026-09-12T00:00:00Z'}]}}));
  await page.route(`**/api/ai/generation-jobs/${id}/retry-preview`,route=>{retried=true;return json(route,{ok:true},202);});
  await page.goto('/account/assets-manager.html');
  const root=page.locator('#studioSavedAssetsCard [data-generation-jobs]');await root.locator('summary').click();
  await root.getByRole('button',{name:'Retry preview only'}).click();
  await expect(root.getByRole('button')).toHaveCount(0);await expect(root.locator('summary')).toBeFocused();
  expect(writes).toEqual([`/api/ai/generation-jobs/${id}/retry-preview`]);
});
