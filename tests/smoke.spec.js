const { test, expect } = require('@playwright/test');

const MODELS_OVERLAY_PATHS = [
  '/legal/privacy.html',
  '/legal/imprint.html',
  '/legal/datenschutz.html',
  '/account/profile.html',
  '/account/image-studio.html',
  '/admin/index.html',
];

async function expectPathUnchanged(page, expectedPath) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.hash}`;
  }).toBe(expectedPath);
}

async function expectModelsOverlayOpenState(page) {
  const overlay = page.locator('.models-overlay');

  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveClass(/is-active/);
  await expect(overlay).toContainText('Text Generation');
  await expect(overlay).toContainText('Image Generation');
  await expect(overlay).toContainText('Video');
  await expect(overlay).toContainText('Pixverse V6');
}

// ---------------------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------------------

test.describe('Homepage', () => {
  test('loads successfully with correct title', async ({ page }) => {
    const response = await page.goto('/');
    expect(response.status()).toBe(200);
    await expect(page).toHaveTitle(/BITBI/);
  });

  test('navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('#navbar .site-nav__links');

    await expect(nav.getByRole('link', { name: 'Gallery' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sound Lab' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Models' })).toBeVisible();
  });

  test('MODELS opens the homepage models overlay from the top navigation without navigation', async ({ page }) => {
    await page.goto('/');

    const modelsButton = page.locator('#navbar .site-nav__links').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page);

    await page.getByRole('button', { name: 'Close models' }).click();
    await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
    await expectPathUnchanged(page, '/');
  });

  test('MODELS opens the homepage models overlay from the mobile navigation without navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Toggle menu' }).click();

    const modelsButton = page.locator('#mobileNav').getByRole('button', { name: 'Models' });
    await modelsButton.click();

    await expectPathUnchanged(page, '/');
    await expectModelsOverlayOpenState(page);
  });

  test('hero section renders', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('#hero');
    const heroVideo = hero.locator('[data-hero-video]');

    await expect(hero).toBeVisible();
    await expect(heroVideo).toBeVisible();
    await expect(heroVideo).not.toHaveAttribute('controls', /./);
    await expect(heroVideo).not.toHaveAttribute('poster', /./);
    await expect
      .poll(() => heroVideo.evaluate((el) => el.classList.contains('is-active')))
      .toBe(true);
    await expect(hero.getByText('My Digital Playground')).toHaveCount(0);
    await expect(hero.getByRole('link', { name: 'Creation Lab' })).toBeVisible();
  });

  test('hero falls back cleanly in reduced motion mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const hero = page.locator('#hero');
    const heroVideo = hero.locator('[data-hero-video]');

    await expect(hero).toBeVisible();
    await expect(heroVideo).toBeHidden();
    await expect(hero.getByRole('link', { name: 'Creation Lab' })).toBeVisible();
  });

  test('hero uses the mobile background video asset on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect
      .poll(() => page.locator('[data-hero-video]').evaluate((el) => el.currentSrc))
      .toContain('/assets/images/hero/hero-flow-mobile.mp4');
  });

  test('contact form shell is present', async ({ page }) => {
    await page.goto('/');
    const form = page.locator('#contactForm');
    await expect(form).toBeAttached();
    await expect(form.locator('input[name="name"]')).toBeAttached();
    await expect(form.locator('input[name="email"]')).toBeAttached();
    await expect(form.locator('textarea[name="message"]')).toBeAttached();
    await expect(form.locator('button[type="submit"]')).toBeAttached();
  });

  test('gallery has Explore/Create mode toggle', async ({ page }) => {
    await page.goto('/');
    const modeBar = page.locator('.gallery-mode');
    await expect(modeBar).toBeAttached();
    await expect(modeBar.getByRole('tab', { name: 'Explore' })).toBeVisible();
    await expect(modeBar.getByRole('tab', { name: /Create/ })).toBeVisible();
    await expect(page.locator('#galleryExplore')).toBeVisible();
    await expect(page.locator('#galleryStudio')).toBeHidden();
    await expect(page.locator('.filter-btn[data-filter="experimental"]')).toHaveCount(0);
  });

  test('gallery Explore renders public Mempics without regressing the existing Free gallery filters', async ({ page }) => {
    await page.route('**/api/gallery/mempics**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'a1b2c3d4',
                slug: 'mempic-a1b2c3d4',
                title: 'Mempics',
                caption: 'Published by Ada Member on 2026-04-12.',
                category: 'mempics',
                thumb: {
                  url: '/api/gallery/mempics/a1b2c3d4/thumb',
                  w: 320,
                  h: 320,
                },
                preview: {
                  url: '/api/gallery/mempics/a1b2c3d4/medium',
                  w: 1280,
                  h: 1280,
                },
                full: {
                  url: '/api/gallery/mempics/a1b2c3d4/file',
                },
              },
            ],
          },
        }),
      });
    });

    await page.route(/\/api\/gallery\/mempics\/[^/]+\/(thumb|medium|file)$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.goto('/');

    const mempicsBtn = page.locator('.filter-btn[data-filter="mempics"]');
    await expect(mempicsBtn).toBeVisible();
    await mempicsBtn.click();

    const mempicsCard = page.locator('#galleryGrid .gallery-item').filter({ hasText: 'Mempics' });
    await expect(mempicsCard).toHaveCount(1);
    await expect(mempicsCard).toBeVisible();

    await mempicsCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Mempics');
    await expect(page.locator('#modalCaption')).toHaveText('Published by Ada Member on 2026-04-12.');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', '/api/gallery/mempics/a1b2c3d4/file');
    await page.locator('.modal-close').click();

    await page.locator('.filter-btn[data-filter="mempics"]').click();
  });

});

// ---------------------------------------------------------------------------
// Legal pages
// ---------------------------------------------------------------------------

test.describe('Legal pages', () => {
  test('privacy page loads', async ({ page }) => {
    const response = await page.goto('/legal/privacy.html');
    expect(response.status()).toBe(200);
  });

  test('imprint page loads', async ({ page }) => {
    const response = await page.goto('/legal/imprint.html');
    expect(response.status()).toBe(200);
  });

  test('datenschutz page loads', async ({ page }) => {
    const response = await page.goto('/legal/datenschutz.html');
    expect(response.status()).toBe(200);
  });
});

test.describe('Shared MODELS overlay', () => {
  for (const pathname of MODELS_OVERLAY_PATHS) {
    test(`${pathname} opens the local MODELS overlay without navigation`, async ({ page }) => {
      await page.goto(pathname);
      const currentUrl = new URL(page.url());
      const currentPath = `${currentUrl.pathname}${currentUrl.hash}`;

      const modelsButton = page.locator('.site-nav__links').getByRole('button', { name: 'Models' });
      await modelsButton.click();

      await expectPathUnchanged(page, currentPath);
      await expectModelsOverlayOpenState(page);

      await page.getByRole('button', { name: 'Close models' }).click();
      await expect(page.locator('.models-overlay')).not.toHaveClass(/is-active/);
      await expectPathUnchanged(page, currentPath);
    });
  }
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

test.describe('Static assets', () => {
  test('homepage CSS and JS assets load without errors', async ({ page }) => {
    const assetResponses = [];

    page.on('response', (response) => {
      const url = response.url();
      if (
        url.startsWith('http://localhost') &&
        /\.(css|js)(\?|$)/.test(url)
      ) {
        assetResponses.push({ url, status: response.status() });
      }
    });

    await page.goto('/');

    // At least one CSS and one JS asset should have loaded
    const css = assetResponses.filter((a) => /\.css(\?|$)/.test(a.url));
    const js = assetResponses.filter((a) => /\.js(\?|$)/.test(a.url));
    expect(css.length).toBeGreaterThan(0);
    expect(js.length).toBeGreaterThan(0);

    // None should return an error status
    const failed = assetResponses.filter((a) => a.status >= 400);
    expect(failed).toEqual([]);
  });
});
