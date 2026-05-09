const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadLocaleRouting() {
  return import(pathToFileURL(path.join(__dirname, '..', 'js/shared/locale-routing.mjs')).href);
}

async function seedCookieConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'bitbi_cookie_consent',
      JSON.stringify({
        v: '1',
        ts: Date.now(),
        necessary: true,
        analytics: false,
        marketing: false,
      }),
    );
  });
}

function repoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function visibleHtmlText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function uiHtmlText(html) {
  const attrText = [...html.matchAll(/\b(?:placeholder|aria-label|title|alt|value)="([^"]*)"/g)]
    .map((match) => match[1])
    .join(' ');
  return `${visibleHtmlText(html)} ${attrText}`.replace(/\s+/g, ' ');
}

function listHtmlFiles(dir) {
  const root = path.join(__dirname, '..', dir);
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtmlFiles(relative));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(relative.replace(/\\/g, '/'));
  }
  return out;
}

function criticalAttributes(html) {
  const attributes = [
    'id',
    'for',
    'aria-controls',
    'aria-labelledby',
    'aria-describedby',
    'data-action',
    'data-category-link',
    'data-field',
    'data-mode',
    'data-models-link',
    'data-nav',
    'data-section',
    'data-tab',
    'data-target',
    'name',
  ];
  const pattern = new RegExp(`\\b(${attributes.join('|')})="([^"]*)"`, 'g');
  return [...html.matchAll(pattern)].map((match) => `${match[1]}=${match[2]}`).sort();
}

test.describe('Bilingual locale pages', () => {
  test('visibleHtmlText strips hidden blocks with whitespace-tolerant closing tags', () => {
    const html = [
      '<p>Visible copy</p>',
      '<!-- Hidden comment -->',
      '<script type="application/json">Hidden script copy</script >',
      '<style media="screen">Hidden style copy</style >',
      '<svg aria-hidden="true"><text>Hidden svg copy</text></svg >',
      '<p>Readable <strong>text</strong></p>',
    ].join('');
    const text = visibleHtmlText(html);

    expect(text).toContain('Visible copy');
    expect(text).toContain('Readable text');
    expect(text).not.toContain('Hidden comment');
    expect(text).not.toContain('Hidden script copy');
    expect(text).not.toContain('Hidden style copy');
    expect(text).not.toContain('Hidden svg copy');
  });

  test('English and German root pages expose the expected lang attributes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/de/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });

  test('English and German homepages include the localized Live Pulse mount and reduced-motion CSS', () => {
    const enHome = repoFile('index.html');
    const deHome = repoFile('de/index.html');
    const css = repoFile('css/components/news-pulse.css');

    expect(enHome).toContain('data-news-pulse-locale="en"');
    expect(enHome).toContain('aria-label="Bitbi Live Pulse"');
    expect(enHome).toContain('css/components/news-pulse.css');
    expect(enHome).toMatch(/<section id="hero"[\s\S]*<section id="newsPulse"[\s\S]*<\/section>[\s\S]*<\/section>/);
    expect(deHome).toContain('data-news-pulse-locale="de"');
    expect(deHome).toContain('aria-label="KI-Puls"');
    expect(deHome).toContain('../css/components/news-pulse.css');
    expect(deHome).toMatch(/<section id="hero"[\s\S]*<section id="newsPulse"[\s\S]*<\/section>[\s\S]*<\/section>/);
    expect(css).toContain('position: absolute');
    expect(css).toContain('news-pulse-wheel');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none');
  });

  test('pricing pages render English and German copy', async ({ page }) => {
    await page.goto('/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'BITBI Credits' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Create more with flexible prepaid credits.');
    await expect(page.locator('main')).toContainText('Secure payment continues on pay.bitbi.ai.');
    await expect(page.locator('.site-footer__links')).toContainText('Privacy');

    await page.goto('/de/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'BITBI Credits' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Mehr erstellen mit flexiblen Prepaid-Credits.');
    await expect(page.locator('main')).toContainText('Die sichere Zahlung wird auf pay.bitbi.ai fortgesetzt.');
    await expect(page.locator('.site-footer__links')).toContainText('Datenschutz');
  });

  test('pricing checkout scripts avoid deprecated Stripe redirect helpers', () => {
    const pricingScript = repoFile('js/pages/pricing/main.js');
    const creditsScript = repoFile('js/pages/credits/main.js');
    expect(`${pricingScript}\n${creditsScript}`).not.toContain('redirectToCheckout');
    expect(pricingScript).toContain('https://pay.bitbi.ai');
    expect(creditsScript).toContain('https://pay.bitbi.ai');
  });

  test('language switcher maps equivalent pages, preserves query strings, and stores preference', async ({ page }) => {
    await page.goto('/generate-lab/?source=locale-test');
    const deLink = page.locator('.locale-switcher__link[hreflang="de"]').first();
    await expect(deLink).toHaveAttribute('href', '/de/generate-lab/?source=locale-test');
    await deLink.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/de/generate-lab/');
    await expect.poll(() => new URL(page.url()).search).toBe('?source=locale-test');
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain('bitbi_locale=de');

    const enLink = page.locator('.locale-switcher__link[hreflang="en"]').first();
    await expect(enLink).toHaveAttribute('href', '/generate-lab/?source=locale-test');
  });

  test('Models overlay localizes desktop triggers on English and German homepages', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto('/');
    await expect(page.locator('[data-models-link="desktop"]')).toHaveAttribute('aria-label', 'Open Models');
    await page.locator('[data-models-link="desktop"]').click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'BILDGENERIERUNG' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'GPT Image 2' }).locator('.models-overlay__status'),
    ).toHaveText('LIVE');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).not.toHaveClass(/is-active/);

    await page.goto('/de/');
    await expect(page.locator('[data-models-link="desktop"]')).toHaveAttribute('aria-label', 'Modelle öffnen');
    await page.locator('[data-models-link="desktop"]').click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'IMAGE GENERATION' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Modelle schließen' })).toBeVisible();
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'FLUX.2 Klein 9B' }).locator('.models-overlay__status'),
    ).toHaveText('LIVE');
    await expect(
      overlay.locator('.models-overlay__card').filter({ hasText: 'Vidu Q3 Pro' }).locator('.models-overlay__status'),
    ).toHaveText('Demnächst');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    await expect(overlay).not.toHaveClass(/is-active/);
  });

  test('Models overlay localizes mobile menu triggers and closes the mobile panel', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');

    await page.goto('/de/');
    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'false');
    await page.locator('#mobileNav').getByRole('button', { name: 'Modelle' }).click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(page.locator('#mobileNav')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'IMAGE GENERATION' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Modelle schließen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });

  test('mobile navigation labels stay localized in English and German', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/');
    await page.locator('#mobileMenuBtn').click();
    let mobileNav = page.locator('#mobileNav');
    await expect(mobileNav).toHaveAttribute('aria-label', 'Navigation menu');
    await expect(mobileNav).toContainText('Models');
    await expect(mobileNav).toContainText('Gallery');
    await expect(mobileNav).toContainText('Contact');
    await expect(mobileNav).toContainText('Cookie Settings');
    await expect(mobileNav).not.toContainText('Modelle');
    await expect(mobileNav).not.toContainText('Galerie');
    await expect(mobileNav).not.toContainText('Cookie-Einstellungen');

    await page.goto('/de/');
    await page.locator('#mobileMenuBtn').click();
    mobileNav = page.locator('#mobileNav');
    await expect(mobileNav).toHaveAttribute('aria-label', 'Navigationsmenü');
    await expect(mobileNav).toContainText('Modelle');
    await expect(mobileNav).toContainText('Galerie');
    await expect(mobileNav).toContainText('Kontakt');
    await expect(mobileNav).toContainText('Cookie-Einstellungen');
    await expect(mobileNav).not.toContainText('Models');
    await expect(mobileNav).not.toContainText('Gallery');
    await expect(mobileNav).not.toContainText('Contact');
    await expect(mobileNav).not.toContainText('Cookie Settings');
  });

  test('shared subpage mobile Models entry follows the active locale', async ({ page }) => {
    await seedCookieConsent(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('/legal/privacy.html');
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    let overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);

    await page.goto('/de/legal/datenschutz.html');
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Modelle' }).click();
    overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'KI-Modelle');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'BILDGENERIERUNG',
      'MUSIKGENERIERUNG',
      'VIDEOGENERIERUNG',
    ]);
  });

  test('German static pages keep JavaScript-critical identifiers and avoid known untranslated UI copy', async () => {
    const deIndex = repoFile('de/index.html');
    for (const id of ['galleryExplore', 'videoExplore', 'soundLabExplore']) {
      expect(deIndex).toContain(`id="${id}"`);
    }
    for (const translatedId of ['galleryEntdecken', 'videoEntdecken', 'soundLabEntdecken']) {
      expect(deIndex).not.toContain(`id="${translatedId}"`);
    }
    expect(deIndex).toContain('data-models-link="desktop"');
    expect(deIndex).toContain('data-models-link="mobile"');

    const criticalPairs = [
      ['index.html', 'de/index.html'],
      ['generate-lab/index.html', 'de/generate-lab/index.html'],
      ['account/profile.html', 'de/account/profile.html'],
      ['account/assets-manager.html', 'de/account/assets-manager.html'],
      ['account/credits.html', 'de/account/credits.html'],
      ['account/forgot-password.html', 'de/account/forgot-password.html'],
      ['account/image-studio.html', 'de/account/image-studio.html'],
      ['account/organization.html', 'de/account/organization.html'],
      ['account/reset-password.html', 'de/account/reset-password.html'],
      ['account/verify-email.html', 'de/account/verify-email.html'],
      ['account/wallet.html', 'de/account/wallet.html'],
    ];
    for (const [enPath, dePath] of criticalPairs) {
      expect(criticalAttributes(repoFile(dePath)), `${dePath} critical attributes`).toEqual(criticalAttributes(repoFile(enPath)));
    }

    const denylist = [
      'My Profile',
      'View and manage your account',
      'Loading profile',
      'Sign In Required',
      'Account Info',
      'Display Name',
      'Member Since',
      'Edit Profile',
      'Save Changes',
      'Loading Assets Manager',
      'Organize, preview, publish, and manage your saved media',
      'Saved Assets',
      'Private by default',
      'All Folders',
      'Move to Folder',
      'Delete Selected',
      'Back to Profile',
      'Organization billing',
      'Buy one-time live Stripe credit packs',
      'Loading credits dashboard',
      'Credit packs',
      'Recent purchases',
      'Recent credit activity',
      'Verify Email',
      'Email verification',
      'Set New Password',
      'At least 8 characters',
      'Opening wallet workspace',
      'The BITBI wallet workspace',
      'Organization context',
      'Organization dashboard is not available',
      'Selected organization',
      'Recent credit ledger',
      'Recent admin image-test debits',
      'No image run yet',
      'No preference',
      'Planned',
      'Type Description Details Amount Balance',
      'Your generated image',
      'Your generated video',
      'Your generated music',
      'Send Message',
      'Your message',
      'A luminous glass sculpture',
      'A cinematic neon city street',
      'A glossy synth-pop track',
      'Optional image-to-video reference',
      'Optional lyrics',
      'Randomize seed',
      'Saved automatically',
      'Generate Video',
      'Generate Music',
      'New name',
      'Name & Address',
      'Impressum content',
      'Desktop Workspace',
      'Add reference image',
      'One line per item',
      'Chat transcript',
      'Asset title',
      'Optional — describe what to avoid',
      'Speichernd assets browser',
      'Speichernd asset actions',
    ];
    for (const file of listHtmlFiles('de')) {
      const visibleText = uiHtmlText(repoFile(file));
      for (const phrase of denylist) {
        expect(visibleText, `${file} should not expose "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  test('English and German legal links stay in their own locale', async () => {
    for (const englishFile of ['index.html', 'pricing.html', 'legal/privacy.html', 'legal/imprint.html', 'legal/datenschutz.html']) {
      const html = repoFile(englishFile);
      expect(html, `${englishFile} terms link`).toMatch(/href="(?:\/legal\/terms\.html|(?:\.\.\/)?terms\.html|legal\/terms\.html)"/);
      expect(visibleHtmlText(html)).not.toContain('AGB');
    }

    for (const germanFile of ['de/index.html', 'de/pricing.html', 'de/legal/datenschutz.html', 'de/legal/privacy.html', 'de/legal/imprint.html', 'de/legal/terms.html']) {
      const html = repoFile(germanFile);
      expect(html).toContain('/de/legal/datenschutz.html');
      expect(html).toContain('/de/legal/terms.html');
    }

    for (const germanLegalFile of ['de/legal/datenschutz.html', 'de/legal/privacy.html', 'de/legal/imprint.html', 'de/legal/terms.html']) {
      const html = repoFile(germanLegalFile);
      expect(html, `${germanLegalFile} privacy footer`).not.toContain('href="datenschutz.html"');
      expect(html, `${germanLegalFile} terms footer`).not.toContain('href="terms.html"');
      expect(html, `${germanLegalFile} imprint footer`).not.toContain('href="imprint.html"');
    }

    const dePrivacyAlias = repoFile('de/legal/privacy.html');
    expect(dePrivacyAlias).toContain('<link rel="canonical" href="https://bitbi.ai/de/legal/datenschutz.html">');

    const deRoot = repoFile('de/index.html');
    expect(deRoot).toContain('<link rel="canonical" href="https://bitbi.ai/de/">');
    expect(deRoot).toContain('<meta property="og:url" content="https://bitbi.ai/de/">');
    expect(deRoot).toContain('"url": "https://bitbi.ai/de/"');
  });

  test('repo agent instructions document bilingual non-admin parity and Admin exception', async () => {
    const exactRule = 'All non-admin changes must be implemented and checked for both English and German routes/pages/locales. Admin remains English-only and must not be localized or recreated under /de/admin unless explicitly requested.';
    const agentInstructions = repoFile('AGENTS.md');
    const claudeInstructions = repoFile('CLAUDE.md');
    expect(agentInstructions).toContain(exactRule);
    expect(claudeInstructions).toContain(exactRule);
    expect(agentInstructions).toContain('All future non-admin changes must be checked and implemented for both English and German');
    expect(agentInstructions).toContain('Public pages, account/member pages, shared navigation, pricing, auth, legal links, overlays, labels, route policies, tests, and localized UI must stay in parity');
    expect(agentInstructions).toContain('The Admin area is the exception: Admin remains English-only');
    expect(agentInstructions).toContain('/de/admin');
  });

  test('German SEO metadata stays on German canonical URLs', async () => {
    for (const file of listHtmlFiles('de')) {
      const html = repoFile(file);
      const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
      if (canonical) {
        expect(canonical[1], `${file} canonical`).toMatch(/^https:\/\/bitbi\.ai\/de(?:\/|$)/);
      }
      const ogUrl = html.match(/<meta property="og:url" content="([^"]+)">/);
      if (ogUrl) {
        expect(ogUrl[1], `${file} og:url`).toMatch(/^https:\/\/bitbi\.ai\/de(?:\/|$)/);
      }
      expect(html, `${file} JSON-LD url should not point to English root`).not.toContain('"url": "https://bitbi.ai/"');
      expect(html, `${file} German privacy links`).not.toContain('/de/legal/privacy.html');
    }
  });

  test('Admin stays English-only and is not exposed as a German localized page', async ({ page }) => {
    expect(fs.existsSync(path.join(__dirname, '..', 'de/admin/index.html'))).toBe(false);

    const adminHtml = repoFile('admin/index.html');
    expect(adminHtml).toContain('<html lang="en">');
    expect(adminHtml).not.toContain('/de/admin');
    expect(visibleHtmlText(adminHtml)).not.toContain('Hauptnavigation');
    expect(visibleHtmlText(adminHtml)).not.toContain('Admin-Bereiche');

    await page.goto('/');
    await page.evaluate(() => {
      document.cookie = 'bitbi_locale=de; Path=/; Max-Age=31536000; SameSite=Lax';
    });

    await page.goto('/admin/index.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.locale-switcher__link')).toHaveCount(0);
    await expect(page.locator('#navbar')).toHaveAttribute('aria-label', 'Main navigation');
    await expect(page.locator('.site-nav__links')).toContainText('Gallery');
    await expect(page.locator('body')).not.toContainText('Galerie');
    await expect(page.locator('body')).not.toContainText('Hauptnavigation');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileMenuBtn').click();
    await page.locator('#mobileNav').getByRole('button', { name: 'Models' }).click();
    const overlay = page.locator('.models-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('aria-label', 'AI Models');
    await expect(overlay.locator('.models-overlay__category')).toHaveText([
      'IMAGE GENERATION',
      'MUSIC GENERATION',
      'VIDEO GENERATION',
    ]);
    await expect(overlay.locator('.models-overlay__category').filter({ hasText: 'BILDGENERIERUNG' })).toHaveCount(0);
    await expect(overlay.getByRole('button', { name: 'Close models' })).toBeVisible();
  });
});

test.describe('DACH locale routing helpers', () => {
  test('redirects DACH document requests to /de/ without redirecting existing German routes', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/?utm=test',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/?utm=test');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html?checkout=cancel',
      headers: new Headers({ 'CF-IPCountry': 'AT' }),
    })).toBe('https://bitbi.ai/de/pricing.html?checkout=cancel');

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/de/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'CH' }),
    })).toBe(false);
  });

  test('honors locale cookies and normalizes bare /de safely', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html?checkout=cancel',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('https://bitbi.ai/de/pricing.html?checkout=cancel');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/account/profile.html',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('https://bitbi.ai/de/account/profile.html');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'DE', Cookie: 'bitbi_locale=en' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/pricing.html');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/pricing.html',
      headers: new Headers({ 'CF-IPCountry': 'US' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/de',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('https://bitbi.ai/de/');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/de/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('');

    expect(routing.toGermanPath('/de')).toBe('/de/');
    expect(routing.toGermanPath('/de/')).toBe('/de/');
    expect(routing.toGermanPath('/de')).not.toBe('/de/de');
  });

  test('keeps Admin routes out of German path mapping and geo redirects', async () => {
    const routing = await loadLocaleRouting();

    for (const pathname of [
      '/admin',
      '/admin/',
      '/admin/index.html',
      '/admin/users',
      '/de/admin',
      '/de/admin/',
      '/de/admin/index.html',
      '/de/admin/users',
    ]) {
      expect(routing.isAdminPath(pathname), `${pathname} is admin`).toBe(true);
    }

    expect(routing.toGermanPath('/admin')).toBe('/admin/');
    expect(routing.toGermanPath('/admin/')).toBe('/admin/');
    expect(routing.toGermanPath('/admin/index.html')).toBe('/admin/index.html');
    expect(routing.toGermanPath('/admin/users')).toBe('/admin/users');
    expect(routing.toGermanPath('/de/admin/')).toBe('/admin/');
    expect(routing.toEnglishPath('/de/admin/index.html')).toBe('/admin/index.html');

    expect(routing.toGermanPath('/admin')).not.toBe('/de/admin/');
    expect(routing.toGermanPath('/admin/')).not.toBe('/de/admin/');
    expect(routing.toGermanPath('/admin/index.html')).not.toBe('/de/admin/index.html');

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe(false);

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('');

    expect(routing.getGeoRedirectLocation({
      method: 'GET',
      url: 'https://bitbi.ai/admin/index.html',
      headers: new Headers({ Cookie: 'bitbi_locale=de' }),
    })).toBe('');
  });

  test('does not geo-redirect non-DACH users, locale-cookie users, API routes, or assets', async () => {
    const routing = await loadLocaleRouting();

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/',
      headers: new Headers({ 'CF-IPCountry': 'US' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/',
      headers: new Headers({ 'CF-IPCountry': 'DE', Cookie: 'bitbi_locale=en' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/api/session',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);

    expect(routing.shouldGeoRedirect({
      method: 'GET',
      url: 'https://bitbi.ai/css/base/base.css',
      headers: new Headers({ 'CF-IPCountry': 'DE' }),
    })).toBe(false);
  });
});
