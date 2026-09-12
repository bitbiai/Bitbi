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

async function mockAssetsManagerApi(page, { authenticated = true, assets = [], requests = [] } = {}) {
  assets = structuredClone(assets);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push({path:url.pathname,method:route.request().method()});
    if(url.pathname.endsWith('/poster') || url.pathname.endsWith('/thumb')) return route.fulfill({status:200,contentType:'image/webp',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/media/member-video-poster.webp'))});
    if(url.pathname.endsWith('/file') && url.pathname.includes('/images/')) return route.fulfill({status:200,contentType:'image/png',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/media/member-image.png'))});
    if(url.pathname.endsWith('/file')) return route.fulfill({status:200,contentType:'video/mp4',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/media/test-video-changing.mp4'))});
    let body = { ok: true, data: {} };
    if(url.pathname.endsWith('/publication')) {
      const asset=assets.find(a=>url.pathname.includes('/'+a.id+'/'));
      asset.visibility=route.request().postDataJSON().visibility;
      asset.is_public=asset.visibility==='public';
      body.data=asset;
    }

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
          unfolderedCount: assets.length,
          storageUsage: STORAGE_USAGE,
        },
      };
    } else if (url.pathname === '/api/ai/assets') {
      body = {
        ok: true,
        data: {
          assets,
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
      // WebKit retains separate CSS content strings; Chromium combines them.
      const textContent = value => [...value.matchAll(/"([^"\n]*)"/g)].map(m=>m[1]).join('');
      expect(textContent(state.storageLabel)).toBe(textContent(localeCase.storageLabel));
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


const CARD_ASSETS = [
  {id:'card-image',asset_type:'image',title:'My deliberately long manually named landscape in the evening',prompt:'My deliberately long manually named landscape in the evening',thumb_url:'/api/ai/images/card-image/thumb',original_url:'/api/ai/images/card-image/file',medium_url:'/api/ai/images/card-image/thumb',visibility:'private'},
  {id:'card-video',asset_type:'video',title:'My deliberately long manual video title remains available in the player',file_name:'my-deliberately-long-manual-video-title.mp4',file_url:'/api/ai/text-assets/card-video/file',poster_url:'/api/ai/text-assets/card-video/poster',poster_status:'ready',visibility:'private',mime_type:'video/mp4',size_bytes:10000,created_at:'2026-09-12T10:00:00Z'},
  {id:'card-pending',asset_type:'video',title:'a little worm',file_name:'a-little-worm.mp4',file_url:'/api/ai/text-assets/card-pending/file',poster_status:'pending',visibility:'public',mime_type:'video/mp4'},
];

for (const locale of ['en','de']) for (const narrow of [false,true]) {
  test(`shared asset cards ${locale} ${narrow?'touch':'desktop'}: square previews and isolated actions`, async ({browser},testInfo) => {
    const context=await browser.newContext({viewport:{width:narrow?390:1280,height:narrow?844:900},hasTouch:narrow});
    const page=await context.newPage();
    try {
      await seedCookieConsent(page);
      const requests=[];
      await mockAssetsManagerApi(page,{assets:CARD_ASSETS,requests});
      await page.goto(`${locale==='de'?'/de':''}/account/assets-manager.html?source=generate-lab&recent=1`);
      await page.locator('#studioViewShowAll').click();
      const image=page.locator('[data-asset-id="card-image"]');
      const video=page.locator('[data-asset-id="card-video"]');
      await expect(image).toBeVisible(); await expect(video).toBeAttached();
      const squares=await page.locator('.studio__image-item--visual').evaluateAll(cards=>cards.map(c=>({w:c.offsetWidth,h:c.offsetHeight,type:c.dataset.assetType})));
      expect(squares).toHaveLength(3);
      for(const box of squares) expect(Math.abs(box.w-box.h),JSON.stringify(box)).toBeLessThanOrEqual(2);
      expect(requests.filter(r=>r.path.endsWith('/file'))).toEqual([]);
      await expect(video.locator('video')).toHaveCount(0);
      // Inspect every action rectangle after the explicit disclosure, including
      // the mobile deck's active card; no concurrent player or selection action.
      for (const card of [image,video]) {
        await card.scrollIntoViewIfNeeded();
        if(narrow) {
          // Existing deck's public dots bring the current card into view.
          const index=card===image?0:1;
          const dots=page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot');
          if(await dots.count()>index) await dots.nth(index).click();
          await card.locator('.studio__card-menu').click();
        } else await card.hover();
        await expect(card.locator('.studio__card-actions')).toHaveCSS('opacity','1');
        const bounds=await card.evaluate(c=>{
          const r=c.getBoundingClientRect();
          return [...c.querySelectorAll('.studio__card-actions button')].map(b=>{const q=b.getBoundingClientRect();return {inside:q.left>=r.left&&q.right<=r.right&&q.top>=r.top&&q.bottom<=r.bottom,w:b.offsetWidth,h:b.offsetHeight,label:b.getAttribute('aria-label'),overflow:b.scrollWidth>b.clientWidth};});
        });
        for(const b of bounds){expect(b.inside,JSON.stringify(b)).toBe(true);expect(b.h).toBeGreaterThanOrEqual(44);expect(b.w).toBeGreaterThanOrEqual(44);expect(b.label).toBeTruthy();expect(b.overflow).toBe(false);}
      }
      await expect(video).toHaveAttribute('title',CARD_ASSETS[1].title);
      await video.locator('.studio__image-delete').focus();
      let confirmation=0;
      page.on('dialog',async d=>{confirmation++;await d.dismiss();});
      await page.keyboard.press('Enter');
      expect(confirmation).toBe(1);
      expect(requests.filter(r=>r.path.endsWith('/file')||r.method!=='GET')).toEqual([]);
      await expect(page.locator('.studio-modal.active')).toHaveCount(0);
      await page.screenshot({path:testInfo.outputPath(`asset-cards-${locale}-${narrow?'mobile':'desktop'}.png`),fullPage:true});
      await video.locator('.studio__image-publish').click();
      await expect(video.locator('.studio__image-visibility')).toHaveText(locale==='de'?'Öffentlich':'Public');
      await expect(video.locator('.studio__card-menu')).toHaveAttribute('aria-expanded','true');
      await expect(video.locator('.studio__card-actions')).toHaveCSS('pointer-events','auto');
      expect(requests.filter(r=>r.method!=='GET')).toEqual([{path:'/api/ai/text-assets/card-video/publication',method:'PATCH'}]);
      expect(requests.filter(r=>r.path.endsWith('/file'))).toEqual([]);
      requests.length=0;
      if(narrow) await page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(1).click();
      else {
        await page.locator('#studioSelectBtn').click();
        await expect(video.locator('.studio__card-menu')).toBeHidden();
        await video.locator('.studio__asset-video-trigger').click();
        await expect(video).toHaveAttribute('aria-pressed','true');
        expect(requests.filter(r=>r.path.endsWith('/file')||r.method!=='GET')).toEqual([]);
        await page.locator('#studioBulkCancel').click();
      }
      await video.locator('.studio__asset-video-trigger').click();
      await expect.poll(()=>requests.some(r=>r.path==='/api/ai/text-assets/card-video/file')).toBe(true);
      expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
    } finally {await context.close();}
  });
}

for(const locale of ['en','de']) test(`shared asset cards ${locale}: Generate Lab reuses square cards and the reference picker`,async({page})=>{
  await page.setViewportSize({width:1440,height:980});await seedCookieConsent(page);
  const requests=[];await mockAssetsManagerApi(page,{assets:CARD_ASSETS,requests});
  await page.goto(`${locale==='de'?'/de':''}/generate-lab/`);
  await page.locator('#labAssetsOpen').click();
  await page.locator('#labAssetsFolderGrid .studio__folder-card').first().click();
  const video=page.locator('#labAssetsGrid [data-asset-id="card-video"]');
  await expect(video).toBeVisible();
  const shape=await video.evaluate(c=>[c.offsetWidth,c.offsetHeight]);
  expect(Math.abs(shape[0]-shape[1])).toBeLessThanOrEqual(2);
  await video.focus();
  await page.keyboard.press('Escape');
  await page.locator('[data-media-type="video"]').click();
  await page.locator('#labVideoReferenceTrigger').click();
  await page.locator('[data-reference-source-action="assets"]').click();
  const image=page.locator('#labAssetsGrid [data-asset-id="card-image"]');
  await expect(image).toBeVisible();
  await expect(image.locator('.studio__card-menu')).toBeHidden();
  await image.click();
  await expect(image).toHaveAttribute('data-reference-picker-order','1');
  await page.locator('#labAssetsPickerApply').click();
  await expect(page.locator('#labVideoReferenceLabel')).toHaveText(CARD_ASSETS[0].title);
  expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
  expect(requests.filter(r=>r.path.includes('/text-assets/')&&r.path.endsWith('/file'))).toEqual([]);
});
