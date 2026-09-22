// Synthetic UI acceptance only: these fixtures do not establish provider access,
// provider pricing or live generation. Production editing stays blocked until reference pricing is verified.
const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const png = fs.readFileSync(path.join(__dirname, '../fixtures/media/member-image.png'));
const ids = ['openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare'];
const json = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
async function syntheticActivation(page) {
    await page.route('**/js/shared/gpt-image-25-contract.mjs*', route => {
        const source = fs.readFileSync(path.join(__dirname, '../../js/shared/gpt-image-25-contract.mjs'), 'utf8');
        return route.fulfill({ contentType: 'text/javascript', body: source.replace('GPT_IMAGE_25_GENERATION_ENABLED = false', 'GPT_IMAGE_25_GENERATION_ENABLED = true') });
    });
    await page.route('**/js/shared/ai-model-pricing.mjs*', route => {
        const source = fs.readFileSync(path.join(__dirname, '../../js/shared/ai-model-pricing.mjs'), 'utf8');
        return route.fulfill({ contentType: 'text/javascript', body: source.replace('export function calculateAiImageCreditCost(modelId, params = {}) {', 'export function calculateAiImageCreditCost(modelId, params = {}) { if (modelId.startsWith("openai/gpt-image-2.5-")) return {credits:42,modelId,pricingStatus:"synthetic_fixture"};') });
    });
}
async function uploadFixture(page) {
    const uploads = [];
    await page.route('**/api/ai/images/save', route => {
        uploads.push(route.request().postDataJSON());
        return json(route, { ok: true, data: { id: `ref-${uploads.length}`, file_url: '/gpt25-fixture.png' } });
    });
    await page.route('**/gpt25-fixture.png', route => route.fulfill({ contentType: 'image/png', body: png }));
    return uploads;
}
async function themes(page, expect, selector) {
    for (const theme of ['dark', 'light', 'soft']) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await expect(page.locator(selector)).toBeVisible();
        const paint = await page.locator(selector).evaluate(node => ({ color: getComputedStyle(node).color, opacity: getComputedStyle(node).opacity, width: node.getBoundingClientRect().width }));
        expect(paint.color).not.toBe('rgba(0, 0, 0, 0)'); expect(Number(paint.opacity)).toBeGreaterThan(0); expect(paint.width).toBeGreaterThan(20);
        if (selector === '#labImageQuality') {
            const contrast = await require('./appearance').measureContrast(page.locator('.generate-lab-ref-images__slot-label > span:last-child, .generate-lab-ref-images__head > span, .generate-lab-ref-images__toggle span, .generate-lab-ref-images__toggle small'));
            expect(contrast.length).toBeGreaterThanOrEqual(6);
            for (const value of contrast) expect(value.ratio, `${theme}: ${JSON.stringify(value)}`).toBeGreaterThanOrEqual(4.5);
            await test.info().attach(`reference controls contrast ${theme} ${page.viewportSize().width}px`, { body: JSON.stringify(contrast, null, 2), contentType: 'application/json' });
        }
        const file = test.info().outputPath(`${selector.slice(1)}-${theme}-${page.viewportSize().width}.png`);
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
        await test.info().attach(`${selector.slice(1)} ${theme} ${page.viewportSize().width}px`, { path: file, contentType: 'image/png' });
        if (selector === '#aiImageQuality') {
            const controls = page.locator('#aiImageGptControls');
            const widths = await controls.evaluate(node => [...node.querySelectorAll('select')].map(select => select.getBoundingClientRect().width));
            expect(Math.min(...widths)).toBeGreaterThan(page.viewportSize().width < 600 ? 220 : 160);
            await controls.evaluate(node => node.scrollIntoView({ block: 'center' }));
            const focused = test.info().outputPath(`admin-image25-controls-${theme}-${page.viewportSize().width}-viewport.png`);
            await page.screenshot({ path: focused, fullPage: false, animations: 'disabled' });
            await test.info().attach(`Admin controls ${theme} ${page.viewportSize().width}px`, { path: focused, contentType: 'image/png' });
        }
    }
}
async function lateUploads(page, expect, { model, input, count, remove, run, requests }) {
    while (await page.locator(remove).count()) await page.locator(remove).first().click();
    await expect(page.locator(count)).toHaveText('0 / 16');
    const pending = [];
    await page.route('**/api/ai/images/save', route => {
        if (route.request().postDataJSON().prompt.startsWith('delayed-')) { pending.push(route); return; }
        return json(route, { ok: true, data: { id: 'newer-reference', file_url: '/gpt25-fixture.png' } });
    });
    const settle = async (route, id) => {
        const response = page.waitForResponse(value => value.url().includes('/api/ai/images/save') && value.request().postDataJSON().prompt.startsWith('delayed-'));
        await json(route, { ok: true, data: { id, file_url: '/gpt25-fixture.png' } });
        await (await response).finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await page.locator(input).setInputFiles({ name: 'delayed-model.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => pending.length).toBe(1);
    const originalModel = await page.locator(model).inputValue();
    await page.locator(model).selectOption(originalModel === ids[0] ? ids[1] : ids[0]);
    await page.locator(model).selectOption(originalModel);
    await settle(pending[0], 'stale-model-reference');
    await expect(page.locator(count)).toHaveText('0 / 16');
    await page.locator(input).setInputFiles({ name: 'delayed-slot.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => pending.length).toBe(2);
    await page.locator(input).setInputFiles({ name: 'newer-slot.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator(count)).toHaveText('1 / 16');
    await settle(pending[1], 'stale-slot-reference');
    await expect(page.locator(count)).toHaveText('1 / 16');
    const before = requests.length;
    await page.locator(run).click(); await expect.poll(() => requests.length).toBe(before + 1);
    expect(requests.at(-1).source_images).toEqual([{ source_type: 'saved_asset', asset_id: 'newer-reference' }]);
}
exports.admin = async ({ page, expect, mockAdminAiLab, clickAiLabMode, seedCookieConsent }) => {
    await seedCookieConsent(page);
    const { listAdminAiCatalog } = await import('../../js/shared/admin-ai-contract.mjs');
    const catalog = listAdminAiCatalog({ includeCanvas: true });
    // Local fixtures permit exercising the complete controls; all requests are mocked.
    for (const model of catalog.models.image.filter(model => ids.includes(model.id))) model.capabilities.generationEnabled = true;
    const requests = [];
    await mockAdminAiLab(page, { catalog: { ok: true, ...catalog }, imageTestRequests: requests });
    await syntheticActivation(page);
    const uploads = await uploadFixture(page);
    await page.goto('/admin/index.html#ai-lab'); await clickAiLabMode(page, 'image');
    for (const id of ids) {
        await page.selectOption('#aiImageModel', id);
        await expect(page.locator('#aiImageQuality option')).toHaveText(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
        await expect(page.locator('#aiImageBackground option')).toHaveText(['transparent', 'opaque', 'auto']);
        await expect(page.locator('#aiImagePrompt')).toHaveAttribute('maxlength', '32000');
        await expect(page.locator('#aiImageSourcePickerField > p.admin-ai__hint')).toContainText('16 ordered owned images');
        await expect(page.locator('#aiImageSourcePickerField > p.admin-ai__hint')).toContainText('Reference editing is unavailable');
        if (!uploads.length) {
            await page.selectOption('#aiImageModel', 'xai/grok-imagine-image');
            await expect(page.locator('#aiImageSourcePickerField > p.admin-ai__hint')).toContainText('temporary provider URLs');
            await page.selectOption('#aiImageModel', id);
        }
        await page.locator('#aiImagePrompt').fill('Synthetic decoded fixture edit');
        await page.selectOption('#aiImageQuality', 'max'); await page.selectOption('#aiImageSize', 'auto');
        await page.selectOption('#aiImageBackground', 'transparent'); await page.selectOption('#aiImageOutputFormat', 'webp');
        if (!uploads.length) {
            const slotOrder = [15, ...Array.from({ length: 15 }, (_, index) => index)];
            for (const [position, index] of slotOrder.entries()) {
                await page.locator(`#aiImageRef${index}`).setInputFiles({ name: `${index}.png`, mimeType: 'image/png', buffer: png });
                await expect(page.locator('#aiImageRefCount')).toHaveText(`${position + 1} / 16`);
                if (position === 0) {
                    await expect(page.locator('.admin-ai__ref-add[data-ref-index="0"]')).toBeEnabled();
                    await page.locator('#aiImageRun').click();
                    await expect.poll(() => requests.length).toBe(1);
                    expect(requests[0].source_images).toEqual([{ source_type: 'saved_asset', asset_id: 'ref-1' }]);
                }
            }
            expect(uploads).toHaveLength(16);
            await page.locator('#aiImageRef0').setInputFiles({ name: 'seventeenth.png', mimeType: 'image/png', buffer: png });
            expect(uploads).toHaveLength(16);
            await expect.poll(() => page.locator('.admin-ai__ref-thumb').first().evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
            await page.locator('[data-ref-index="1"] [data-ref-move="-1"]').press('Enter');
        }
        await themes(page, expect, '#aiImageQuality');
        await page.locator('#aiImageRun').click();
        await expect.poll(() => requests.length).toBe(ids.indexOf(id) + 2);
        expect(requests.at(-1)).toMatchObject({ model: id, quality: 'max', size: 'auto', background: 'transparent', outputFormat: 'webp' });
        expect(requests.at(-1).source_images).toHaveLength(16);
        expect(requests.at(-1).source_images.map(source => source.asset_id)).toEqual(['ref-3', 'ref-2', ...Array.from({ length: 13 }, (_, index) => `ref-${index + 4}`), 'ref-1']);
        expect(requests.at(-1)).not.toHaveProperty('referenceImages');
    }
    await page.reload(); await clickAiLabMode(page, 'image');
    await expect(page.locator('#aiImageRefCount')).toHaveText('16 / 16');
    await page.selectOption('#aiImageOutputFormat', 'jpeg'); await page.locator('#aiImageRun').click();
    await expect(page.locator('#aiLabStatus')).toContainText('Transparent background requires PNG or WebP.');
    expect(requests).toHaveLength(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await themes(page, expect, '#aiImageQuality');
    await page.selectOption('#aiImageOutputFormat', 'webp');
    await lateUploads(page, expect, { model: '#aiImageModel', input: '#aiImageRef0', count: '#aiImageRefCount', remove: '.admin-ai__ref-remove:visible', run: '#aiImageRun', requests });
};
exports.member = async ({ page, expect, locale, mockGenerateLabMemberSession }) => {
    await mockGenerateLabMemberSession(page); await syntheticActivation(page); const uploads = await uploadFixture(page);
    const requests = [];
    await page.route('**/api/ai/generate-image', route => { const body = route.request().postDataJSON(); requests.push(body); return json(route, { ok: true, data: { model: body.model, prompt: body.prompt, imageBase64: png.toString('base64'), mimeType: 'image/png', saveReference: 'synthetic-output' } }); });
    await page.goto(locale === 'de' ? '/de/generate-lab/' : '/generate-lab/');
    for (const id of ids) {
        await page.locator('#labImageModel').selectOption(id);
        await expect(page.locator('#labImageQuality option')).toHaveCount(6);
        await page.locator('#labPrompt').fill('Synthetic member reference edit');
        await page.locator('#labImageQuality').selectOption('xhigh'); await page.locator('#labImageSize').selectOption('auto');
        await page.locator('#labImageBackground').selectOption('transparent'); await page.locator('#labImageOutputFormat').selectOption('png');
        await page.locator('#labImageReference1').setInputFiles({ name: 'decoded.png', mimeType: 'image/png', buffer: png });
        await expect(page.locator('#labImageReferenceCount')).toHaveText('1 / 16');
        await expect.poll(() => page.locator('#labImageRefSlot1 img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
        await themes(page, expect, '#labImageQuality');
        await page.locator('#labGenerate').click(); await expect.poll(() => requests.length).toBe(ids.indexOf(id) + 1);
        expect(requests.at(-1)).toMatchObject({ model: id, quality: 'xhigh', size: 'auto', background: 'transparent', outputFormat: 'png', source_images: [{ source_type: 'saved_asset', asset_id: `ref-${uploads.length}` }] });
        expect(requests.at(-1)).not.toHaveProperty('referenceImages');
        await expect.poll(() => page.locator('.generate-lab__image-output').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await themes(page, expect, '#labImageQuality');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await lateUploads(page, expect, { model: '#labImageModel', input: '#labImageReference1', count: '#labImageReferenceCount', remove: '.generate-lab-ref-images__remove:visible', run: '#labGenerate', requests });
};
exports.canvas = async ({ page, expect, locale, mockSharedAuth, createCanvasApiMock }) => {
    await mockSharedAuth(page); await syntheticActivation(page); await uploadFixture(page);
    const { listCanvasModels } = await import('../../js/shared/canvas-model-contract.mjs');
    const models = listCanvasModels().map(model => ids.includes(model.id) ? { ...model, runnable: true, memberCanvasEnabled: true, estimatedCredits: 42, pricingStatus: 'synthetic_fixture' } : model);
    const state = createCanvasApiMock(page, { modelPayload: { models, organizations: [], access: { role: 'user', is_admin: false } } });
    await page.goto(locale === 'de' ? '/de/canvas/' : '/canvas/');
    page.once('dialog', dialog => dialog.accept('Synthetic GPT25')); await page.locator('#canvasNewProject').click();
    await page.locator('#canvasNodeType').selectOption('image_generation'); await page.locator('#canvasAddNode').click();
    const inspector = page.locator('#canvasInspectorBody');
    await inspector.getByRole('combobox', { name: locale === 'de' ? 'Modell' : 'Model', exact: true }).selectOption(ids[0]);
    await inspector.getByRole('combobox', { name: locale === 'de' ? 'Qualität' : 'Quality', exact: true }).selectOption('max');
    await inspector.getByRole('combobox', { name: locale === 'de' ? 'Hintergrund' : 'Background', exact: true }).selectOption('transparent');
    await inspector.getByRole('combobox', { name: locale === 'de' ? 'Dateiformat' : 'File format', exact: true }).selectOption('webp');
    await inspector.locator('input[type="file"]').setInputFiles(Array.from({ length: 16 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: png })));
    await expect.poll(() => state.nodes[0].config?.source_images?.length).toBe(16);
    await inspector.getByRole('button', { name: locale === 'de' ? 'Referenz 2 nach vorne' : 'Move reference 2 earlier', exact: true }).press('Enter');
    await expect.poll(() => state.nodes[0].config?.source_images?.[0]?.asset_id).toBe('ref-2');
    await page.reload(); await page.locator(`[data-node-id="${state.nodes[0].id}"]`).click();
    await expect(inspector.getByRole('combobox', { name: locale === 'de' ? 'Qualität' : 'Quality', exact: true })).toHaveValue('max');
    await expect(inspector.getByText(/16 \/ 16/)).toBeVisible();
    expect(state.nodes[0].config).toMatchObject({ background: 'transparent', outputFormat: 'webp', source_images: [{ asset_id: 'ref-2' }, ...state.nodes[0].config.source_images.slice(1)] });
    await themes(page, expect, '#canvasImageReferencesChoose');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#canvasInspectorToggle').click();
    await themes(page, expect, '#canvasImageReferencesChoose');
};
exports.contract = async ({ page, expect }) => {
    await page.goto('/');
    const contract = await import('../../js/shared/gpt-image-25-contract.mjs');
    const { getAiImageModelConfig } = await import('../../js/shared/ai-image-models.mjs');
    const { validateAdminAiImageBody, buildAdminAiGptImage2Request } = await import('../../js/shared/admin-ai-contract.mjs');
    const { getCanvasModel } = await import('../../js/shared/canvas-model-contract.mjs');
    const { calculateAiImageCreditCost } = await import('../../js/shared/ai-model-pricing.mjs');
    let valid = 0;
    for (const model of contract.GPT_IMAGE_25_MODELS) {
        for (const quality of model.qualityOptions) for (const size of model.sizeOptions) for (const background of model.backgroundOptions) for (const outputFormat of model.outputFormatOptions) {
            const input = { model: model.id, prompt: 'A'.repeat(1201), quality, size, background, outputFormat };
            if (background === 'transparent' && outputFormat === 'jpeg') { expect(() => validateAdminAiImageBody(input)).toThrow('Transparent background requires PNG or WebP.'); continue; }
            const result = buildAdminAiGptImage2Request(getAiImageModelConfig(model.id), validateAdminAiImageBody(input));
            expect(result.payload).toEqual({ prompt: input.prompt, quality, size, background, output_format: outputFormat }); valid++;
        }
        for (const count of [0, 1, 16]) expect(contract.normalizeGptImage25Options({ referenceImageCount: count }).operation).toBe(count ? 'edit' : 'generate');
        expect(() => contract.normalizeGptImage25Options({ referenceImageCount: 17 })).toThrow();
        expect(() => contract.normalizeGptImage25Options({ referenceImageCount: -1 })).toThrow();
        expect(calculateAiImageCreditCost(model.id, { prompt: 'A synthetic prompt' }).credits).toBeGreaterThan(0);
        expect(calculateAiImageCreditCost(model.id, { prompt: 'A synthetic prompt', referenceImageCount: 1 })).toBeNull();
        const target = { id: 'target', type: 'image_generation', model_id: model.id, config: { prompt: 'Edit', referenceOrder: ['z', 'a'], source_images: [{ source_type: 'saved_asset', asset_id: 'selected' }] } };
        const nodes = [target, ...['one', 'two'].map(id => ({ id, type: 'asset_reference', content: { asset: { id, asset_type: 'image' } } }))];
        const edges = [{ id: 'a', target_node_id: 'target', source_node_id: 'one' }, { id: 'z', target_node_id: 'target', source_node_id: 'two' }];
        const result = await page.evaluate(async ({ target, nodes, edges, model }) => {
            const { analyzeNodeInputs, validationForNode } = await import('/js/pages/canvas/workflow.js');
            const analyze = value => analyzeNodeInputs(value, nodes, edges, [model], { promptRequired: 'Add prompt' });
            return { order: analyze(target).compatible.map(value => value.assetId), restored: analyze(JSON.parse(JSON.stringify(target))).compatible.map(value => value.assetId), error: validationForNode(target, analyze(target), { promptRequired: 'Add prompt' }) };
        }, { target, nodes, edges, model: getCanvasModel(model.id) });
        expect(result.order).toEqual(['two', 'one']); expect(result.restored).toEqual(['two', 'one']); expect(result.error).toContain('Editing is unavailable');
    }
    expect(valid).toBe(384);
};
exports.memberPricingGate = async ({ page, expect, locale, mockGenerateLabMemberSession }) => {
    await mockGenerateLabMemberSession(page, { credits: 100000 });
    await uploadFixture(page);
    let dispatched = 0;
    await page.route('**/api/ai/generate-image', route => { dispatched++; return json(route, { ok: false, error: 'Unexpected dispatch' }); });
    await page.goto(locale === 'de' ? '/de/generate-lab/' : '/generate-lab/');
    await page.locator('#labImageModel').selectOption(ids[0]);
    await page.locator('#labPrompt').fill('Verified bounded generation quote');
    await expect(page.locator('#labGenerate')).toBeEnabled();
    await page.locator('#labImageReference1').setInputFiles({ name: 'decoded.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('#labImageReferenceCount')).toHaveText('1 / 16');
    await expect(page.locator('#labGenerate')).toBeDisabled();
    await expect(page.locator('#labImageReferenceCostHint')).toContainText(locale === 'de' ? 'Bearbeitung ist bis zur Prüfung' : 'Editing is unavailable');
    await page.locator('#labImageRefSlot1 .generate-lab-ref-images__remove').click();
    await expect(page.locator('#labGenerate')).toBeEnabled();
    await page.locator('#labImageBackground').selectOption('transparent');
    await page.locator('#labImageOutputFormat').selectOption('jpeg');
    await expect(page.locator('#labGenerate')).toBeDisabled();
    expect(dispatched).toBe(0);
};
exports.canvasLateUpload = async ({ page, expect, mockSharedAuth, createCanvasApiMock }) => {
    await mockSharedAuth(page); await syntheticActivation(page);
    const { listCanvasModels } = await import('../../js/shared/canvas-model-contract.mjs');
    const state = createCanvasApiMock(page, { modelPayload: { models: listCanvasModels(), organizations: [], access: { role: 'user', is_admin: false } } });
    let held, requests = 0;
    await page.route('**/api/ai/images/save', route => { requests++; held = route; });
    await page.goto('/canvas/');
    page.once('dialog', dialog => dialog.accept('Delayed image upload')); await page.locator('#canvasNewProject').click();
    await page.locator('#canvasNodeType').selectOption('image_generation'); await page.locator('#canvasAddNode').click();
    const inspector = page.locator('#canvasInspectorBody');
    const model = inspector.getByRole('combobox', { name: 'Model', exact: true });
    await model.selectOption(ids[0]);
    await inspector.locator('input[type="file"]').setInputFiles([0, 1].map(index => ({ name: `${index}.png`, mimeType: 'image/png', buffer: png })));
    await expect.poll(() => requests).toBe(1);
    // Changing the selected model invalidates this exact upload session.
    await model.selectOption(ids[1]);
    await json(held, { ok: true, data: { id: 'saved-late-upload', file_url: '/gpt25-fixture.png' } });
    await expect(inspector.getByText(/^0 \/ 16/)).toBeVisible();
    await expect.poll(() => state.nodes[0].model_id).toBe(ids[1]);
    await page.reload(); await page.locator(`[data-node-id="${state.nodes[0].id}"]`).click();
    await expect(inspector.getByText(/^0 \/ 16/)).toBeVisible();
    expect(state.nodes[0].config.source_images || []).toEqual([]);
    expect(requests).toBe(1);
    // A selected node's reference snapshot can also change without changing
    // the node/model identity. The real component must preserve that edit.
    await page.evaluate(async () => {
        const { renderCanvasImageReferences } = await import('/js/pages/canvas/image-references.js');
        const node = { config: { source_images: [] } };
        window.gpt25DelayedProbe = { node, assignments: 0 };
        const root = renderCanvasImageReferences({ node, sources: [], german: false, choose() {}, isCurrent: () => true, error(message) { throw Error(message); }, update(value) { window.gpt25DelayedProbe.assignments++; node.config = value; } });
        root.id = 'gpt25DelayedReferenceProbe'; document.body.append(root);
    });
    await page.locator('#gpt25DelayedReferenceProbe input[type="file"]').setInputFiles({ name: 'snapshot.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => requests).toBe(2);
    await page.evaluate(() => { window.gpt25DelayedProbe.node.config.source_images = [{ source_type: 'saved_asset', asset_id: 'new-user-selection' }]; });
    await json(held, { ok: true, data: { id: 'saved-after-selection-change', file_url: '/gpt25-fixture.png' } });
    await expect(page.locator('#gpt25DelayedReferenceProbe input[type="file"]')).toBeEnabled();
    expect(await page.evaluate(() => window.gpt25DelayedProbe)).toEqual({ node: { config: { source_images: [{ source_type: 'saved_asset', asset_id: 'new-user-selection' }] } }, assignments: 0 });
    expect(requests).toBe(2);
};
