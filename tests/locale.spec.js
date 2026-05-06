const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadLocaleRouting() {
  return import(pathToFileURL(path.join(__dirname, '..', 'js/shared/locale-routing.mjs')).href);
}

test.describe('Bilingual locale pages', () => {
  test('English and German root pages expose the expected lang attributes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/de/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });

  test('pricing pages render English and German copy', async ({ page }) => {
    await page.goto('/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'BITBI Credits' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Create more with flexible prepaid credits.');
    await expect(page.locator('.site-footer__links')).toContainText('Privacy');

    await page.goto('/de/pricing.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'BITBI Credits' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Mehr erstellen mit flexiblen Prepaid-Credits.');
    await expect(page.locator('.site-footer__links')).toContainText('Datenschutz');
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
