// Observational native-media probe. It never replaces a player, clock, source,
// currentTime, pause result or play promise; every play call goes to the engine.
async function installHeroNativeProbe(page) {
  await page.addInitScript(() => {
    const ids = new WeakMap();
    const presentations = new WeakMap();
    let sequence = 0;
    const events = [];
    const isHeroVideo = video => video instanceof HTMLVideoElement
      && video.classList.contains('latest-models-video-module__video');
    function sample(video) {
      if (!ids.has(video)) {
        ids.set(video, ++sequence);
        if (video.requestVideoFrameCallback) {
          presentations.set(video, 0);
          const observe = () => { presentations.set(video, presentations.get(video) + 1); if (video.isConnected) video.requestVideoFrameCallback(observe); };
          video.requestVideoFrameCallback(observe);
        }
      }
      const slot = video.closest('[data-latest-models-slot]');
      const module = slot?.closest('[data-latest-models-video-module]');
      const face = video.closest('.latest-models-video-module__face');
      const faces = slot?.querySelectorAll(':scope > .latest-models-video-module__cube > .latest-models-video-module__face');
      // advance() appends the incoming target after the outgoing face, including
      // reduced-motion's front-class face. This identifies the controller target,
      // not which rotated pixels are visually foremost midway through a turn.
      const target = !!face && face === faces?.[faces.length - 1];
      const turning = !!slot && (slot.classList.contains('is-turning') || slot.classList.contains('is-reduced-transition'));
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return {
        id: ids.get(video),
        slot: slot ? `${module?.dataset.latestModelsVideoModuleSide}_${slot.dataset.latestModelsSlot}` : null,
        role: !slot ? 'detached' : turning ? (target ? 'selected-target' : 'outgoing') : 'active',
        active: target,
        visibility: {
          documentHidden: document.hidden,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          intersectsViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
          display: style.display, visibility: style.visibility, opacity: style.opacity,
          animationPlayState: slot?.querySelector('.latest-models-video-module__cube')?.style.animationPlayState || '',
          // Geometry/style observations are not a proof of visual occlusion.
        },
        connected: video.isConnected, src: video.getAttribute('src'),
        time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
        presentedFrames: presentations.get(video) ?? null,
        frames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? null,
        paused: video.paused, ended: video.ended, seeking: video.seeking,
        readyState: video.readyState, networkState: video.networkState,
        error: video.error?.code ?? null,
      };
    }
    function record(type, video, extra = {}) {
      if (!isHeroVideo(video)) return;
      events.push({ at: performance.now(), type, ...sample(video), ...extra });
      if (events.length > 500) events.shift();
    }
    for (const type of ['playing', 'pause', 'ended', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'emptied']) {
      document.addEventListener(type, event => record(type, event.target), true);
    }
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      if (!isHeroVideo(this)) return Reflect.apply(nativePlay, this, args);
      record('play-call', this);
      const continuity = window.__heroContinuityProbe;
      if (continuity?.videos.includes(this)) {
        const current = Array.from(document.querySelectorAll('#hero [data-latest-models-video-module] video'));
        continuity.resumes.push({
          sameVideos: current.length === continuity.videos.length && current.every((video, i) => video === continuity.videos[i]),
          sameSources: continuity.videos.every((video, i) => video.getAttribute('src') === continuity.sources[i]),
          sourceChanges: continuity.sourceChanges, emptied: continuity.emptied,
        });
      }
      const result = Reflect.apply(nativePlay, this, args);
      result?.then(() => record('play-resolved', this), error => record('play-rejected', this, { rejection: error.name }));
      return result;
    };
    window.__heroNativeProbe = {
      sample: () => Array.from(document.querySelectorAll('#hero [data-latest-models-video-module] video'), sample),
      events,
    };
  });
}

function everyActiveSlotProgressed(previous, current) {
  const active = current.filter(video => video.active);
  const expectedSlots = ['left_top', 'left_bottom', 'right_top', 'right_bottom'];
  if (active.length !== 4 || new Set(active.map(video => video.slot)).size !== 4
      || active.some(video => !expectedSlots.includes(video.slot))) return false;
  return active.every(video => {
    const before = previous.find(item => item.id === video.id && item.slot === video.slot && item.src === video.src);
    return before && video.connected && !video.paused && video.readyState >= 2 && video.error === null
      && ((!video.seeking && video.time > before.time) || (video.presentedFrames != null && before.presentedFrames != null && video.presentedFrames > before.presentedFrames) || (video.frames !== null && before.frames !== null && video.frames > before.frames));
  });
}

module.exports = { installHeroNativeProbe, everyActiveSlotProgressed };
