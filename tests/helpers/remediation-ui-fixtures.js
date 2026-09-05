const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Local fixtures only. No authentication, generation, wallet or billing request
// in this suite is sent to a production service.
const IMAGE = fs.readFileSync(path.join(__dirname, '../fixtures/media/favorite-thumb.jpg'));
const MODES = [
  { name: 'Gallery', category: 'gallery', attr: 'data-mode', explore: 'galleryExplore', create: 'galleryStudio', module: '/js/pages/index/studio.js' },
  { name: 'Video', category: 'video', attr: 'data-video-mode', explore: 'videoExplore', create: 'videoCreate', module: '/js/pages/index/video-create.js' },
  { name: 'Sound Lab', category: 'sound', attr: 'data-sound-mode', explore: 'soundLabExplore', create: 'soundLabCreate', module: '/js/pages/index/soundlab-create.js' },
];

async function fixture(page, { member = false } = {}) {
  const mutations = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('bitbi_cookie_consent', JSON.stringify({ necessary: true, analytics: false, marketing: false, timestamp: Date.now() })));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() !== 'GET') {
        mutations.push(`${request.method()} ${url.pathname}`);
        return json({ ok: false, error: 'Unexpected mutation in local fixture' }, 400);
      }
      if (url.pathname === '/api/me') return json({ loggedIn: member, user: member ? { id: 'keyboard-fixture', email: 'keyboard@example.invalid', role: 'user' } : null });
      if (url.pathname === '/api/homepage/hero-videos') return json({ ok: true, data: { configured: false, slots: [] } });
      if (url.pathname === '/api/public/news-pulse') return json({ ok: true, data: { items: [] } });
      if (/^\/api\/gallery\/(mempics|memvids|memtracks)$/.test(url.pathname)) {
        const items = url.pathname.endsWith('/mempics') ? [{
          id: 'keyboard-picture', slug: 'keyboard-picture', title: 'Keyboard fixture', category: 'mempics', caption: 'Disposable local media fixture',
          thumb: { url: '/api/gallery/mempics/keyboard-picture/thumb', w: 320, h: 320 },
          preview: { url: '/api/gallery/mempics/keyboard-picture/medium', w: 640, h: 640 },
          full: { url: '/api/gallery/mempics/keyboard-picture/file' },
        }] : [];
        return json({ ok: true, data: { items, has_more: false, next_cursor: null } });
      }
      if (/^\/api\/gallery\/mempics\/keyboard-picture\/(thumb|medium|file)$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: IMAGE });
      if (/credits|quota|usage/.test(url.pathname)) return json({ ok: true, data: { balance: 100, available: 100, remaining: 100 }, balance: 100 });
      return json({ ok: true, data: { items: [], comments: [], has_more: false, next_cursor: null } });
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return route.abort('blockedbyclient');
    return route.continue();
  });
  return { mutations, errors };
}

async function home(page, locale, options) {
  const state = await fixture(page, options);
  await page.goto(locale === 'de' ? '/de/' : '/');
  await expect(page.locator('.auth-modal__overlay')).toBeAttached();
  const consent = page.locator('#ckRejectAll');
  if (await consent.isVisible()) await consent.click();
  return state;
}

async function openAuth(page, tab = 'login') {
  // Use the exact existing import URL: a query variant creates a second module.
  await page.evaluate(async tab => (await import('/js/shared/auth-modal.js')).openAuthModal(tab), tab);
  await expect(page.locator('.auth-modal__overlay')).toHaveClass(/active/);
}

async function selectCategory(page, mode) {
  await page.locator(`#navbar [data-category-link="${mode.category}"]`).click();
  await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', mode.category);
  await expect(page.locator(`[${mode.attr}="explore"]`)).toBeVisible();
}

module.exports = { test, expect, MODES, fixture, home, openAuth, selectCategory };
