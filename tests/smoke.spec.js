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
    await expect(nav.getByRole('link', { name: 'VIDEO' })).toBeVisible();
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
    await expect(page.locator('#mobileNav').getByRole('link', { name: 'VIDEO' })).toBeVisible();

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

  test('homepage favorites reuse the shared flow for Mempics cards and video modal cards', async ({ page }) => {
    const favoriteRequests = [];

    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'favorites-home-user',
            email: 'favorites@bitbi.ai',
            role: 'user',
          },
        }),
      });
    });

    await page.route('**/api/favorites', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, favorites: [] }),
        });
        return;
      }

      favoriteRequests.push({
        method,
        body: route.request().postDataJSON(),
      });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

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

    await page.route('**/api/gallery/memvids**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            items: [
              {
                id: 'bada55e1',
                slug: 'memvid-bada55e1',
                title: 'Launch Walkthrough',
                caption: 'Published by Ada Member on 2026-04-14.',
                category: 'memvids',
                file: {
                  url: '/api/gallery/memvids/bada55e1/file',
                },
                poster: {
                  url: '/api/gallery/memvids/bada55e1/poster',
                  w: 1280,
                  h: 720,
                },
              },
            ],
          },
        }),
      });
    });

    await page.route('**/api/gallery/memvids/**', async (route) => {
      if (route.request().url().endsWith('/poster')) {
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64'),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: Buffer.from('mock-video'),
      });
    });

    await page.goto('/');

    const mempicStar = page.locator('#galleryGrid .gallery-item .fav-star').first();
    await expect(mempicStar).toBeVisible();
    await mempicStar.click();
    await expect(mempicStar).toHaveAttribute('aria-pressed', 'true');
    expect(favoriteRequests.at(-1)).toEqual({
      method: 'POST',
      body: {
        item_type: 'mempics',
        item_id: 'a1b2c3d4',
        title: 'Mempics',
        thumb_url: '/api/gallery/mempics/a1b2c3d4/thumb',
      },
    });

    await mempicStar.click();
    await expect(mempicStar).toHaveAttribute('aria-pressed', 'false');
    expect(favoriteRequests.at(-1)).toEqual({
      method: 'DELETE',
      body: {
        item_type: 'mempics',
        item_id: 'a1b2c3d4',
      },
    });

    const videoCard = page.locator('#videoGrid .video-card').first();
    const videoCardStar = videoCard.locator('.fav-star');
    await expect(videoCardStar).toBeVisible();

    await videoCard.click();
    const videoModalStar = page.locator('#videoModal .video-modal__fav');
    await expect(videoModalStar).toBeVisible();
    await videoModalStar.click();

    expect(favoriteRequests.at(-1)).toEqual({
      method: 'POST',
      body: {
        item_type: 'video',
        item_id: 'bada55e1',
        title: 'Launch Walkthrough',
        thumb_url: '/api/gallery/memvids/bada55e1/poster',
      },
    });
    await expect(videoCardStar).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.video-modal-close').click();
    await videoCardStar.click();

    expect(favoriteRequests.at(-1)).toEqual({
      method: 'DELETE',
      body: {
        item_type: 'video',
        item_id: 'bada55e1',
      },
    });
    await expect(videoCardStar).toHaveAttribute('aria-pressed', 'false');
  });

  test('Sound Lab expands to five columns on wide desktops and steps down on smaller desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/');
    await expect(page.locator('#soundLabTracks .snd-card').first()).toBeVisible();

    const wideLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      const style = window.getComputedStyle(grid);
      return {
        columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
        overflow: grid.scrollWidth - grid.clientWidth,
      };
    });

    expect(wideLayout.columns).toBe(5);
    expect(wideLayout.overflow).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1100, height: 1200 });
    const laptopLayout = await page.evaluate(() => {
      const grid = document.getElementById('soundLabTracks');
      const style = window.getComputedStyle(grid);
      return style.gridTemplateColumns.split(' ').filter(Boolean).length;
    });

    expect(laptopLayout).toBeLessThanOrEqual(4);
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
  test('shared subpage header exposes the VIDEO link', async ({ page }) => {
    await page.goto('/legal/imprint.html');

    const videoLink = page.locator('.site-nav__links').getByRole('link', { name: 'VIDEO' });
    await expect(videoLink).toBeVisible();
    await expect(videoLink).toHaveAttribute('href', /\/#video-creations$/);
  });

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
