const { expect } = require('@playwright/test');
const {
  MEDIA_POLICY, DECORATIVE_OBSERVATION_ATTACHMENT, validateDecorativeObservation,
} = require('../../scripts/lib/homepage-media-policy.cjs');

const qualitySpent = new WeakMap();
const QUALITY_BUDGET_MS = 10_000;

async function readHeroFallback(page) {
  return page.evaluate(() => {
    // Hit-test the painted stack, including decorative pointer-events:none
    // layers, without changing layout or leaving interaction changes behind.
    const hitTestStyle = document.createElement('style');
    hitTestStyle.textContent = '* { pointer-events: auto !important; }';
    document.head.append(hitTestStyle);
    try {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.right <= 0 || rect.bottom <= 0
          || rect.left >= innerWidth || rect.top >= innerHeight) return false;
      for (let node = element; node instanceof Element; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const decoded = media => {
      if (media instanceof HTMLImageElement && (!media.complete || !media.naturalWidth)) return false;
      if (media instanceof HTMLVideoElement && (media.readyState < 2 || !media.videoWidth)) return false;
      // The original native MP4 is black; its colour is not a failure. Require
      // actual drawable opaque pixels rather than metadata or a poster hidden
      // beneath an undrawable video. Paint exposure is checked separately.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(media, 0, 0, 8, 8);
      const data = context.getImageData(0, 0, 8, 8).data;
      return Array.from({ length: 64 }, (_, index) => index * 4)
        .some(offset => data[offset + 3] > 0);
    };
    const paintedAtPoint = (media, slot) => {
      const a = media.getBoundingClientRect(), b = slot.getBoundingClientRect();
      const left = Math.max(0, a.left, b.left), right = Math.min(innerWidth, a.right, b.right);
      const top = Math.max(0, a.top, b.top), bottom = Math.min(innerHeight, a.bottom, b.bottom);
      if (right <= left || bottom <= top) return false;
      return [0.25, 0.5, 0.75].some(x => [0.25, 0.5, 0.75].some(y => {
        const stack = document.elementsFromPoint(left + (right - left) * x, top + (bottom - top) * y);
        const index = stack.indexOf(media);
        if (index < 0) return false; // Includes clipping and a hidden back face.
        return !stack.slice(0, index).some(node => {
          if (node.contains(media)) return false;
          const style = getComputedStyle(node);
          let opacity = 1;
          for (let parent = node; parent instanceof Element; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
          if (opacity < 0.99) return false;
          const background = style.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
          return (background.length === 3 || background[3] >= 0.99)
            || style.backgroundImage !== 'none' || ['IMG', 'VIDEO', 'CANVAS'].includes(node.tagName);
        });
      }));
    };
    const slots = Array.from(document.querySelectorAll('#hero [data-latest-models-slot]')).map(slot => {
      const side = slot.closest('[data-latest-models-video-module]')?.dataset.latestModelsVideoModuleSide;
      const key = `${side}_${slot.dataset.latestModelsSlot}`;
      const faces = Array.from(slot.firstElementChild?.children || []).filter(face => face.classList.contains('latest-models-video-module__face'));
      const painted = faces.filter(visible).map(face => {
        const video = face.querySelector('video');
        const poster = face.querySelector('.latest-models-video-module__poster');
        // An opaque video covers the image beneath it; only that video's own
        // decoded still can establish the fallback in this case.
        const media = video && visible(video) ? video : poster && visible(poster) ? poster : null;
        return { kind: media?.tagName.toLowerCase() || null, source: media?.getAttribute('src') || null,
          decoded: !!media && decoded(media), exposed: !!media && paintedAtPoint(media, slot) };
      });
      const valid = painted.find(item => item.decoded && item.exposed);
      return { slot: key, visible: visible(slot), decoded: !!valid, kind: valid?.kind || null,
        source: valid?.source || null, painted };
    });
    const expected = ['left_top', 'left_bottom', 'right_top', 'right_bottom'];
    return { passed: slots.length === 4 && new Set(slots.map(slot => slot.slot)).size === 4
      && slots.every(slot => expected.includes(slot.slot) && slot.visible && slot.decoded), slots };
    } finally { hitTestStyle.remove(); }
  });
}

async function expectHeroFallback(page) {
  let evidence;
  await expect.poll(async () => (evidence = await readHeroFallback(page)).passed,
    { message: 'Each decorative Hero slot must retain a visible decoded poster or still' }).toBe(true);
  return { slots: evidence.slots };
}

async function expectModelsUsable(page) {
  await page.locator('#hero [data-models-link]').first().click();
  const overlay = page.locator('.models-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'dialog');
  await page.locator('.models-overlay__close').click();
  await expect(overlay).toBeHidden();
}

async function expectDecorativeUsable(page) {
  const fallback = await expectHeroFallback(page);
  await expectModelsUsable(page);
  return fallback;
}

async function observeDecorative(page, testInfo, check, observe, { max = 5000, control = false, onBudget } = {}) {
  // Browser timers schedule whole milliseconds. Do not start a nominal native
  // observation with a fractional remainder after its last timer has expired.
  const timeout = Math.floor(Math.min(max, Math.max(0, QUALITY_BUDGET_MS - (qualitySpent.get(page) || 0))));
  let result;
  if (timeout > 0) {
    result = await observe(timeout);
    qualitySpent.set(page, (qualitySpent.get(page) || 0) + result.elapsed);
  } else {
    // Functional resume/release actions still execute when optional observation
    // has used its budget. This is explicitly unobserved, never a playback pass.
    await onBudget?.();
    result = { passed: false, phase: 'observation-budget', reason: 'quality-budget-exhausted', elapsed: 0, timeout: 0 };
  }
  const fallback = await expectHeroFallback(page);
  const envelope = { schema: 1, policy: MEDIA_POLICY, kind: 'decorative-playback',
    status: result.passed ? 'observed' : 'warning', check, result, fallback, ...(control ? { control: true } : {}) };
  validateDecorativeObservation(envelope);
  await testInfo.attach(DECORATIVE_OBSERVATION_ATTACHMENT, { body: JSON.stringify(envelope), contentType: 'application/json' });
  return result;
}

async function observeDecorativeProgress(page, testInfo, { resume = null, captureTargets = false, loops = 0,
  check = resume ? `resume-${resume}` : 'initial-play', control = false } = {}) {
  const run = timeout => page.evaluate(({ resume, captureTargets, loops, timeout }) => {
    let actionRan = false;
    const action = resume === null ? null : () => {
      actionRan = true;
      if (resume === 'visible') window.__setHeroDocumentHidden(false);
      else if (resume === 'onscreen') window.scrollTo(0, 0);
      else if (resume === 'pageshow') window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      else throw new Error('Unknown native resume action');
    };
    if (!timeout) { action?.(); return; }
    return window.__heroNativeProbe.waitForProgress({ captureTargets, loops, timeout, action }).then(result => {
      // An expired/invalid observation can finish before invoking its action.
      // Still perform the functional resume exactly once; retain the failed
      // observation and explicitly distinguish this later action from proof.
      const actionAfterObservation = !!action && !actionRan;
      if (actionAfterObservation && result.passed) throw new Error('Resume observation claimed success without executing its action');
      if (actionAfterObservation) action();
      return { ...result, actionAfterObservation };
    });
  }, { resume, captureTargets, loops, timeout });
  return observeDecorative(page, testInfo, check, run, { control, onBudget: () => run(0) });
}

module.exports = { readHeroFallback, expectHeroFallback, expectModelsUsable, expectDecorativeUsable,
  observeDecorative, observeDecorativeProgress };
