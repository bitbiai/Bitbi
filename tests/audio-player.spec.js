const { test, expect } = require('@playwright/test');
const ONE_PX_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a1sAAAAASUVORK5CYII=';

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
    await rejectAll.click({ force: true });
  }
}

async function routeDefaultMemtracks(page, {
  id = 'feedc0de',
  version = 'vpub',
  title = 'Public Member Track',
  audioBody = Buffer.from('mock-audio'),
  audioContentType = 'audio/mpeg',
  durationSeconds = 245,
} = {}) {
  await page.route('**/api/public/news-pulse**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], updated_at: '2026-05-09T08:00:00.000Z' }),
    });
  });

  await page.route(/\/api\/gallery\/memtracks(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          items: [
            {
              id,
              slug: `memtrack-${id}`,
              title,
              caption: 'Published by Ada Member.',
              category: 'memtracks',
              publisher: { display_name: 'Ada Member' },
              file: { url: `/api/gallery/memtracks/${id}/${version}/file` },
              poster: {
                url: `/api/gallery/memtracks/${id}/${version}/poster`,
                w: 320,
                h: 320,
              },
              duration_seconds: durationSeconds,
            },
          ],
          has_more: false,
          next_cursor: null,
          applied_limit: 60,
        },
      }),
    });
  });

  await page.route('**/api/gallery/memtracks/**', async (route) => {
    if (route.request().url().endsWith('/poster')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(ONE_PX_PNG_BASE64, 'base64'),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: audioContentType,
      body: audioBody,
    });
  });
}

async function getMobilePlayerMetrics(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('globalAudioMobileBar');
    const status = document.getElementById('globalAudioMobileStatus');
    const elapsed = document.getElementById('globalAudioMobileElapsed');
    const duration = document.getElementById('globalAudioMobileDuration');
    const progress = document.getElementById('globalAudioMobileProgress');
    const fill = document.getElementById('globalAudioMobileProgressFill');
    const progressRect = progress?.getBoundingClientRect();
    const fillRect = fill?.getBoundingClientRect();
    const progressStyle = progress ? window.getComputedStyle(progress) : null;
    const fillStyle = fill ? window.getComputedStyle(fill) : null;
    return {
      barVisible: !!bar && !bar.hidden && bar.getBoundingClientRect().width > 0 && bar.getBoundingClientRect().height > 0,
      statusText: status?.textContent || '',
      elapsedText: elapsed?.textContent || '',
      durationText: duration?.textContent || '',
      progressDisabled: !!progress?.disabled,
      progressWidth: progressRect?.width || 0,
      progressHeight: progressRect?.height || 0,
      progressDisplay: progressStyle?.display || '',
      progressVisibility: progressStyle?.visibility || '',
      progressOpacity: progressStyle?.opacity || '',
      progressPointerEvents: progressStyle?.pointerEvents || '',
      fillWidth: fillRect?.width || 0,
      fillHeight: fillRect?.height || 0,
      fillInlineSize: fillStyle?.inlineSize || '',
      fillStyleWidth: fill?.style.width || '',
      fillStyleInlineSize: fill?.style.inlineSize || '',
      progressPercent: Number(progress?.dataset.progressPercent || 0),
    };
  });
}

async function openHomepageSoundLab(page) {
  const stage = page.locator('#homeCategories');
  await expect(stage).toBeVisible();

  const stageMode = await stage.getAttribute('data-stage-mode');
  if (stageMode !== 'desktop') {
    const soundLab = page.locator('#soundlab');
    await soundLab.scrollIntoViewIfNeeded();
    await expect(soundLab).toBeVisible();
    return;
  }

  const current = await stage.getAttribute('data-active-category');
  if (current === 'sound') return;

  await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
  await expect(stage).toHaveAttribute('data-active-category', 'sound');
}

async function clickSoundLabPlayButton(page, button) {
  await expect(button).toBeVisible();
  await button.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(button).toBeVisible();
  await button.evaluate((element) => element.click());
}

test.describe('Global audio player', () => {
  test.beforeEach(async ({ page }) => {
    await routeDefaultMemtracks(page);
  });

  test('desktop player stays hidden on homepage load until playback starts', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await expect(page.locator('#globalAudioShell')).toBeHidden();
    await expect(page.locator('#globalAudioHandle')).toBeHidden();

    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);

    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioHandle')).toBeVisible();
  });

  test('persists track state across hard navigation and reload', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);

    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioHandle')).toBeVisible();
    await expect(page.locator('#globalAudioPanel')).not.toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Public Member Track');
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');

    await page.goto('/legal/imprint.html');
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Public Member Track');

    await page.reload();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioTitle')).toHaveText('Public Member Track');

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1')));
    expect(persisted.trackId).toBe('memtrack:feedc0de');
    expect(persisted.title).toBe('Public Member Track');
  });

  test('suspends the outgoing page audio element during navigation without clearing play intent', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    await clickSoundLabPlayButton(page, page.locator('.snd-play').first());
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.paused)).toBe(false);

    await page.evaluate(() => {
      window.__bitbiAudioMock.instances[0].currentTime = 52;
    });
    const before = await page.evaluate(() => ({
      playCalls: window.__bitbiAudioMock.playCalls,
      pauseCalls: window.__bitbiAudioMock.pauseCalls,
    }));

    await page.evaluate(() => {
      const event = typeof PageTransitionEvent === 'function'
        ? new PageTransitionEvent('pagehide', { persisted: true })
        : new Event('pagehide');
      window.dispatchEvent(event);
    });

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.paused)).toBe(true);
    expect(await page.evaluate(() => window.__bitbiAudioMock.pauseCalls)).toBe(before.pauseCalls + 1);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1')));
    expect(persisted).toEqual(expect.objectContaining({
      trackId: 'memtrack:feedc0de',
      playIntent: true,
      currentTime: 52,
    }));

    await page.evaluate(() => {
      const event = typeof PageTransitionEvent === 'function'
        ? new PageTransitionEvent('pageshow', { persisted: true })
        : new Event('pageshow');
      window.dispatchEvent(event);
    });

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.paused)).toBe(false);
    expect(await page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(before.playCalls + 1);
  });

  test('returning to Sound Lab reuses the shared player for the active track', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    await clickSoundLabPlayButton(page, page.locator('.snd-play').first());
    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();

    await page.goto('/legal/imprint.html');
    await expect(page.locator('#globalAudioShell')).toBeVisible();

    await page.goto('/');
    await openHomepageSoundLab(page);
    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();

    const before = await page.evaluate(() => ({
      playCalls: window.__bitbiAudioMock.playCalls,
      instances: window.__bitbiAudioMock.instances.length,
    }));
    await clickSoundLabPlayButton(page, page.locator('.snd-play').first());

    await expect(page.locator('.snd-card').first().locator('.pi')).toBeVisible();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioStatus')).toContainText('Paused');
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(before.playCalls);
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances.length)).toBe(before.instances);
  });

  test('global player controls stay synchronized with Sound Lab cards', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);

    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();
    await openGlobalAudioDrawer(page);

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('.snd-card').first().locator('.pi')).toBeVisible();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Paused');

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');
  });

  test('public Sound Lab Memtracks play without forcing anonymous cross-origin mode', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.sources.at(-1)?.crossOrigin)).toBe('');
    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.sources.at(-1)?.src || ''))
      .toContain('/api/gallery/memtracks/feedc0de/vpub/file');
  });

  test('Sound Lab timeline seeking does not restart the current Memtrack', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1') || '{}').duration || 0))
      .toBeGreaterThan(0);

    const playCallsBeforeSeek = await page.evaluate(() => window.__bitbiAudioMock.playCalls);
    const bar = page.locator('#soundLabTracks .snd-card--memtrack .snd-bar').first();
    await bar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width * 0.55),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
    });

    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.currentTime || 0))
      .toBeGreaterThan(100);
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(playCallsBeforeSeek);
    await expect
      .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1') || '{}').trackId || ''))
      .toBe('memtrack:feedc0de');
  });

  test('switching homepage sections does not restart the playing Memtrack', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    await clickSoundLabPlayButton(page, page.locator('.snd-play').first());
    await page.evaluate(() => {
      window.__bitbiAudioMock.instances[0].currentTime = 83;
    });
    const playCallsBeforeSwitch = await page.evaluate(() => window.__bitbiAudioMock.playCalls);

    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'gallery');
    await page.locator('#navbar .site-nav__links').getByRole('link', { name: 'Sound Lab' }).click();
    await expect(page.locator('#homeCategories')).toHaveAttribute('data-active-category', 'sound');

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(playCallsBeforeSwitch);
    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.currentTime || 0))
      .toBe(83);
  });

  test('desktop player stays visible after playback ends and closes only from dismiss control', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const lastPlay = page.locator('.snd-play').last();
    await clickSoundLabPlayButton(page, lastPlay);

    await expect(page.locator('#globalAudioShell')).toBeVisible();

    await page.evaluate(() => {
      window.__bitbiAudioMock.instances[0]?.dispatchEvent(new Event('ended'));
    });

    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await openGlobalAudioDrawer(page);
    await expect(page.locator('#globalAudioStatus')).toContainText('Paused');
    await expect.poll(async () => page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('bitbi_audio_state_v1'));
      return snapshot?.playIntent ?? null;
    })).toBe(false);

    await page.locator('#globalAudioDismiss').click();
    await expect(page.locator('#globalAudioShell')).toBeHidden();

    await page.reload();
    await expect(page.locator('#globalAudioShell')).toBeHidden();
    await expect(page.locator('#globalAudioHandle')).toBeHidden();
  });

  test('desktop drawer only opens from the visible handle hit area', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await openHomepageSoundLab(page);
    const firstPlay = page.locator('.snd-play').first();
    await clickSoundLabPlayButton(page, firstPlay);

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

  test('Sound Lab no longer renders Free or Exclusive category surfaces', async ({ page }) => {
    await page.goto('/');
    await openHomepageSoundLab(page);
    await expect(page.locator('#soundlab .snd-filter-btn')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .snd-card--free')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .locked-area')).toHaveCount(0);
    await expect(page.locator('#soundLabTracks .snd-card--memtrack').first()).toBeVisible();
  });
});

test.describe('Global audio player on mobile homepage', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await routeDefaultMemtracks(page);
  });

  test('shows the mobile mini player only inside the menu from shared playback state until explicit close', async ({ page }) => {
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

    const placement = await page.evaluate(() => {
      const mobileNav = document.getElementById('mobileNav');
      const mobileFooter = document.querySelector('#mobileNav .mobile-nav__footer');
      const bar = document.getElementById('globalAudioMobileBar');
      return {
        insideMobileNav: mobileNav.contains(bar),
        insideMobileFooter: mobileFooter.contains(bar),
        afterGlobalShell: document.getElementById('globalAudioShell').nextElementSibling === bar,
        outsideGlobalShell: !document.getElementById('globalAudioShell').contains(bar),
      };
    });
    expect(placement).toEqual({
      insideMobileNav: true,
      insideMobileFooter: true,
      afterGlobalShell: false,
      outsideGlobalShell: true,
    });

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('#globalAudioMobileBar')).toBeVisible();
    await expect(page.locator('#globalAudioMobileTitle')).toHaveText('Public Member Track');

    await expect(page.locator('#globalAudioMobileNext')).toBeDisabled();
    await expect(page.locator('#globalAudioMobileTitle')).toHaveText('Public Member Track');

    await page.evaluate(() => {
      const audio = window.__bitbiAudioMock.instances[0];
      audio._currentTime = 61;
      audio._duration = 245;
    });
    await expect(page.locator('#globalAudioMobileStatus')).toContainText('1:01 / 4:05');
    await expect.poll(async () => {
      const metrics = await getMobilePlayerMetrics(page);
      return metrics.progressWidth > 100
        && metrics.progressHeight >= 8
        && metrics.fillWidth > 20
        && metrics.fillHeight >= 8
        && metrics.fillStyleInlineSize !== ''
        && metrics.elapsedText === '1:01'
        && metrics.durationText === '4:05'
        && !metrics.progressDisabled;
    }).toBe(true);
    const playCallsBeforeSeek = await page.evaluate(() => window.__bitbiAudioMock.playCalls);
    const mobileProgress = page.locator('#globalAudioMobileProgress');
    await mobileProgress.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width * 0.72),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
    });
    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.currentTime || 0))
      .toBeGreaterThan(170);
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(playCallsBeforeSeek);

    await page.locator('#globalAudioMobileToggle').click();
    await expect(page.locator('#globalAudioMobileBar')).toBeVisible();
    await expect(page.locator('#globalAudioMobileStatus')).toContainText('Paused');
    await expect(page.locator('#globalAudioMenuIndicator')).toBeVisible();
    await expect(page.locator('#globalAudioMenuIndicator')).not.toHaveClass(/is-active/);

    await page.locator('#globalAudioMobileDismiss').click();
    await expect(page.locator('#globalAudioMobileBar')).toBeHidden();
    await expect(page.locator('#globalAudioMenuIndicator')).toBeHidden();
  });

  test('keeps mobile playback state through menu section navigation', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    await dismissCookieBanner(page);
    await openHomepageSoundLab(page);
    await page.locator('.snd-play').first().click();
    await page.evaluate(() => {
      const audio = window.__bitbiAudioMock.instances[0];
      audio._currentTime = 74;
      audio._duration = 245;
    });
    await expect(page.locator('#globalAudioMenuIndicator')).toHaveClass(/is-active/);
    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?._currentTime || 0))
      .toBe(74);
    const playCallsBeforeNavigation = await page.evaluate(() => window.__bitbiAudioMock.playCalls);
    const pauseCallsBeforeNavigation = await page.evaluate(() => window.__bitbiAudioMock.pauseCalls);

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await page.locator('#mobileNav').getByRole('link', { name: 'Gallery' }).click();
    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);

    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.playCalls)).toBe(playCallsBeforeNavigation);
    await expect.poll(async () => page.evaluate(() => window.__bitbiAudioMock.pauseCalls)).toBe(pauseCallsBeforeNavigation);
    await expect
      .poll(async () => page.evaluate(() => window.__bitbiAudioMock.instances[0]?.currentTime || 0))
      .toBe(74);

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#globalAudioMobileBar')).toBeVisible();
    await expect(page.locator('#globalAudioMobileStatus')).toContainText('1:14 / 4:05');
    await expect.poll(async () => {
      const metrics = await getMobilePlayerMetrics(page);
      return metrics.fillWidth > 20
        && metrics.progressHeight >= 8
        && metrics.elapsedText === '1:14'
        && metrics.durationText === '4:05';
    }).toBe(true);
  });

  test('renders a visible mobile timeline that updates from a real audio element', async ({ page }) => {
    await page.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.__bitbiRealAudioProbe = { instances: [] };
      window.Audio = function BitbiObservedAudio(...args) {
        const audio = new NativeAudio(...args);
        window.__bitbiRealAudioProbe.instances.push(audio);
        return audio;
      };
      window.Audio.prototype = NativeAudio.prototype;
    });
    await routeDefaultMemtracks(page, {
      audioBody: buildWavBuffer({ durationSeconds: 4 }),
      audioContentType: 'audio/wav',
      durationSeconds: 4,
    });

    await page.goto('/');
    await dismissCookieBanner(page);
    await openHomepageSoundLab(page);
    await page.locator('.snd-play').first().click();

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);
    await expect(page.locator('#globalAudioMobileBar')).toBeVisible();
    await expect(page.locator('#globalAudioMobileElapsed')).toBeVisible();
    await expect(page.locator('#globalAudioMobileDuration')).toBeVisible();
    await expect(page.locator('#globalAudioMobileProgress')).toBeVisible();

    const initialMetrics = await getMobilePlayerMetrics(page);
    expect(initialMetrics.progressDisplay).not.toBe('none');
    expect(initialMetrics.progressVisibility).toBe('visible');
    expect(Number(initialMetrics.progressOpacity)).toBeGreaterThan(0);
    expect(initialMetrics.progressPointerEvents).not.toBe('none');
    expect(initialMetrics.progressWidth).toBeGreaterThan(100);
    expect(initialMetrics.progressHeight).toBeGreaterThanOrEqual(8);
    expect(initialMetrics.fillHeight).toBeGreaterThanOrEqual(8);
    expect(initialMetrics.durationText).toBe('0:04');
    expect(initialMetrics.progressDisabled).toBe(false);

    await expect.poll(async () => {
      const metrics = await getMobilePlayerMetrics(page);
      return metrics.elapsedText !== '0:00'
        && metrics.statusText.includes(metrics.elapsedText)
        && metrics.fillWidth > 0
        && metrics.progressPercent > 0;
    }, { timeout: 10000 }).toBe(true);

    const beforeSeekSources = await page.evaluate(() => {
      const audio = window.__bitbiRealAudioProbe?.instances?.[0] || null;
      return {
        src: audio?.src || '',
        currentTime: audio?.currentTime || 0,
      };
    });

    const mobileProgress = page.locator('#globalAudioMobileProgress');
    await mobileProgress.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (rect.width * 0.75),
        clientY: rect.top + Math.max(1, rect.height / 2),
      }));
    });

    await expect.poll(async () => page.evaluate(() => window.__bitbiRealAudioProbe?.instances?.[0]?.currentTime || 0)).toBeGreaterThan(2.4);
    const afterSeekSources = await page.evaluate(() => {
      const audio = window.__bitbiRealAudioProbe?.instances?.[0] || null;
      return {
        src: audio?.src || '',
        currentTime: audio?.currentTime || 0,
      };
    });
    expect(afterSeekSources.src).toBe(beforeSeekSources.src);
    expect(afterSeekSources.currentTime).toBeGreaterThan(beforeSeekSources.currentTime);
  });
});
