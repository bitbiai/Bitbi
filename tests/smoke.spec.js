const { test, expect } = require('@playwright/test');

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
    await expect(nav.getByRole('link', { name: 'YouTube' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Models' })).toBeVisible();
  });

  test('MODELS opens the homepage models overlay from the top navigation', async ({ page }) => {
    await page.goto('/');

    const modelsLink = page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Models' });
    await expect(modelsLink).toHaveAttribute('href', '/#models');
    await modelsLink.click();

    await expect(page.locator('.models-overlay')).toBeVisible();
    await expect(page.locator('.models-overlay')).toHaveClass(/is-active/);
    await expect(page.locator('.models-overlay')).toContainText('Pixverse V6');
  });

  test('MODELS opens the homepage models overlay from the mobile navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Toggle menu' }).click();

    const modelsLink = page.locator('#mobileNav').getByRole('link', { name: 'Models' });
    await expect(modelsLink).toHaveAttribute('href', '/#models');
    await modelsLink.click();

    await expect(page.locator('.models-overlay')).toBeVisible();
    await expect(page.locator('.models-overlay')).toHaveClass(/is-active/);
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
    await expect(hero.getByText('AI art • YouTube journeys • Sound Lab • Creative playground')).toHaveCount(0);
    await expect(hero.getByRole('link', { name: 'Creation Lab' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Watch Latest Video' })).toBeVisible();
  });

  test('hero falls back cleanly in reduced motion mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const hero = page.locator('#hero');
    const heroVideo = hero.locator('[data-hero-video]');

    await expect(hero).toBeVisible();
    await expect(heroVideo).toBeHidden();
    await expect(hero.getByRole('link', { name: 'Creation Lab' })).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Watch Latest Video' })).toBeVisible();
  });

  test('hero uses the mobile background video asset on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect
      .poll(() => page.locator('[data-hero-video]').evaluate((el) => el.currentSrc))
      .toContain('/assets/images/hero/hero-flow-mobile.mp4');
  });

  test('YouTube section has consent-gate infrastructure', async ({ page }) => {
    await page.goto('/');
    // Section exists in the DOM
    await expect(page.locator('#youtube')).toBeAttached();
    // Consent-gate elements are wired up
    await expect(page.locator('#ytPlaceholder')).toBeAttached();
    await expect(page.locator('#ytEnableBtn')).toBeAttached();
    await expect(page.locator('.yt-placeholder__text')).toContainText(
      'marketing cookies',
    );
  });

  test('YouTube embed loads only after stored marketing consent with an allowed host', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bitbi_cookie_consent', JSON.stringify({
        v: '1',
        ts: Date.now(),
        necessary: true,
        analytics: false,
        marketing: true,
      }));
    });

    await page.goto('/');

    await expect(page.locator('#ytFrame')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/_S2cGC6cOxk',
    );
    await expect(page.locator('#ytPlaceholder')).toBeHidden();
  });

  test('YouTube embed ignores a tampered non-YouTube data-src even with marketing consent', async ({ page }) => {
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === 'http://localhost:3000' &&
        route.request().resourceType() === 'document' &&
        (url.pathname === '/' || url.pathname === '/index.html')
      ) {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          'data-src="https://www.youtube-nocookie.com/embed/_S2cGC6cOxk"',
          'data-src="https://evil.example/embed/_S2cGC6cOxk"',
        );
        await route.fulfill({ response, body });
        return;
      }
      await route.continue();
    });

    await page.addInitScript(() => {
      localStorage.setItem('bitbi_cookie_consent', JSON.stringify({
        v: '1',
        ts: Date.now(),
        necessary: true,
        analytics: false,
        marketing: true,
      }));
    });

    await page.goto('/');

    await expect(page.locator('#ytFrame')).not.toHaveAttribute('src', /./);
    await expect(page.locator('#ytPlaceholder')).toBeVisible();
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

  test('shared header MODELS link resolves to the homepage overlay from a nested page', async ({ page }) => {
    await page.goto('/legal/privacy.html');

    const modelsLink = page.locator('.site-nav__links').getByRole('link', { name: 'Models' });
    await expect(modelsLink).toHaveAttribute('href', '/#models');
    await modelsLink.click();

    await expect(page).toHaveURL(/\/#models$/);
    await expect(page.locator('.models-overlay')).toBeVisible();
    await expect(page.locator('.models-overlay')).toHaveClass(/is-active/);
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
