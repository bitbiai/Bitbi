// Observational native-media probe. It never replaces a player, clock, source,
// currentTime, pause result or play promise; every play call goes to the engine.
function installBrowserProbe(createProgressWindow, observeProgress) {
    const ids = new WeakMap();
    const observations = new WeakMap();
    let sequence = 0, eventSequence = 0;
    const events = [];
    const isHeroVideo = video => video instanceof HTMLVideoElement
      && video.classList.contains('latest-models-video-module__video');
    function observation(video, output = null) {
      let state=observations.get(video);
      if(!state) {
        state={epoch:0, src:video.getAttribute('src'), lastTime:video.currentTime, lastFrames:0, maxTime:0, nativeOutput:[],
          outputAdvances:0, completedLoops:0, loopPending:false, callbackPending:false, frameCallbacks:0, nativePresentedFrames:null, lastOutputTime:null, outputLoopPending:false};
        observations.set(video,state);ids.set(video,++sequence);
        const reset=()=>{state.epoch++;state.loopPending=false;state.outputLoopPending=false;state.lastOutputTime=null;state.maxTime=0;state.lastTime=video.currentTime;
          state.lastFrames=video.requestVideoFrameCallback ? 0 : video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? 0;};
        video.addEventListener('pause',reset);video.addEventListener('emptied',reset);
        video.addEventListener('seeking',()=>{
          state.loopPending=video.loop && !video.paused && video.currentTime < video.duration*0.2 && state.maxTime>video.duration*0.5;
          state.lastTime=video.currentTime;state.maxTime=0;
          state.lastFrames=video.requestVideoFrameCallback ? 0 : video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? 0;
        });
        video.addEventListener('timeupdate',()=>observation(video));
      }
      const source=video.getAttribute('src');
      if(source!==state.src){state.epoch++;state.src=source;state.loopPending=false;state.outputLoopPending=false;state.lastOutputTime=null;state.maxTime=0;state.lastTime=video.currentTime;state.lastFrames=0;}
      // Native frame callbacks already provide output. Do not synchronously
      // query decoder statistics on every callback/timeupdate as well.
      const frames=video.requestVideoFrameCallback ? null : video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? null;
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
      if(output) {
        state.nativeOutput.push({mediaTime:output.mediaTime,presentationTime:output.presentationTime,
          seeking:video.seeking,paused:video.paused,epoch:state.epoch});
        if(state.nativeOutput.length>12)state.nativeOutput.shift();
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
    function sample(video, details = false) {
      details = details === true; // Array.from's index is not a diagnostics flag.
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
      // Layout/style/decoder reads belong to explicit diagnostics, not the
      // progress polling/event hot path. They can force synchronous rendering.
      const rect = details ? video.getBoundingClientRect() : null;
      const style = details ? getComputedStyle(video) : null;
      return {
        id: ids.get(video),
        slot: slot ? `${module?.dataset.latestModelsVideoModuleSide}_${slot.dataset.latestModelsSlot}` : null,
        role: !slot ? 'detached' : turning ? (target ? 'selected-target' : 'outgoing') : 'active',
        active: target,
        visibility: details ? {
          documentHidden: document.hidden,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          intersectsViewport: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
          display: style.display, visibility: style.visibility, opacity: style.opacity,
          animationPlayState: slot?.querySelector('.latest-models-video-module__cube')?.style.animationPlayState || '',
          // Geometry/style observations are not a proof of visual occlusion.
        } : undefined,
        connected: video.isConnected, src: video.getAttribute('src'),
        time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null,
        epoch: observationState.epoch, outputAdvances: observationState.outputAdvances, completedLoops: observationState.completedLoops,
        frameCallbacks: observationState.frameCallbacks, nativePresentedFrames: observationState.nativePresentedFrames,
        // Different engine statistics, never an interchangeable pause budget.
        frames: details ? video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? null : null,
        frameStatistics: details ? { totalVideoFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? null,
          droppedVideoFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? null,
          decodedFrames: video.webkitDecodedFrameCount ?? null } : undefined,
        nativeOutput: details ? observationState.nativeOutput.slice() : undefined,
        paused: video.paused, ended: video.ended, seeking: video.seeking,
        readyState: video.readyState, networkState: video.networkState,
        error: video.error?.code ?? null,
      };
    }
    function record(type, video, extra = {}) {
      if (!isHeroVideo(video)) return;
      events.push({ serial: ++eventSequence, at: performance.now(), type, ...sample(video), ...extra });
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
    function observePausedTransitions({ timeout = 2000 } = {}) {
      const selector = '#hero [data-latest-models-slot]';
      const targets = Array.from(document.querySelectorAll(`${selector}.is-turning`)).map(slot => {
        const cube = slot.firstElementChild;
        const face = cube?.lastElementChild;
        const video = face?.querySelector('video');
        return { slot, cube, face, video, source: video?.getAttribute('src'),
          key: video ? sample(video).slot : null, videoId: video ? sample(video).id : null,
          number: slot.dataset.transitionCount, target: slot.dataset.activeVideoId, index: slot.dataset.activeIndex,
          completed: null };
      });
      const start = performance.now();
      const describe = t => ({ slot: t.key, number: t.number, target: t.target, index: t.index,
        videoId: t.videoId, source: t.source, completed: t.completed,
        current: { connected: t.slot.isConnected, number: t.slot.dataset.transitionCount,
          target: t.slot.dataset.activeVideoId, turning: t.slot.classList.contains('is-turning'),
          originalCubeConnected: t.cube?.isConnected, incomingFaceConnected: t.face?.isConnected,
          video: t.video ? sample(t.video) : null } });
      return new Promise(resolve => {
        let observer, deadline, finished = false;
        const finish = (passed, reason) => {
          if (finished) return;
          finished = true; observer?.disconnect(); clearTimeout(deadline);
          resolve({ passed, reason, elapsed: performance.now() - start, targets: targets.map(describe),
            scope: 'Exact paused transition targets; later cycles do not revoke observed completion.' });
        };
        if (!targets.length) return finish(false, 'no-paused-transition');
        if (targets.some(t => !t.key || !t.target || !t.source || !/^[1-9]\d*$/.test(t.number || '')
            || !t.cube?.classList.contains('is-turning') || t.cube.style.animationPlayState !== 'paused'
            || !t.face?.classList.contains('latest-models-video-module__face--right')
            || !t.video?.paused || !t.video.isConnected)
            || new Set(targets.map(t => t.key)).size !== targets.length) return finish(false, 'invalid-paused-target');
        const check = () => {
          try {
            for (const t of targets) {
              if (t.completed) continue; // Preserve this instance, not global idle.
              if (!t.slot.isConnected || !t.face.isConnected || !t.video.isConnected
                  || t.video.getAttribute('src') !== t.source || t.face.querySelector('video') !== t.video)
                return finish(false, 'target-removed-or-replaced');
              if (t.slot.dataset.transitionCount !== t.number || t.slot.dataset.activeVideoId !== t.target
                  || t.slot.dataset.activeIndex !== t.index) return finish(false, 'unobserved-or-foreign-completion');
              const currentCube = t.slot.firstElementChild;
              if (!t.slot.classList.contains('is-turning') && currentCube !== t.cube && !t.cube.isConnected) {
                if (!currentCube?.classList.contains('latest-models-video-module__cube')
                    || currentCube.classList.contains('is-turning') || currentCube.children.length !== 1
                    || currentCube.firstElementChild !== t.face
                    || !t.face.classList.contains('latest-models-video-module__face--front'))
                  return finish(false, 'wrong-settled-target');
                t.completed = { at: performance.now() - start, number: t.number, videoId: t.videoId, source: t.source };
              }
            }
            if (targets.every(t => t.completed)) finish(true, 'captured-targets-settled');
          } catch (error) { finish(false, 'observation-error: ' + error.message); }
        };
        observer = new MutationObserver(check);
        observer.observe(document.querySelector('#hero'), { subtree: true, childList: true, attributes: true,
          attributeFilter: ['class', 'src', 'data-active-video-id', 'data-active-index', 'data-transition-count'] });
        deadline = setTimeout(() => finish(false, 'transition-deadline'), timeout);
        check(); // Registration completes synchronously, before caller resumes.
      });
    }
    async function observeFrozen(duration) {
      const start = performance.now(), firstEvent = eventSequence;
      const read = () => Array.from(document.querySelectorAll('#hero [data-latest-models-video-module] video'), sample);
      const before = read();
      const issues = new Set();
      const transitions = () => Array.from(document.querySelectorAll('#hero [data-latest-models-slot]'))
        .map(slot => [slot.closest('[data-latest-models-video-module]')?.dataset.latestModelsVideoModuleSide,
          slot.dataset.latestModelsSlot, slot.dataset.transitionCount]);
      const beforeTransitions = transitions();
      const check = current => {
        if (before.length < 4 || current.length !== before.length) issues.add('video-count');
        for (const video of current) {
          const old = before.find(item => item.id === video.id);
          if (!old || video.src !== old.src || video.slot !== old.slot || !video.connected) issues.add('identity-or-source');
          if (!video.paused) issues.add('not-paused');
          if (old && video.time !== old.time) issues.add('timeline-advanced');
        }
        if (JSON.stringify(transitions()) !== JSON.stringify(beforeTransitions)) issues.add('cycle-advanced');
      };
      check(before);
      const mutations = new MutationObserver(records => {
        if (records.some(record => record.type === 'attributes' && record.attributeName === 'src'
            && record.target instanceof HTMLVideoElement)) issues.add('source-mutation');
        check(read());
      });
      mutations.observe(document.querySelector('#hero'), { subtree:true, childList:true, attributes:true,
        attributeFilter:['src','data-transition-count'] });
      const timer = setInterval(() => check(read()), 40);
      let after;
      try { await new Promise(resolve => setTimeout(resolve, duration)); after = read(); check(after); }
      finally { clearInterval(timer); mutations.disconnect(); }
      const during = events.filter(event => event.serial > firstEvent);
      if (during.some(event => event.type === 'play-call' || (event.type === 'playing' && !event.paused))) issues.add('play-resumed');
      return { passed: issues.size === 0, issues: [...issues], before, after, duration: performance.now()-start,
        beforeTransitions, afterTransitions: transitions(), events: during,
        scope: 'Pause, timeline, source/DOM identity and cycle continuity; frame statistics are diagnostic.' };
    }
    window.__heroNativeProbe = {
      sample: () => Array.from(document.querySelectorAll('#hero [data-latest-models-video-module] video'), sample),
      events, observe: sample, observeFrozen, observePausedTransitions,
      diagnostics: () => Array.from(document.querySelectorAll('#hero [data-latest-models-video-module] video'), video => sample(video,true)),
      waitForProgress: options => observeProgress(window.__heroNativeProbe.sample, options, createProgressWindow),
    };
}

async function installHeroNativeProbe(page) {
  // Install the exact exported functions together, without an additional loader
  // or a second copy of the identity contract in the browser.
  await page.addInitScript({ content: `(${installBrowserProbe})(${createProgressWindow}, ${observeProgress});` });
}

// Observe inside one browser call. Transport delays must not discard output
// already seen before a normal source transition. Each invocation starts fresh.
function observeProgress(sample, { loops = 0, timeout = 5000 } = {}, factory = createProgressWindow) {
  const progress = factory({ loops });
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const samples = [];
    let timer, deadline, sampleCount = 0, settled = false;
    const finish = (passed, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(deadline);
      if (error) reject(error);
      else resolve({ passed, phase: loops ? 'loop' : 'play-or-resume',
        issues: progress.issues?.() || [], elapsed: performance.now() - start, sampleCount, samples });
    };
    const tick = () => {
      try {
        const current = sample(); sampleCount++;
        samples.push(current); if (samples.length > 60) samples.shift();
        if (progress(current)) return finish(true);
        if (performance.now() - start >= timeout) return finish(false);
        timer = setTimeout(tick, 16);
      } catch (error) { finish(false, error); }
    };
    deadline = setTimeout(() => finish(false), timeout);
    tick();
  });
}

// One invocation is one observation interval. Retain each slot's evidence,
// never evidence from a retired identity, paused epoch or another source.
function createProgressWindow({ loops=0 }={}) {
  const states=new Map();
  let issues=[];
  const observe=current=>{
    const active=current.filter(video=>video.active);
    const slots=['left_top','left_bottom','right_top','right_bottom'];
    if(active.length!==4 || new Set(active.map(v=>v.slot)).size!==4 || active.some(v=>!slots.includes(v.slot))) {
      states.clear();issues=[{condition:'four-distinct-active-slots-required',slots:active.map(v=>v.slot)}];return false;
    }
    for(const video of active) {
      const key=JSON.stringify([video.id,video.src,video.epoch ?? 0]);
      let state=states.get(video.slot);
      if(!state || state.key!==key || video.paused || video.error || !video.connected) {
        state={key,before:video,progress:false,loops:false};states.set(video.slot,state);
      }
      // Seek completion alone is not output. A captured seek needs subsequent
      // output in this identity, even if it progressed before that seek.
      if(video.seeking) { state.seekBaseline=video.outputAdvances;state.progress=false; }
      if(!video.paused && video.readyState>=2 && video.error===null && video.connected) {
        if(!video.seeking && video.outputAdvances>Math.max(state.before.outputAdvances,state.seekBaseline ?? -1))state.progress=true;
        if((video.completedLoops ?? 0)-(state.before.completedLoops ?? 0)>=loops)state.loops=true;
      }
    }
    issues=active.flatMap(video=>{
      const s=states.get(video.slot);
      const condition=!video.connected?'detached':video.error?'media-error':video.paused?'paused':video.seeking?'seek-in-progress':
        video.readyState<2?'not-ready':!s.progress?'no-new-output':!s.loops?'loops-incomplete':null;
      return condition?[{slot:video.slot,id:video.id,src:video.src,epoch:video.epoch ?? 0,condition,
        beforeOutput:s.before.outputAdvances,output:video.outputAdvances,time:video.time}]:[];
    });
    return issues.length===0;
  };
  observe.issues=()=>issues;
  return observe;
}
module.exports = { installHeroNativeProbe, createProgressWindow, observeProgress };
