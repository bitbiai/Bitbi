const { test, expect } = require('@playwright/test');

const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedCookieConsent(page) {
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
}

async function mockAdminAiLab(page) {
  const catalog = {
    ok: true,
    task: 'models',
    presets: [
      {
        name: 'fast',
        task: 'text',
        label: 'Fast Text',
        model: '@cf/meta/llama-3.1-8b-instruct-fast',
        description: 'Fast text preset',
      },
      {
        name: 'balanced',
        task: 'text',
        label: 'Balanced Text',
        model: '@cf/openai/gpt-oss-20b',
        description: 'Balanced text preset',
      },
      {
        name: 'image_fast',
        task: 'image',
        label: 'Fast Image',
        model: '@cf/black-forest-labs/flux-1-schnell',
        description: 'Fast image preset',
      },
      {
        name: 'embedding_default',
        task: 'embeddings',
        label: 'Default Embeddings',
        model: '@cf/baai/bge-m3',
        description: 'Default embeddings preset',
      },
    ],
    models: {
      text: [
        {
          id: '@cf/meta/llama-3.1-8b-instruct-fast',
          task: 'text',
          label: 'Llama 3.1 8B Instruct Fast',
          vendor: 'Meta',
          description: 'Fast text model',
        },
        {
          id: '@cf/openai/gpt-oss-20b',
          task: 'text',
          label: 'GPT OSS 20B',
          vendor: 'OpenAI',
          description: 'Balanced text model',
        },
      ],
      image: [
        {
          id: '@cf/black-forest-labs/flux-1-schnell',
          task: 'image',
          label: 'FLUX.1 Schnell',
          vendor: 'Black Forest Labs',
          description: 'Fast image model',
        },
      ],
      embeddings: [
        {
          id: '@cf/baai/bge-m3',
          task: 'embeddings',
          label: 'BGE M3',
          vendor: 'BAAI',
          description: 'Default embeddings model',
        },
      ],
    },
    future: {
      speech: {
        enabled: false,
        note: 'Speech support is scaffold-only in v1.',
      },
    },
  };

  await page.route('**/api/admin/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        user: {
          id: 'admin-1',
          email: 'admin@bitbi.ai',
          role: 'admin',
        },
      }),
    });
  });

  await page.route('**/api/admin/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        stats: {
          totalUsers: 12,
          activeUsers: 10,
          admins: 2,
          verifiedUsers: 11,
          disabledUsers: 2,
          recentRegistrations: 3,
        },
      }),
    });
  });

  await page.route('**/api/admin/ai/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalog),
    });
  });

  await page.route('**/api/admin/ai/test-text', async (route) => {
    const body = route.request().postDataJSON();
    if (body.prompt === 'force error') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'Prompt rejected by mock.',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'text',
        model: catalog.models.text[1],
        preset: body.preset || 'balanced',
        result: {
          text: 'Mocked text output from admin AI Lab.',
          usage: {
            total_tokens: 42,
          },
          maxTokens: body.maxTokens,
          temperature: body.temperature,
        },
        elapsedMs: 123,
        warnings: ['Mock text warning'],
      }),
    });
  });

  await page.route('**/api/admin/ai/test-image', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'image',
        model: catalog.models.image[0],
        preset: 'image_fast',
        result: {
          imageBase64: ONE_PX_PNG_BASE64,
          mimeType: 'image/png',
          steps: body.steps ?? 4,
          seed: body.seed ?? 12345,
          requestedSize:
            body.width && body.height
              ? { width: body.width, height: body.height }
              : null,
          appliedSize: null,
        },
        elapsedMs: 456,
        warnings: ['Mock image warning'],
      }),
    });
  });

  await page.route('**/api/admin/ai/test-embeddings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'embeddings',
        model: catalog.models.embeddings[0],
        preset: 'embedding_default',
        result: {
          vectors: [
            [0.1, 0.2, 0.3],
            [0.4, 0.5, 0.6],
          ],
          dimensions: 3,
          count: 2,
          shape: [2, 3],
          pooling: null,
        },
        elapsedMs: 88,
      }),
    });
  });

  await page.route('**/api/admin/ai/compare', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        task: 'compare',
        models: catalog.models.text,
        result: {
          results: [
            {
              ok: true,
              model: catalog.models.text[0],
              text: 'Model A compare output.',
              usage: { total_tokens: 11 },
              elapsedMs: 111,
            },
            {
              ok: true,
              model: catalog.models.text[1],
              text: 'Model B compare output.',
              usage: { total_tokens: 17 },
              elapsedMs: 123,
            },
          ],
          maxTokens: 250,
          temperature: 0.7,
        },
        elapsedMs: 222,
        warnings: ['Mock compare warning'],
      }),
    });
  });
}

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

  test('image studio page shows denied state without auth', async ({ page }) => {
    const response = await page.goto('/account/image-studio.html');
    expect(response.status()).toBe(200);
    // JS calls /api/me → 404 on local server → shows denied state
    await expect(page.locator('#deniedState')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#studioContent')).not.toBeVisible();
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
// Admin AI Lab
// ---------------------------------------------------------------------------

test.describe('Admin AI Lab', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
    await mockAdminAiLab(page);
  });

  test('loads the admin AI Lab section and runs all task panels', async ({
    page,
  }) => {
    const response = await page.goto('/admin/index.html#ai-lab');
    expect(response.status()).toBe(200);

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#adminHeroTitle')).toHaveText('AI Lab');
    await expect(page.locator('#sectionAiLab')).toBeVisible();
    await expect(page.locator('#aiModelsText')).toContainText('GPT OSS 20B');

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.selectOption('#aiTextSampleSelect', 'release-notes');
    await page.locator('#aiTextSample').click();
    await expect(page.locator('#aiTextPrompt')).toHaveValue(
      /Turn this feature idea into 5 concise release notes/,
    );
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );
    await expect(page.locator('#aiTextMeta')).toContainText('Model Label');
    await expect(page.locator('#aiTextMeta')).toContainText('@cf/openai/gpt-oss-20b');
    await expect(page.locator('#aiTextMeta')).toContainText('Received');

    await page.getByRole('button', { name: 'Image' }).click();
    await page.selectOption('#aiImageSampleSelect', 'editorial-portrait');
    await page.locator('#aiImageSample').click();
    await expect(page.locator('#aiImagePrompt')).toHaveValue(
      /An editorial portrait of a digital artist/,
    );
    await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiImagePreview img')).toBeVisible();
    await expect(page.locator('#aiImageMeta')).toContainText('image/png');
    await expect(page.locator('#aiImageDownload')).toBeVisible();
    const imageDownload = page.waitForEvent('download');
    await page.locator('#aiImageDownload').click();
    await expect((await imageDownload).suggestedFilename()).toContain('ai-lab-image');

    await page.getByRole('button', { name: 'Embeddings' }).click();
    await page.selectOption('#aiEmbeddingsSampleSelect', 'taxonomy');
    await page.locator('#aiEmbeddingsSample').click();
    await expect(page.locator('#aiEmbeddingsInput')).toHaveValue(
      /cyberpunk neon skyline/,
    );
    await page.locator('#aiEmbeddingsRun').click();
    await expect(page.locator('#aiEmbeddingsSummary')).toContainText(
      '2 vectors returned.',
    );
    await expect(page.locator('#aiEmbeddingsPreview')).toContainText('0.1000');
    await expect(page.locator('#aiEmbeddingsMeta')).toContainText('Shape');

    await page.getByRole('button', { name: 'Compare' }).click();
    await page.selectOption('#aiCompareSampleSelect', 'hero-intro');
    await page.locator('#aiCompareSample').click();
    await expect(page.locator('#aiComparePrompt')).toHaveValue(
      /Write a 2-sentence homepage intro/,
    );
    await page.locator('#aiCompareRun').click();
    await expect(page.locator('#aiCompareAText')).toContainText(
      'Model A compare output.',
    );
    await expect(page.locator('#aiCompareBText')).toContainText(
      'Model B compare output.',
    );
    await expect(page.locator('#aiCompareAMeta')).toContainText('Meta');
    await expect(page.locator('#aiCompareBMeta')).toContainText('OpenAI');

    await page.locator('a.admin-nav__link[data-section="dashboard"]').click();
    await expect(page.locator('#adminHeroTitle')).toHaveText('Dashboard');
    await expect(page.locator('#statTotal')).toHaveText('12');
  });

  test('persists last-used form values and surfaces backend errors', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('Persist me');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );
    await page.reload();

    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.locator('#aiTextPrompt')).toHaveValue('Persist me');
    await expect(page.locator('#aiTextPromptHistory')).toContainText('Persist me');

    await page.locator('#aiTextHistoryClear').click();
    await expect(page.locator('#aiTextPromptHistory')).toContainText(
      'Recent text prompts will appear here.',
    );

    await page.locator('#aiTextPrompt').fill('force error');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText(
      'Prompt rejected by mock.',
    );
    await expect(page.locator('#aiTextState')).toContainText(
      'Prompt rejected by mock.',
    );
  });

  test('cancels an in-flight text request without overwriting the previous result', async ({
    page,
  }) => {
    await page.goto('/admin/index.html#ai-lab');
    await expect(page.locator('#adminPanel')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.locator('#aiTextPrompt').fill('Fast success');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );

    await page.unroute('**/api/admin/ai/test-text');
    await page.route('**/api/admin/ai/test-text', async (route) => {
      await wait(900);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          task: 'text',
          model: {
            id: '@cf/meta/llama-3.1-8b-instruct-fast',
            task: 'text',
            label: 'Llama 3.1 8B Instruct Fast',
            vendor: 'Meta',
          },
          preset: 'fast',
          result: {
            text: 'Slow response that should never replace the cancelled state.',
            usage: {
              total_tokens: 99,
            },
            maxTokens: 300,
            temperature: 0.7,
          },
          elapsedMs: 999,
        }),
      });
    });

    await page.locator('#aiTextPrompt').fill('Cancel this slow request');
    await page.locator('#aiTextRun').click();
    await expect(page.locator('#aiTextCancel')).toBeEnabled();
    await expect(page.locator('#aiTextState')).toContainText('Running text test');

    await page.locator('#aiTextCancel').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextState')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextOutput')).toContainText(
      'Mocked text output from admin AI Lab.',
    );

    await wait(1000);
    await expect(page.locator('#aiTextState')).toContainText('Text request cancelled.');
    await expect(page.locator('#aiTextOutput')).not.toContainText(
      'Slow response that should never replace the cancelled state.',
    );
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
