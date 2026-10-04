const assert = require('node:assert/strict');

// Check membership against the usable-model registry, but presentation against
// the user contract: Images, Video, Music; publisher then model name A–Z.
// Do not call the production grouping/sorting helper to generate its own oracle.
function assertHelpCatalog(groups, registry, locale) {
  const types = ['image', 'video', 'music'];
  assert.deepEqual(groups.map(group => group.title), locale === 'de'
    ? ['Bilder', 'Video', 'Musik'] : ['Images', 'Video', 'Music']);
  const ids = groups.flatMap(group => group.ids);
  assert.equal(new Set(ids).size, ids.length, 'Each usable model appears exactly once');
  assert.deepEqual([...ids].sort(), registry.map(model => model.id).sort(), 'Complete usable membership');
  groups.forEach((group, index) => {
    const models = group.ids.map(id => registry.find(model => model.id === id));
    assert(models.every(model => model.mediaType === types[index]), 'Models belong to their media group');
    for (let i = 1; i < models.length; i += 1) {
      const previous = models[i - 1], current = models[i];
      const compare = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
      assert((compare(previous.vendor, current.vendor) || compare(previous.displayName, current.displayName)
        || compare(previous.id, current.id)) <= 0, 'Publisher and model names are alphabetical within each group');
    }
  });
}
async function assertWorkspaceModelHelp({page, section, expect, locale}) {
  const registry = await page.evaluate(async () => {
    const url = [...performance.getEntriesByType('resource')].map(entry => entry.name).find(name => name.includes('/generate-lab/model-registry.js'));
    const { getGenerateLabModels } = await import(url);
    return getGenerateLabModels().map(({ id, displayName, vendor, mediaType, options, controls }) => ({ id, displayName, vendor, mediaType, options, controls }));
  });
  const entries = section.locator('[data-help-model]');
  await expect(entries).toHaveCount(registry.length);
  const groups = await section.locator('[data-help-models]').evaluate(root => {
    const groups = [];
    for (const child of root.children) {
      if (child.tagName === 'H4') groups.push({ title: child.textContent, ids: [] });
      else if (child.dataset.helpModel) groups.at(-1).ids.push(child.dataset.helpModel);
    }
    return groups;
  });
  assertHelpCatalog(groups, registry, locale);
  // Reject missing, duplicate, mis-grouped, unsorted and wrong-locale output.
  for (const mutate of [
    value => value[0].ids.pop(),
    value => value[0].ids.push(value[0].ids[0]),
    value => value[1].ids.push(value[0].ids.pop()),
    value => value[1].ids.reverse(),
    value => { value[0].title = locale === 'de' ? 'Images' : 'Bilder'; },
  ]) {
    const broken = structuredClone(groups); mutate(broken);
    expect(() => assertHelpCatalog(broken, registry, locale)).toThrow();
  }
  for (const model of registry) {
    const entry = section.locator(`[data-help-model="${model.id}"]`);
    await expect(entry.locator('.help-menu__item-title')).toHaveText(model.displayName);
    await entry.locator('summary').click();
    for (const [key, value] of Object.entries(model.options || {})) {
      if (key === 'dimensions') {
        const dimensions = entry.locator('[data-help-option="dimensions"]');
        if (!model.controls.supportsDimensions) {
          await expect(dimensions).toHaveCount(0);
          await expect(entry).not.toContainText(locale === 'de' ? 'Breite und Höhe' : 'width and height');
        } else if (model.id === '@cf/black-forest-labs/flux-2-klein-9b') {
          // Independent validated application subset; never infer a continuous range.
          await expect(dimensions).toHaveText(locale === 'de'
            ? 'Angeforderte Breite und Höhe (px): 256, 512, 768, 1024.'
            : 'Requested width and height (px): 256, 512, 768, 1024.');
        } else {
          await expect(dimensions).toContainText(`${value.min}–${value.max} px`);
          await expect(dimensions).toContainText(String(value.maxPixels));
        }
      } else {
        const labels = locale === 'de' ? {
          operation: 'Verfügbare Aktion', quality: 'Qualität', size: 'Angeforderte Größe',
          outputFormat: 'Dateiformat', background: 'Hintergrund', resolution: 'Angeforderte Auflösung',
          ratio: 'Seitenverhältnis', aspectRatio: 'Seitenverhältnis', duration: 'Angeforderte Dauer (Sekunden)',
          safetyTolerance: 'Sicherheitstoleranz',
        } : {
          operation: 'Available operation', quality: 'Quality', size: 'Requested size',
          outputFormat: 'File format', background: 'Background', resolution: 'Requested resolution',
          ratio: 'Aspect ratio', aspectRatio: 'Aspect ratio', duration: 'Requested duration (seconds)',
          safetyTolerance: 'Safety tolerance',
        };
        const operations = locale === 'de' ? { generate: 'Generieren', edit: 'Bearbeiten', extend: 'Verlängern' }
          : { generate: 'Generate', edit: 'Edit', extend: 'Extend' };
        expect(labels[key], `Localized help label for ${key}`).toBeTruthy();
        const options = Array.isArray(value) ? value.map(option => key === 'operation' ? operations[option] : option).join(', ')
          : `${value.min}–${value.max}`;
        await expect(entry.locator(`[data-help-option="${key}"]`)).toHaveText(`${labels[key]}: ${options}.`);
      }
      await expect(entry).not.toContainText(/undefined|NaN/);
    }
    if (model.options?.background?.includes('transparent')) await expect(entry).not.toContainText(locale === 'de' ? 'Transparenter Hintergrund wird von diesem Modell hier nicht unterstützt.' : 'Transparent background is not supported by this model here.');
    if (model.controls?.supportsReferenceImages) await expect(entry).toContainText(String(model.controls.maxReferenceImages));
    await entry.locator('summary').click();
  }
}
function assertPublicModelNames(publicModelNames, expect) {
    expect(publicModelNames).toContain('Seedance 2.0 Fast');
    expect(publicModelNames).not.toContain('Seedance 2.0');
    const assertPublicNames=names=>{
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain('Seedance 2.0 Fast');expect(names).toContain('FLUX.1 Schnell');
      expect(names).not.toContain('Seedance 2.0');expect(names).not.toContain('FLUX.2 Dev');
    };
    assertPublicNames(publicModelNames);
    expect(()=>assertPublicNames(publicModelNames.filter(name=>name!=='Seedance 2.0 Fast'))).toThrow();
    expect(()=>assertPublicNames([...publicModelNames,'Seedance 2.0 Fast'])).toThrow();
    expect(()=>assertPublicNames([...publicModelNames,'Seedance 2.0'])).toThrow();
}
module.exports = { assertHelpCatalog, assertWorkspaceModelHelp, assertPublicModelNames };
