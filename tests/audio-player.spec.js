const { test, expect } = require('@playwright/test');

async function installAudioMock(page) {
  await page.addInitScript(() => {
    class MockAudio extends EventTarget {
      constructor() {
        super();
        this.preload = 'auto';
        this.crossOrigin = '';
        this._src = '';
        this._paused = true;
        this._currentTime = 0;
        this._duration = 245;
        this._volume = 0.8;
        this._muted = false;
        this._loop = false;
        this._playbackRate = 1;
      }

      get src() { return this._src; }
      set src(value) {
        this._src = String(value || '');
        window.__bitbiAudioMock.sources.push(this._src);
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
      }
    }

    window.__bitbiAudioMock = { playCalls: 0, pauseCalls: 0, sources: [] };
    window.Audio = MockAudio;
  });
}

test.describe('Global audio player', () => {
  test('persists track state across hard navigation and reload', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');

    await page.goto('/legal/imprint.html');
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');

    await page.reload();
    await expect(page.locator('#globalAudioShell')).toBeVisible();
    await expect(page.locator('#globalAudioTitle')).toHaveText('Cosmic Sea');

    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('bitbi_audio_state_v1')));
    expect(persisted.trackId).toBe('soundlab:cosmic-sea');
    expect(persisted.title).toBe('Cosmic Sea');
  });

  test('global player controls stay synchronized with Sound Lab cards', async ({ page }) => {
    await installAudioMock(page);

    await page.goto('/');
    const firstPlay = page.locator('.snd-play').first();
    await firstPlay.scrollIntoViewIfNeeded();
    await firstPlay.click();

    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('.snd-card').first().locator('.pi')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Paused');

    await page.locator('#globalAudioToggle').click();
    await expect(page.locator('.snd-card').first().locator('.pa')).toBeVisible();
    await expect(page.locator('#globalAudioStatus')).toContainText('Playing');
  });
});

