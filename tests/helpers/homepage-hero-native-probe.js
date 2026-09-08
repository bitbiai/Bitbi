// Observational native-media probe. It never replaces a player, clock, source,
// currentTime, pause result or play promise; every play call goes to the engine.
async function installHeroNativeProbe(page) {
  await page.addInitScript(() => {
    const ids = new WeakMap();
    const observations = new WeakMap();
    let sequence = 0;
    const events = [];
    const isHeroVideo = video => video instanceof HTMLVideoElement
      && video.classList.contains('latest-models-video-module__video');
    function observation(video, output = null) {
      let state=observations.get(video);
      if(!state) {
        state={epoch:0, src:video.getAttribute('src'), lastTime:video.currentTime, lastFrames:0, maxTime:0,
          outputAdvances:0, completedLoops:0, loopPending:false, callbackPending:false, frameCallbacks:0, nativePresentedFrames:null, lastOutputTime:null, outputLoopPending:false};
        observations.set(video,state);ids.set(video,++sequence);
        const reset=()=>{state.epoch++;state.loopPending=false;state.outputLoopPending=false;state.lastOutputTime=null;state.maxTime=0;state.lastTime=video.currentTime;
          state.lastFrames=video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? 0;};
        video.addEventListener('pause',reset);video.addEventListener('emptied',reset);
        video.addEventListener('seeking',()=>{
          state.loopPending=video.loop && !video.paused && video.currentTime < video.duration*0.2 && state.maxTime>video.duration*0.5;
          state.lastTime=video.currentTime;state.maxTime=0;
          state.lastFrames=video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? 0;
        });
        video.addEventListener('timeupdate',()=>observation(video));
      }
      const source=video.getAttribute('src');
      if(source!==state.src){state.epoch++;state.src=source;state.loopPending=false;state.outputLoopPending=false;state.lastOutputTime=null;state.maxTime=0;state.lastTime=video.currentTime;state.lastFrames=0;}
      const frames=video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? null;
      // Decoded counters can stay cached while already-decoded frames are
      // presented again after resume. Native frame mediaTime proves output;
      // callback frequency and cached decode counts are not progress quotas.
      if(output && !video.paused && !video.seeking) {
        const previous=state.lastOutputTime;
        if(previous!==null && output.mediaTime<previous && video.loop) state.outputLoopPending=true;
        else if(previous!==null && output.mediaTime>previous) {
          state.outputAdvances++;
          if(state.outputLoopPending){state.completedLoops++;state.outputLoopPending=false;}
        }
        state.lastOutputTime=output.mediaTime;
      }
      if(!video.requestVideoFrameCallback && !video.paused && !video.seeking && video.currentTime>state.lastTime && frames!==null && frames>state.lastFrames) {
        state.outputAdvances++;
        if(state.loopPending){state.completedLoops++;state.loopPending=false;}
      }
      if(!video.seeking){state.maxTime=Math.max(state.maxTime,video.currentTime);state.lastTime=video.currentTime;state.lastFrames=frames;}
      // Native output metadata is evidence; callback frequency is diagnostic only.
      // A disconnected pre-insertion video is registered on its next sample.
      if(video.isConnected && video.requestVideoFrameCallback && !state.callbackPending) {
        state.callbackPending=true;
        const registeredEpoch=state.epoch, registeredSource=state.src;
        video.requestVideoFrameCallback((_now,metadata)=>{
          state.callbackPending=false;state.frameCallbacks++;state.nativePresentedFrames=metadata.presentedFrames;
          const current=registeredEpoch===state.epoch && registeredSource===video.getAttribute('src');
          observation(video,current ? metadata : null);
        });
      }
      return state;
    }
    function sample(video) {
      const observationState=observation(video);
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
        epoch: observationState.epoch, outputAdvances: observationState.outputAdvances, completedLoops: observationState.completedLoops,
        frameCallbacks: observationState.frameCallbacks, nativePresentedFrames: observationState.nativePresentedFrames,
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
      events, observe: sample,
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
      && (video.epoch ?? 0) === (before.epoch ?? 0)
      && ((video.outputAdvances != null && video.outputAdvances > before.outputAdvances) || (!video.seeking && video.frames !== null && before.frames !== null && video.frames > before.frames));
  });
}

// One invocation is one observation interval. Retain each slot's evidence,
// never evidence from a retired identity, paused epoch or another source.
function createProgressWindow({ loops=0 }={}) {
  const states=new Map();
  return current=>{
    const active=current.filter(video=>video.active);
    const slots=['left_top','left_bottom','right_top','right_bottom'];
    if(active.length!==4 || new Set(active.map(v=>v.slot)).size!==4 || active.some(v=>!slots.includes(v.slot))) {states.clear();return false;}
    for(const video of active) {
      const key=JSON.stringify([video.id,video.src,video.epoch ?? 0]);
      let state=states.get(video.slot);
      if(!state || state.key!==key || video.paused || video.error || !video.connected) {
        state={key,before:video,progress:false,loops:false};states.set(video.slot,state);
      }
      if(!video.paused && video.readyState>=2 && video.error===null && video.connected) {
        if(video.outputAdvances>state.before.outputAdvances)state.progress=true;
        if((video.completedLoops ?? 0)-(state.before.completedLoops ?? 0)>=loops)state.loops=true;
      }
    }
    return active.every(video=>{const s=states.get(video.slot);return s.progress && s.loops && !video.paused && video.readyState>=2 && video.error===null && video.connected;});
  };
}
module.exports = { installHeroNativeProbe, everyActiveSlotProgressed, createProgressWindow };
