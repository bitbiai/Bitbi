const { test, expect } = require('@playwright/test');
const ONE_PX_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a1sAAAAASUVORK5CYII=';

async function installAudioMock(page) {
  await page.addInitScript(() => {
    class MockAudio extends EventTarget {
      constructor() {
        super();
        this.preload = 'auto';
        this._crossOrigin = '';
        this._src = '';
        this._paused = true;
        this._currentTime = 0;
        this._duration = 245;
        this._volume = 0.8;
        this._muted = false;
        this._loop = false;
        this._playbackRate = 1;
        window.__bitbiAudioMock.instances.push(this);
      }

      get crossOrigin() { return this._crossOrigin; }
      set crossOrigin(value) { this._crossOrigin = String(value || ''); }

      get src() { return this._src; }
      set src(value) {
        this._src = String(value || '');
        window.__bitbiAudioMock.sources.push({
          src: this._src,
          crossOrigin: this._crossOrigin,
        });
        if (this._src) {
          queueMicrotask(() => {
            this.dispatchEvent(new Event('loadedmetadata'));
            this.dispatchEvent(new Event('durationchange'));
            this.dispatchEvent(new Event('timeupdate'));
          });
        }
      }

      get paused() { return this._paused; }
      get currentTime() { return this._currentTime; }
      set currentTime(value) {
        this._currentTime = Number(value) || 0;
        this.dispatchEvent(new Event('timeupdate'));
      }

      get duration() { return this._duration; }
      get volume() { return this._volume; }
      set volume(value) {
        this._volume = Number(value) || 0;
        this.dispatchEvent(new Event('volumechange'));
      }

      get muted() { return this._muted; }
      set muted(value) {
        this._muted = !!value;
        this.dispatchEvent(new Event('volumechange'));
      }

      get loop() { return this._loop; }
      set loop(value) { this._loop = !!value; }

      get playbackRate() { return this._playbackRate; }
      set playbackRate(value) {
        this._playbackRate = Number(value) || 1;
        this.dispatchEvent(new Event('ratechange'));
      }

      play() {
        this._paused = false;
        window.__bitbiAudioMock.playCalls += 1;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      }

      pause() {
        this._paused = true;
        window.__bitbiAudioMock.pauseCalls += 1;
        this.dispatchEvent(new Event('pause'));
      }

      load() {
        if (this._src) {
          this.dispatchEvent(new Event('loadedmetadata'));
          this.dispatchEvent(new Event('durationchange'));
        }
      }

      removeAttribute(name) {
        if (name === 'src') this._src = '';
        if (name === 'crossorigin') this._crossOrigin = '';
      }
    }

    window.__bitbiAudioMock = { playCalls: 0, pauseCalls: 0, sources: [], instances: [] };
    window.Audio = MockAudio;
  });
}

async function openGlobalAudioDrawer(page) {
  const handle = page.locator('#globalAudioHandle');
  await expect(handle).toBeVisible();
  await handle.hover();
  await expect(page.locator('#globalAudioPanel')).toBeVisible();
}

async function dismissCookieBanner(page) {
  const rejectAll = page.locator('#ckRejectAll');
  if (await rejectAll.isVisible().catch(() => false)) {
    await rejectAll.click();
  }
}

async function openHomepageSoundLab(page) {
  const stage = page.locator('#homeCategories');
  await expect(stage).toBeVisible();

  const current = await stage.getAttribute('data-active-category');
  if (current === 'sound') return;

  if (current === 'gallery') {
    await stage.locator('[data-category-nav="next"]').click();
    await expect(stage).toHaveAttribute('data-active-category', 'video');
  }

  await stage.locator('[data-category-nav="next"]').click();
  await expect(stage).toHaveAttribute('data-active-category', 'sound');
}

test.describe('Global audio player', () => {
  test('persists track state across hard navigation and reload', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioHandle')).toBeVisible();
    await expect(page.locator('#globalAudioPanel')).not.toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');

    await page.goto('/legal/imprint.html');
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');

    await page.reload();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1')));
    expect(persisted.trackId).toBe('soundlab:cosmic-sea');
    expect(persisted.title).toBe('Cosmic Sea');
  });

  test('global player controls stay synchronized with Sound Lab cards', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();
    await openGlobalAudioDrawer(page);

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('.snd-card').first().locator('.pi')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Paused');

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');
  });

  test('public Sound Lab tracks play without forcing anonymous cross-origin mode', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.sources.at(-1))).toMatchObject({
      src: 'https://pub.bitbi.ai/audio/sound-lab/cosmic-sea.mp3',
      crossOrigin: '',
    });
  });

  test('desktop drawer only opens from the visible handle hit area', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    const panel = page.locator('#globalAudioPanel');
    await expect(panel).not.toBeVisible();

    const rects = await page.evaluate(() => {
      const drawer = document.querySelector('.site-audio__drawer').getBoundingClientRect();
      const handle = document.querySelector('#globalAudioHandle').getBoundingClientRect();
      return {
        drawer: { left: drawer.left, top: drawer.top, width: drawer.width, height: drawer.height },
        handle: { left: handle.left, top: handle.top, width: handle.width, height: handle.height },
      };
    });

    await page.mouse.move(rects.drawer.left + 8, rects.handle.top + rects.handle.height / 2);
    await expect(panel).not.toBeVisible();

    await page.mouse.move(rects.handle.left + rects.handle.width / 2, rects.handle.top + rects.handle.height / 2);
    await expect(panel).toBeVisible();
  });

  test('exclusive Sound Lab tracks still render artwork thumbs from the shared catalog', async ({ page }) => {
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'audio-thumb-user',
            email: 'audio@example.com',
            role: 'user',
          },
        }),
      });
    });

    await page.route('**/api/soundlab-thumbs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
    });

    await page.goto('/');
    await openHomepageSoundLab(page);
    await expect
      .poll(async () => page.locator('#soundLabTracks .excl-thumb').evaluateAll((elements) => (
        elements.some((element) => {
          const src = element.getAttribute('src') || '';
          const display = window.getComputedStyle(element).display;
          return /\/api\/soundlab-thumbs\/thumb-bitbi$/.test(src) && display !== 'none';
        })
      )))
      .toBe(true);
  });
});

test.describe('Global audio player on mobile homepage', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('shows the mobile mini player and menu indicator only while audio is actively playing', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await dismissCookieBanner(page);
    await openHomepageSoundLab(page);
    await expect(page.locator('#globalAudioHandle')).toBeHidden();
    await expect(page.locator('#globalAudioMobileBar')).toBeHidden();
    await expect(page.locator('#globalAudioMenuIndicator')).toBeHidden();

    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect(page.locator('#globalAudioShell')).toBeHidden();
    await expect(page.locator('#globalAudioMobileBar')).toBeHidden();
    await expect(page.locator('#globalAudioHandle')).toBeHidden();
    await expect(page.locator('#globalAudioMenuIndicator')).toBeVisible();
    await expect(page.locator('#globalAudioMenuIndicator')).toHaveClass(/is-active/);

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('#globalAudioMobileBar')).toBeVisible();
    await expect(page.locator('#globalAudioMobileTitle')).toHaveText('Cosmic Sea');

    const placement = await page.evaluate(() => {
      const mobileNav = document.getElementById('mobileNav');
      const footer = mobileNav.querySelector('.mobile-nav__footer');
      const bar = document.getElementById('globalAudioMobileBar');
      const legal = footer.querySelector('.mobile-nav__legal');
      return {
        insideMobileNav: mobileNav.contains(bar),
        insideFooter: footer.contains(bar),
        directlyAboveLegal: bar.nextElementSibling === legal,
        outsideGlobalShell: !document.getElementById('globalAudioShell').contains(bar),
      };
    });
    expect(placement).toEqual({
      insideMobileNav: true,
      insideFooter: true,
      directlyAboveLegal: true,
      outsideGlobalShell: true,
    });

    await page.locator('#globalAudioMobileNext').click();
    await expect(page.locator('#globalAudioMobileTitle')).toHaveText('Zufall und Notwendigkeit');

    await page.locator('#globalAudioMobileToggle').click();
    await expect(page.locator('#globalAudioMobileBar')).toBeHidden();
    await expect(page.locator('#globalAudioMenuIndicator')).toBeHidden();
  });
});
