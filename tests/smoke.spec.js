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

    await expect(nav.getByRole('link', { name: 'Experiments' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Gallery' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Sound Lab' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'YouTube' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Live Markets' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Contact' })).toBeVisible();
  });

  test('hero section renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('#hero').getByText('My Digital Playground')).toBeVisible();
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
                title: 'Mempic A1B2C3',
                caption: 'Published by a bitbi member on 2026-04-12.',
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

    const mempicsCard = page.locator('#galleryGrid .gallery-item').filter({ hasText: 'Mempic A1B2C3' });
    await expect(mempicsCard).toHaveCount(1);
    await expect(mempicsCard).toBeVisible();

    await mempicsCard.click();
    await expect(page.locator('#modalTitle')).toHaveText('Mempic A1B2C3');
    await expect(page.locator('#modalFullLink')).toHaveAttribute('href', '/api/gallery/mempics/a1b2c3d4/file');
    await page.locator('.modal-close').click();

    await page.locator('.filter-btn[data-filter="pictures"]').click();
    const freeCards = await page.locator('#galleryGrid .gallery-item').count();
    expect(freeCards).toBeGreaterThan(0);
  });

  test('markets render malicious upstream text inertly', async ({ page }) => {
    await page.route('https://api.bitbi.ai', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            symbol: 'btc<script data-market-xss="1">x</script>',
            name: 'Bad <b class="xss-market-payload">Owned</b>',
            current_price: 42000,
            price_change_percentage_24h: 1.25,
            sparkline_in_7d: { price: [40000, 41000, 42000, 43000] },
          },
          {
            symbol: 'eth',
            name: 'Ethereum',
            current_price: 3200,
            price_change_percentage_24h: -0.75,
            sparkline_in_7d: { price: [3300, 3250, 3225, 3200] },
          },
          {
            symbol: 'sol',
            name: 'Solana',
            current_price: 160,
            price_change_percentage_24h: 2.1,
            sparkline_in_7d: { price: [150, 155, 158, 160] },
          },
          {
            symbol: 'ada',
            name: 'Cardano',
            current_price: 0.75,
            price_change_percentage_24h: 0.4,
            sparkline_in_7d: { price: [0.7, 0.71, 0.73, 0.75] },
          },
        ]),
      });
    });

    await page.goto('/');

    await expect(page.locator('#marketCards > div')).toHaveCount(4);
    await expect(page.locator('#marketCards .xss-market-payload')).toHaveCount(0);
    await expect(page.locator('#marketCards script[data-market-xss]')).toHaveCount(0);
    await expect(page.locator('#marketCards h4').first()).toHaveText(
      'Bad <b class="xss-market-payload">Owned</b>',
    );
    await expect(page.locator('#marketCards span').first()).toHaveText(
      'BTC<SCRIPT DATA-MARKET-XSS="1">X</SCRIPT>',
    );
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

// ---------------------------------------------------------------------------
// Experiment pages
// ---------------------------------------------------------------------------

test.describe('Experiment pages', () => {
  for (const page_name of ['cosmic', 'king', 'skyfall']) {
    test(`${page_name}.html loads successfully`, async ({ page }) => {
      const response = await page.goto(`/experiments/${page_name}.html`);
      expect(response.status()).toBe(200);
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
