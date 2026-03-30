const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------------------------
// Auth modal
// ---------------------------------------------------------------------------

test.describe('Auth modal', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-set cookie consent to prevent banner overlaying interactive elements
    await page.addInitScript(() => {
      localStorage.setItem(
        'bitbi_cookie_consent',
        JSON.stringify({
          necessary: true,
          analytics: false,
          marketing: false,
          timestamp: Date.now(),
        }),
      );
    });
    await page.goto('/');
    // Wait for auth state to resolve (API 404 → logged-out → button renders)
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('sign-in button is present in desktop navigation', async ({ page }) => {
    await expect(page.locator('.site-nav__cta')).toHaveText('Sign In');
  });

  test('opens and shows login form with expected fields', async ({ page }) => {
    await page.locator('.site-nav__cta').click();

    await expect(page.locator('.auth-modal__overlay')).toBeVisible();

    const form = page.locator('#authLoginForm');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('input[name="password"]')).toBeVisible();
    await expect(
      form.getByRole('button', { name: /sign in/i }),
    ).toBeVisible();
  });

  test('can switch to register form', async ({ page }) => {
    await page.locator('.site-nav__cta').click();
    await expect(page.locator('.auth-modal__overlay')).toBeVisible();

    await page.locator('[data-tab="register"]').click();

    const form = page.locator('#authRegisterForm');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="email"]')).toBeVisible();
    await expect(form.locator('input[name="password"]')).toBeVisible();
    await expect(
      form.getByRole('button', { name: /create account/i }),
    ).toBeVisible();
  });

  test('closes on Escape key', async ({ page }) => {
    await page.locator('.site-nav__cta').click();
    const overlay = page.locator('.auth-modal__overlay');
    // Overlay uses opacity transition, so check the .active class, not CSS visibility
    await expect(overlay).toHaveClass(/active/);

    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/active/);
  });
});

// ---------------------------------------------------------------------------
// Auth flow pages
// ---------------------------------------------------------------------------

test.describe('Auth flow pages', () => {
  test('forgot password page loads with form', async ({ page }) => {
    const response = await page.goto('/account/forgot-password.html');
    expect(response.status()).toBe(200);
    const form = page.locator('#forgotForm');
    await expect(form).toBeAttached();
    await expect(form.locator('input[type="email"]')).toBeAttached();
    await expect(form.locator('button[type="submit"]')).toBeAttached();
  });

  test('reset password page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/reset-password.html');
    expect(response.status()).toBe(200);
    // Without a valid token, both state containers should exist in the DOM
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
  });

  test('verify email page loads with state containers', async ({ page }) => {
    const response = await page.goto('/account/verify-email.html');
    expect(response.status()).toBe(200);
    await expect(page.locator('#loadingState')).toBeAttached();
    await expect(page.locator('#invalidState')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Account pages — unauthenticated behavior
// ---------------------------------------------------------------------------

test.describe('Account pages (unauthenticated)', () => {
  test('profile page shows denied state without auth', async ({ page }) => {
    const response = await page.goto('/account/profile.html');
    expect(response.status()).toBe(200);
    // JS calls /api/profile → 404 on local server → shows denied state
    await expect(page.locator('#deniedState')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#profileContent')).not.toBeVisible();
  });

  test('admin page shows access-denied state without auth', async ({ page }) => {
    const response = await page.goto('/admin/index.html');
    expect(response.status()).toBe(200);
    // JS calls /api/admin/me → 404 on local server → shows denied panel
    await expect(page.locator('#adminDenied')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#adminPanel')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Regression: auth modal form injection timing (Safari autofill fix)
// Documented in CLAUDE.md as intentional — forms must NOT be pre-rendered.
// ---------------------------------------------------------------------------

test.describe('Regression: auth modal form injection', () => {
  test('login/register forms are not in DOM before modal opens', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'bitbi_cookie_consent',
        JSON.stringify({
          necessary: true,
          analytics: false,
          marketing: false,
          timestamp: Date.now(),
        }),
      );
    });
    await page.goto('/');
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });

    // Before modal opens — no form elements in the DOM
    await expect(page.locator('#authLoginForm')).not.toBeAttached();
    await expect(page.locator('#authRegisterForm')).not.toBeAttached();

    // After opening — forms are injected
    await page.locator('.site-nav__cta').click();
    await expect(page.locator('#authLoginForm')).toBeAttached();
    await expect(page.locator('#authRegisterForm')).toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// Locked sections — logged-out state
// ---------------------------------------------------------------------------

test.describe('Locked sections', () => {
  test('auth-gated content is locked when logged out', async ({ page }) => {
    await page.goto('/');
    // Wait for auth to resolve and locked-sections to update
    await expect(page.locator('.site-nav__cta')).toBeVisible({
      timeout: 10_000,
    });

    const locked = page.locator('[data-locked="true"]');
    await expect(locked.first()).toBeAttached({ timeout: 5_000 });
    expect(await locked.count()).toBeGreaterThan(0);
  });
});
