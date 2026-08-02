const { test, expect } = require('@playwright/test');

const STORAGE_USAGE = Object.freeze({
  usedBytes: 12 * 1024 * 1024,
  limitBytes: 50 * 1024 * 1024,
  remainingBytes: 38 * 1024 * 1024,
  isUnlimited: false,
});

async function seedCookieConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('bitbi_cookie_consent', JSON.stringify({
      v: '1',
      ts: Date.now(),
      necessary: true,
      analytics: false,
      marketing: false,
    }));
  });
}

async function mockAssetsManagerApi(page, { authenticated = true } = {}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = { ok: true, data: {} };

    if (url.pathname === '/api/me') {
      body = authenticated
        ? {
            loggedIn: true,
            user: { id: 'assets-ci-user', email: 'assets-ci@example.com', role: 'user' },
          }
        : { loggedIn: false, user: null };
    } else if (url.pathname === '/api/ai/folders') {
      body = {
        ok: true,
        data: {
          folders: [],
          counts: {},
          unfolderedCount: 0,
          storageUsage: STORAGE_USAGE,
        },
      };
    } else if (url.pathname === '/api/ai/assets') {
      body = {
        ok: true,
        data: {
          assets: [],
          next_cursor: null,
          has_more: false,
          applied_limit: 60,
          storageUsage: STORAGE_USAGE,
        },
      };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

const localeCases = [
  {
    name: 'English',
    path: '/account/assets-manager.html',
    privacy: 'Private by default',
    guide: ['Newest first', 'Private library', 'Folders and multi-actions'],
    storageLabel: '"Storage: "',
    helpTitle: 'Mobile asset actions',
    helpDetail: 'move or delete multiple assets',
  },
  {
    name: 'German',
    path: '/de/account/assets-manager.html',
    privacy: 'Standardmäßig privat',
    guide: ['Neueste zuerst', 'Private Bibliothek', 'Ordner und Mehrfachaktionen'],
    storageLabel: '"Speicher: "',
    helpTitle: 'Mobile Asset-Aktionen',
    helpDetail: 'mehrere Assets verschieben oder löschen',
  },
];

test.describe('Assets Manager focused validation', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  for (const localeCase of localeCases) {
    test(`${localeCase.name} mobile layout keeps essential account context and controls`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockAssetsManagerApi(page);

      const response = await page.goto(localeCase.path);
      expect(response.status()).toBe(200);
      await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });

      const state = await page.locator('#studioSavedAssetsCard').evaluate((root) => {
        const storage = root.querySelector('#studioStorageUsage');
        const visibleGuideLabels = [...root.querySelectorAll('.assets-manager__guide-item strong')]
          .map((strong) => [...strong.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE
              || (node.nodeType === Node.ELEMENT_NODE && getComputedStyle(node).display !== 'none'))
            .map((node) => node.textContent.trim())
            .join('')
            .trim());
        return {
          copyDisplay: getComputedStyle(root.querySelector('.assets-manager__copy')).display,
          detailDisplays: [...root.querySelectorAll('.assets-manager__guide-item > span')]
            .map((node) => getComputedStyle(node).display),
          guideLabels: visibleGuideLabels,
          storageLabel: getComputedStyle(storage, '::before').content,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

      expect(state.copyDisplay).toBe('none');
      expect(state.detailDisplays.every((display) => display === 'none')).toBe(true);
      expect(state.guideLabels).toEqual(localeCase.guide);
      expect(state.storageLabel).toBe(localeCase.storageLabel);
      expect(state.overflow).toBeLessThanOrEqual(1);
      await expect(page.locator('#studioStorageUsage')).toHaveText('12 MB / 50 MB');
      await expect(page.locator('.assets-manager__status-pill')).toHaveText(localeCase.privacy);
      await expect(page.locator('#studioViewRefresh')).toBeVisible();
      await expect(page.locator('#studioViewShowAll')).toBeVisible();
      await expect(page.locator('#studioSelectBtn')).toBeAttached();

      await page.locator('#bitbiHelpTrigger').click();
      const assetsHelp = page.locator('#bitbiHelpPanel [data-help-section="assets"]');
      if ((await assetsHelp.getAttribute('open')) === null) {
        await assetsHelp.locator('summary.help-menu__section-toggle').click();
      }
      const mobileActionsHelp = assetsHelp.locator('.help-menu__item').filter({
        hasText: localeCase.helpTitle,
      });
      await mobileActionsHelp.locator('summary.help-menu__item-summary').click();
      await expect(mobileActionsHelp.locator('.help-menu__item-body')).toContainText(localeCase.helpDetail);
    });
  }

  test('mobile success notices use a fresh five-second window for the latest action', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAssetsManagerApi(page);
    await page.goto('/account/assets-manager.html?source=generate-lab&recent=1#generate-lab-recent');
    await expect(page.locator('#studioContent')).toBeVisible({ timeout: 10_000 });
    await page.clock.install();

    const status = page.locator('#assetsHandoffStatus');
    await page.locator('#assetsHandoffShowAll').click();
    await expect(status).toContainText('Showing all saved assets');
    await page.clock.fastForward(4_000);

    await page.locator('#assetsHandoffRefresh').click();
    await expect(status).toContainText('Saved assets refreshed');
    await page.clock.fastForward(1_001);
    await expect(status).toContainText('Saved assets refreshed');
    await page.clock.fastForward(3_999);
    await expect(status).toBeEmpty();

    await page.locator('#assetsHandoffShowAll').click();
    await expect(status).toContainText('Showing all saved assets');
    await page.setViewportSize({ width: 800, height: 900 });
    await page.clock.fastForward(5_000);
    await expect(status).toContainText('Showing all saved assets');
  });

  test('required sign-in guidance remains persistent on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAssetsManagerApi(page, { authenticated: false });
    await page.goto('/account/assets-manager.html');
    await expect(page.locator('#deniedState')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#assetsDeniedTitle')).toHaveText('Sign in to open Assets Manager');

    await page.clock.install();
    await page.clock.fastForward(6_000);
    await expect(page.locator('#deniedState')).toBeVisible();
    await expect(page.locator('#assetsDeniedTitle')).toHaveText('Sign in to open Assets Manager');
  });
});
