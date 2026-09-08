const { test, expect } = require('@playwright/test');

// Second synthetic fixture: FFmpeg testsrc2=size=32x32:rate=15:duration=1,
// libx264/yuv420p, -movflags +faststart. The original 1s/15fps MP4 stays tested.
// Independent of __heroNativeProbe, its counters and the Hero controller.
// A loop requires native output to restart and then advance from that restart.
for (const source of ['original', 'changing']) {
  test(`independent native HTTP output: ${source} source loops, seeks and resumes`, async ({ page }, testInfo) => {
    await page.route(/^https?:\/\/(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/))/, route => route.abort());
    const responses = [];
    page.on('response', response => {
      if (response.url().includes('/api/plain/file')) responses.push({
        status: response.status(), length: response.headers()['content-length'],
        range: response.headers()['content-range'], transport: response.headers()['x-test-media-transport'],
      });
    });
    await page.goto('/plain-video');
    const result = await page.evaluate(async source => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.loop = true; v.width = 160; v.height = 160;
      document.body.append(v);
      const events = [], frames = [];
      for (const name of ['playing', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'pause']) {
        v.addEventListener(name, () => events.push({ name, time: v.currentTime, at: performance.now() }));
      }
      const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let callback, observationError = null, loops = 0, previous = null, restart = null, phase = 'loop';
      const observe = (_now, metadata) => {
        try {
          context.drawImage(v, 0, 0, 8, 8);
          const pixels = context.getImageData(0, 0, 8, 8).data;
          let checksum = 0; for (const value of pixels) checksum = (checksum * 31 + value) >>> 0;
          const time = metadata.mediaTime;
          frames.push({ phase, time, currentTime: v.currentTime, checksum, presentedFrames: metadata.presentedFrames });
          if (phase === 'loop') {
            if (previous !== null && time < previous) restart = time;
            else if (restart !== null && time > restart) { loops++; restart = null; }
            previous = time;
          }
          callback = v.requestVideoFrameCallback(observe);
        } catch (error) { observationError = error.name; }
      };
      if (!v.requestVideoFrameCallback) return { supported: false };
      callback = v.requestVideoFrameCallback(observe);
      v.src = `/api/plain/file${source === 'changing' ? '?changing=1' : ''}`;
      const timeouts = [];
      const bounded = async (promise, phase, milliseconds) => {
        let timer;
        try {
          return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => { timeouts.push(phase); reject(new Error(`${phase} timeout`)); }, milliseconds);
          })]);
        } finally { clearTimeout(timer); }
      };
      let rejection = null;
      try { await bounded(v.play(), 'initial-play', 4500); } catch (error) { rejection = error.message; }
      const until = predicate => new Promise(resolve => {
        const end = performance.now() + 4500;
        function sample() {
          if (predicate() || v.error || observationError || performance.now() >= end) resolve();
          else setTimeout(sample, 16);
        }
        sample();
      });
      await until(() => loops >= 2);
      const loopState = { loops, time: v.currentTime, readyState: v.readyState, networkState: v.networkState };
      // New phase: no old loop progress can satisfy resume. Native pause is a
      // frozen-output countercontrol; it is not simulated successful playback.
      phase = 'paused'; v.pause();
      await new Promise(resolve => setTimeout(resolve, 32));
      const stoppedTime = v.currentTime;
      await new Promise(resolve => setTimeout(resolve, 200));
      const stayedPaused = v.paused && v.currentTime === stoppedTime;
      phase = 'seek';
      const seek = new Promise(resolve => {
        const done = value => { clearTimeout(timer); v.removeEventListener('seeked', onSeek); resolve(value); };
        const onSeek = () => done(true);
        const timer = setTimeout(() => done(false), 1000);
        v.addEventListener('seeked', onSeek, { once: true });
      });
      v.currentTime = 0.3; const seeked = await seek;
      phase = 'resume';
      try { await bounded(v.play(), 'resume-play', 4500); } catch (error) { rejection = error.message; }
      await until(() => {
        const current = frames.filter(f => f.phase === 'resume');
        return current.some(f => f.time > current[0].time);
      });
      const resumedFrames = frames.filter(f => f.phase === 'resume');
      const resumed = resumedFrames.some(f => f.time > resumedFrames[0].time);
      const identity = v.currentSrc; const error = v.error?.code || null;
      v.pause(); v.cancelVideoFrameCallback(callback);
      return { supported: true, source, identity, loopState, resumed, stayedPaused, seeked, rejection, error, observationError, timeouts, frames, events };
    }, source);
    await testInfo.attach('independent-native-output', { body: JSON.stringify({ platform: process.platform, browser: testInfo.project.name, responses, result }), contentType: 'application/json' });
    const diagnostic = process.platform === 'linux' && testInfo.project.metadata.nativeMediaDiagnostic === true;
    if (diagnostic) {
      testInfo.annotations.push({ type: 'linux-webkit-media-diagnostic', description: `loops=${result.loopState?.loops}; resumed=${result.resumed}; error=${result.error}; not functional acceptance` });
      console.log('LINUX WEBKIT MEDIA DIAGNOSTIC', JSON.stringify({ source, ...result.loopState, resumed: result.resumed, error: result.error, observationError: result.observationError, timeouts: result.timeouts, rejection: result.rejection, supported: result.supported }));
    } else {
      expect(result.supported).toBe(true);
      expect(responses.some(r => r.transport === 'http' && [200, 206].includes(r.status))).toBe(true);
      expect(result.frames.length).toBeGreaterThan(1); // Instrument capability, not an FPS quota.
      expect(result.stayedPaused).toBe(true);
      expect(result.observationError).toBeNull(); expect(result.timeouts).toEqual([]);
      expect(result.loopState.loops).toBeGreaterThanOrEqual(2);
      expect(result.resumed).toBe(true); expect(result.seeked).toBe(true);
      expect(result.error).toBeNull(); expect(result.rejection).toBeNull();
      if (source === 'changing') expect(new Set(result.frames.map(f => f.checksum)).size).toBeGreaterThan(1);
    }
  });
}
