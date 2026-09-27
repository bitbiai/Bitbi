const { test, expect } = require('@playwright/test');
const { setupAppearance } = require('./helpers/appearance');

for (const locale of ['en','de']) for (const width of [1440,390]) test(`asset preview information ${locale} ${width}: original properties, collapsed lifecycle and media cleanup`, async ({page,baseURL},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await setupAppearance(page,baseURL,{role:'user',media:true});
  const reads=[];
  await page.route('**/api/ai/*/*/details',route=>{
    reads.push(route.request().url());
    const image=route.request().url().includes('/images/');
    return route.fulfill({json:{ok:true,details:{model:'Recorded model',prompt:'The original complete prompt, not the renamed title.',mimeType:image?'image/png':'audio/wav',
      width:image?2048:null,height:image?1536:null,bitrate:image?null:128000,sampleRate:image?null:8000,channels:image?null:1,seed:0}}});
  });
  await page.goto(`${locale==='de'?'/de':''}/account/assets-manager.html`);
  await page.locator('#studioViewShowAll').click();
  const cards=page.locator('.studio__image-item--visual');await expect(cards).toHaveCount(3);
  expect(reads).toEqual([]);expect(state.calls.filter(c=>c.pathname.endsWith('/file'))).toEqual([]);
  for(let index=0;index<3;index++){
    const card=cards.nth(index);
    if(width<500) await page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(index).click();
    const opener=index===0?card:card.locator('.studio__asset-video-trigger');
    // Keyboard activation establishes the focus-return target in both engines;
    // Safari deliberately does not focus buttons on pointer activation.
    await opener.focus();await opener.press('Enter');
    const dialog=page.locator(width<500||index===2?'.mobile-media-detail-overlay':'#studioImageModal.active');
    await expect(dialog).toBeVisible();
    const toggle=dialog.getByRole('button',{name:locale==='de'?'Mehr Informationen':'More information',exact:true});
    const details=dialog.locator('.asset-preview-details');
    await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(details).toBeHidden();
    expect(reads).toHaveLength(index);
    await toggle.click();
    await expect(details).toContainText('The original complete prompt, not the renamed title.');
    await expect(details).toContainText('Recorded model');
    if(index===0) for(const theme of ['light','soft','dark']) {
      state.change({account:theme});await page.evaluate(()=>window.BitbiAppearance.refresh({force:true}));
      for(const paint of await require('./helpers/appearance').measureContrast(dialog.locator('.asset-preview-details__toggle,.asset-preview-details dt,.asset-preview-details dd')))
        expect(paint.ratio,JSON.stringify(paint)).toBeGreaterThanOrEqual(4.5);
    }
    if(index===0) await expect(details).toContainText('2048 × 1536');
    else {
      const media=dialog.locator(index===1?'video':'audio');
      await expect.poll(()=>media.evaluate(m=>Number.isFinite(m.duration)&&m.duration>0)).toBe(true);
      const duration=await media.evaluate(m=>Number(m.duration.toFixed(3)));
      await expect(details).toContainText(`${duration} s`);
      if(index===1) {
        const dimensions=await media.evaluate(m=>`${m.videoWidth} × ${m.videoHeight}`);
        await expect(details).toContainText(dimensions);
      } else {await expect(details).toContainText('128000 bit/s');await expect(details).toContainText('8000 Hz');}
    }
    const close=dialog.locator('.studio-modal__text-close,.asset-preview-details__close');
    const geometry=await toggle.evaluate(el=>{const row=el.parentElement,close=row.querySelector('button');return {more:el.getBoundingClientRect().left,close:close.getBoundingClientRect().left};});
    expect(geometry.more).toBeGreaterThan(geometry.close);
    await toggle.click();await expect(details).toBeHidden();await toggle.click();
    expect(reads).toHaveLength(index+1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`details-${locale}-${width}-${index}.png`)});
    const mediaElement=index?await dialog.locator(index===1?'video':'audio').elementHandle():null;
    await close.click();await expect(dialog).toHaveCount(0);
    if(mediaElement)expect(await mediaElement.evaluate(m=>m.paused&&!m.hasAttribute('src'))).toBe(true);
    await expect(opener).toBeFocused();
  }
  expect(state.unexpectedWrites).toEqual([]);expect(state.errors).toEqual([]);
});

for(const locale of ['en','de']) test(`asset preview information ${locale}: Generate Lab typed view rejects late owner details and marks missing provenance unavailable`,async({page,baseURL})=>{
  const state=await setupAppearance(page,baseURL,{role:'user',media:true});
  let release,reached,first=true;
  const held=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>reached=resolve);
  await page.route('**/api/ai/images/*/details',async route=>{
    if(first){first=false;reached();await held;return route.fulfill({json:{ok:true,details:{prompt:'Old owner secret',model:'Old model'}}});}
    return route.fulfill({json:{ok:true,details:{prompt:null,model:null,mimeType:null,width:null,height:null}}});
  });
  await page.goto(`${locale==='de'?'/de':''}/generate-lab/`);
  await page.locator('#labAssetsOpen').click();
  await page.locator('#labAssetsOverlay .studio__asset-type-toggle').click();
  const group=page.locator('#labAssetsOverlay [data-asset-type-group="image"]');
  await group.locator('summary').click();
  const card=group.locator(`[data-asset-id="${'a'.repeat(32)}"]`);
  await card.focus();await card.press('Enter');
  const dialog=page.locator('#studioImageModal.active'),toggle=dialog.locator('.asset-preview-details__toggle');
  await toggle.click();await requested;
  await page.route('**/api/me',route=>route.fulfill({json:{loggedIn:true,user:{id:'new-owner',role:'user',email:'new@example.invalid'}}}));
  await page.evaluate(async()=>{
    const query=new URL(document.querySelector('script[src*="appearance.js"]').src).search;
    await (await import('/js/shared/auth-state.js'+query)).initAuth();
  });
  release();await expect(toggle).toBeDisabled();
  await expect(dialog.locator('.asset-preview-details')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('Old owner secret');
  await page.keyboard.press('Escape');
  // A new preview has no retained details, even when the server has no provenance.
  await page.goto(`${locale==='de'?'/de':''}/account/assets-manager.html`);
  await page.locator('#studioViewShowAll').click();
  const fresh=page.locator(`[data-asset-id="${'a'.repeat(32)}"]`);await fresh.focus();await fresh.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();
  await expect(dialog.locator('.asset-preview-details')).toContainText(locale==='de'?'Nicht verfügbar':'Unavailable');
  await expect(dialog.locator('.asset-preview-details')).not.toContainText('Colour study');
  expect(state.unexpectedWrites).toEqual([]);
});

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

function buildWavBuffer({ durationSeconds = 4, sampleRate = 8000 } = {}) {
  const samples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const bytesPerSample = 2;
  const dataSize = samples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.floor(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 12000);
    buffer.writeInt16LE(sample, 44 + (i * bytesPerSample));
  }
  return buffer;
}


async function mockAssetsManagerApi(page, { authenticated = true, assets = [], requests = [] } = {}) {
  assets = structuredClone(assets);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push({path:url.pathname,method:route.request().method(),...(url.searchParams.has('asset_type') ? {type:url.searchParams.get('asset_type'),cursor:url.searchParams.get('cursor')} : {})});
    if(url.pathname.endsWith('/poster') || url.pathname.endsWith('/thumb')) return route.fulfill({status:200,contentType:'image/webp',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/media/member-video-poster.webp'))});
    if(url.pathname.endsWith('/file') && url.pathname.includes('/images/')) return route.fulfill({status:200,contentType:'image/png',body:require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/media/member-image.png'))});
    if(url.pathname.includes('/card-music') && url.pathname.endsWith('/file')) return route.fulfill({status:200,contentType:'audio/wav',body:buildWavBuffer()});
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
      const type = url.searchParams.get('asset_type');
      const matching = type ? assets.filter(asset => asset.asset_type === type) : assets;
      const offset = Number((url.searchParams.get('cursor') || '').split(':').at(-1)) || 0;
      const limit = Number(url.searchParams.get('limit')) || 60;
      const more = matching.length > offset + limit;
      body = {
        ok: true,
        data: {
          assets: matching.slice(offset, offset + limit),
          next_cursor: more ? `${type || 'all'}:${offset + limit}` : null,
          has_more: more,
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
    storageLabel: '"Storage: "',
    helpTitle: 'Mobile asset actions',
    helpDetail: 'move or delete multiple assets',
  },
  {
    name: 'German',
    path: '/de/account/assets-manager.html',
    privacy: 'Standardmäßig privat',
    storageLabel: '"Speicher: "',
    helpTitle: 'Mobile Asset-Aktionen',
    helpDetail: 'mehrere Assets verschieben oder löschen',
  },
];

test.describe('Assets Manager focused validation', () => {
  test.beforeEach(async ({ page }) => {
    await seedCookieConsent(page);
  });

  for (const localeCase of localeCases) for (const width of [390, 1280]) {
    test(`${localeCase.name} type groups independently paginate more than 60 interleaved assets at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const requests = [];
      const assets = [{ id: 'latest-text', asset_type: 'text', title: 'Retained text', preview_text: 'Still available', created_at: '2026-09-27T12:00:00Z' }];
      for (let i = 0; i < 65; i++) for (const type of ['image', 'video', 'sound']) assets.push({
        id: `${type}-${i}`, asset_type: type, title: `${type} ${i}`, prompt: `${type} ${i}`,
        created_at: new Date(Date.UTC(2026, 8, 27, 11, 59 - i)).toISOString(),
        mime_type: type === 'image' ? 'image/png' : type === 'video' ? 'video/mp4' : 'audio/wav',
        derivatives_status: 'pending', visibility: 'private', size_bytes: 100,
      });
      await mockAssetsManagerApi(page, { assets, requests });
      await page.goto(localeCase.path);
      const toggle = page.locator('.studio__asset-type-toggle');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('[data-asset-type-group]')).toHaveCount(0);
      await toggle.click();
      await expect(page.locator('[data-asset-type-group]')).toHaveCount(3);
      expect(requests.filter(r => r.path === '/api/ai/assets')).toHaveLength(0);
      for (const type of ['image', 'video', 'sound']) {
        const group = page.locator(`[data-asset-type-group="${type}"]`);
        await group.locator('summary').click();
        await expect(group.locator('[data-asset-id]')).toHaveCount(60);
        await expect(group.locator('[data-asset-id]').first()).toHaveAttribute('data-asset-id', `${type}-0`);
        await group.locator('button.studio__pagination-btn').click();
        await expect(group.locator('[data-asset-id]')).toHaveCount(65);
        await expect(group.locator('[data-asset-id]').last()).toHaveAttribute('data-asset-id', `${type}-64`);
        await expect(group).toHaveAttribute('open', '');
      }
      await expect(page.locator('[data-asset-type-group][open]')).toHaveCount(3);
      await page.locator('[data-asset-type-group="video"] summary').click();
      await expect(page.locator('[data-asset-type-group][open]')).toHaveCount(2);
      expect(requests.filter(r => r.path === '/api/ai/assets').map(r => r.type)).toEqual(['image','image','video','video','sound','sound']);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('[data-asset-type-group]')).toHaveCount(0);
      await expect(page.locator('[data-asset-id="latest-text"]')).toBeAttached();
    });
  }

  for (const localeCase of localeCases) test(`${localeCase.name} type groups recover independently and ignore an obsolete response`, async ({ page }) => {
    await mockAssetsManagerApi(page);
    let releaseImage;
    const waitingImage = new Promise(resolve => { releaseImage = resolve; });
    let videoCalls = 0;
    await page.route('**/api/ai/assets?*', async route => {
      const type = new URL(route.request().url()).searchParams.get('asset_type');
      if (type === 'image') await waitingImage;
      if (type === 'video' && ++videoCalls === 1) return route.fulfill({ status: 503, json: { ok: false, error: 'Synthetic read unavailable' } });
      return route.fulfill({ json: { ok: true, data: { assets: type ? [{id:`delayed-${type}`,asset_type:type,prompt:'Synthetic',title:'Synthetic',mime_type:type==='image'?'image/png':'video/mp4'}] : [],has_more:false } } });
    });
    await page.goto(localeCase.path);
    const toggle = page.locator('.studio__asset-type-toggle');
    await toggle.click();
    const images = page.locator('[data-asset-type-group="image"]'), videos = page.locator('[data-asset-type-group="video"]');
    await images.locator('summary').click();
    await expect(images).toHaveAttribute('aria-busy', 'true');
    await videos.locator('summary').click();
    await expect(videos.getByRole('status')).not.toBeEmpty();
    await videos.locator('button').click();
    await expect(videos.locator('[data-asset-id]')).toHaveCount(1);
    await expect(images).toHaveAttribute('open', '');
    await expect(images).toHaveAttribute('aria-busy', 'true');
    await toggle.click();
    releaseImage();
    await expect(page.locator('[data-asset-type-group]')).toHaveCount(0);
    await expect(page.locator('[data-asset-id="delayed-image"]')).toHaveCount(0);
    expect(videoCalls).toBe(2);
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
        return {
          storageLabel: getComputedStyle(storage, '::before').content,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

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
  {id:'card-music',asset_type:'sound',title:'My manual music title',file_name:'my-manual-music.wav',file_url:'/api/ai/text-assets/card-music/file',poster_url:'/api/ai/text-assets/card-music/poster',poster_status:'ready',visibility:'private',mime_type:'audio/wav'},
  {id:'card-music-bare',asset_type:'sound',title:'My published track without cover',file_name:'my-published-track.wav',file_url:'/api/ai/text-assets/card-music-bare/file',poster_status:'pending',visibility:'public',mime_type:'audio/wav'},
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
      expect(squares).toHaveLength(5);
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
  await page.locator('#labImageModel').selectOption('pixverse/v6');
  await page.locator('#labVideoReferenceTrigger').click();
  await page.locator('[data-reference-source-action="assets"]').click();
  await page.locator('#labAssetsOverlay .studio__asset-type-toggle').click();
  await page.locator('#labAssetsGrid [data-asset-type-group="image"] summary').click();
  const image=page.locator('#labAssetsGrid [data-asset-id="card-image"]');
  await expect(image).toBeVisible();
  await expect(image.locator('.studio__card-menu')).toBeHidden();
  await image.click();
  await expect(image).toHaveAttribute('data-reference-picker-order','1');
  await expect(image.locator('.studio__reference-order-badge')).toHaveText('1');
  await page.locator('#labAssetsPickerApply').click();
  await expect(page.locator('#labVideoReferenceLabel')).toHaveText(CARD_ASSETS[0].title);
  expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
  expect(requests.filter(r=>r.path.includes('/text-assets/')&&r.path.endsWith('/file'))).toEqual([]);
});

for (const locale of ['en','de']) test(`typed music cards ${locale}: mobile playback and keyboard owner action`, async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await seedCookieConsent(page);
  const requests=[]; await mockAssetsManagerApi(page,{assets:CARD_ASSETS,requests});
  await page.goto(`${locale==='de'?'/de':''}/account/assets-manager.html`);
  await page.locator('.studio__asset-type-toggle').click();
  await page.locator('[data-asset-type-group="sound"] summary').click();
  const music=page.locator('[data-asset-id="card-music-bare"]');
  await music.locator('.studio__asset-video-trigger').click();
  const dialog=page.locator('.mobile-media-detail-overlay');
  await expect(dialog).toBeVisible();
  await expect.poll(()=>dialog.locator('audio').evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await music.locator('.studio__card-menu').click();
  let confirmations=0; page.on('dialog',async dialog=>{confirmations++;await dialog.dismiss();});
  await music.locator('.studio__image-delete').focus(); await page.keyboard.press('Enter');
  expect(confirmations).toBe(1); expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

for (const [locale,narrow] of [['en',false],['de',true]]) test(`shared music cards ${locale}: cover, actions, native playback and cleanup`,async({browser},testInfo)=>{
  const context=await browser.newContext({viewport:{width:narrow?390:1280,height:narrow?844:900},hasTouch:narrow});
  const page=await context.newPage();
  try {
    await seedCookieConsent(page);const requests=[];
    await mockAssetsManagerApi(page,{assets:CARD_ASSETS,requests});
    await page.goto(`${locale==='de'?'/de':''}/account/assets-manager.html?source=generate-lab&recent=1`);
    await page.locator('#studioViewShowAll').click();
    const cards=page.locator('.studio__image-item--visual');await expect(cards).toHaveCount(5);
    for(let i=0;i<4;i++){
      const card=cards.nth(i);
      if(narrow) await page.locator('#studioImageGrid + .studio-deck-dots .studio-deck-dot').nth(i).click();
      await card.locator('.studio__card-menu').click();
      await expect(card.locator('.studio__card-menu')).not.toHaveText(/•|\.\.\./);
      await expect(card.locator('.studio__card-menu')).toHaveAttribute('aria-label',new RegExp(locale==='de'?'Weitere Aktionen':'More actions'));
      await expect(card.locator('.studio__card-actions')).toHaveCSS('opacity','1');
      if(narrow) {
        await expect(card).toHaveCSS('transform','matrix(0.9, 0, 0, 0.9, 0, 0)');
        await expect(card.locator('.studio__card-actions button').first()).toHaveCSS('font-size','10px');
      }
      const bounds=await card.evaluate(c=>{const r=c.getBoundingClientRect();return {square:Math.abs(r.width-r.height)<=2, buttons:[...c.querySelectorAll('.studio__card-actions button,.studio__card-menu')].map(b=>{const q=b.getBoundingClientRect();return {inside:q.left>=r.left&&q.right<=r.right&&q.top>=r.top&&q.bottom<=r.bottom,width:q.width,height:q.height,cssWidth:b.offsetWidth,cssHeight:b.offsetHeight};})};});
      expect(bounds.square,JSON.stringify({i,bounds})).toBe(true);expect(bounds.buttons.every(b=>b.inside&&b.width>=44&&b.height>=44),JSON.stringify({i,bounds})).toBe(true);
      await expect(card.locator('.studio__card-play')).toHaveCount(i===0?0:1);
      await expect(card.locator('.studio__asset-badge')).toHaveCount(0);
      if(i>=2) {
        await expect(card.locator('audio,.studio__asset-title')).toHaveCount(0);
        await expect(card.locator(i===2?'.studio__asset-poster':'.studio__asset-sound-fallback')).toBeVisible();
      }
      await page.screenshot({path:testInfo.outputPath(`music-${locale}-${i}.png`),fullPage:true});
    }
    expect(requests.filter(r=>r.path.endsWith('/file')||r.method!=='GET')).toEqual([]);
    const music=page.locator('[data-asset-id="card-music-bare"]');
    // Published state keeps unpublish; disclosure/actions cannot start audio.
    await expect(music.locator('.studio__image-publish')).toHaveText(locale==='de'?'Zurücknehmen':'Unpublish');
    await music.locator('.studio__image-delete').focus();let confirmations=0;
    page.on('dialog',async d=>{confirmations++;await d.dismiss();});await page.keyboard.press('Enter');expect(confirmations).toBe(1);
    expect(requests.filter(r=>r.path.endsWith('/file')||r.method!=='GET')).toEqual([]);
    await music.locator('.studio__image-publish').click();
    await expect(music.locator('.studio__image-visibility')).toHaveText(locale==='de'?'Privat':'Private');
    expect(requests.filter(r=>r.method!=='GET')).toEqual([{path:'/api/ai/text-assets/card-music-bare/publication',method:'PATCH'}]);
    expect(requests.filter(r=>r.path.endsWith('/file'))).toEqual([]);requests.length=0;
    if(!narrow) {
      await page.locator('#studioSelectBtn').click();
      await music.locator('.studio__asset-video-trigger').click();
      await expect(music).toHaveAttribute('aria-pressed','true');
      expect(requests.filter(r=>r.path.endsWith('/file')||r.method!=='GET')).toEqual([]);
      await page.locator('#studioBulkCancel').click();
    }
    await music.locator('.studio__asset-video-trigger').click();
    const dialog=page.locator('.mobile-media-detail-overlay');await expect(dialog).toBeVisible();
    const audio=dialog.locator('audio');await expect(audio).toHaveAttribute('controls','');
    await expect.poll(()=>audio.evaluate(a=>!a.paused&&a.currentTime>0)).toBe(true);
    await expect(dialog).toContainText('My published track without cover');
    await audio.evaluate(a=>a.pause());expect(await audio.evaluate(a=>a.paused)).toBe(true);
    await audio.evaluate(a=>a.play());await expect.poll(()=>audio.evaluate(a=>!a.paused)).toBe(true);
    const element=await audio.elementHandle();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    expect(await element.evaluate(a=>a.paused&&!a.hasAttribute('src'))).toBe(true);
    await expect(music.locator('.studio__asset-video-trigger')).toBeFocused();
    expect(requests.filter(r=>r.method!=='GET')).toEqual([]);
  } finally {await context.close();}
});
