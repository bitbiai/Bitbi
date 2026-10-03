import { OMNI_MODEL, normalizeOmniRequest } from '../../shared/gemini-omni-contract.mjs';
import { getBrowserTariff } from '../../shared/model-tariff.mjs';
import { createH3ReferenceControls } from '../../shared/h3-reference-controls.js?v=__ASSET_VERSION__';

export function omniLabBody(form, references) {
    return { model: OMNI_MODEL, prompt: form.prompt.trim(), resolution: form.resolution, aspect_ratio: form.aspectRatio, references };
}
export function validateOmniLab(form, references) {
    if (!getBrowserTariff()?.omni?.adminTestEnabled) return 'Paid Omni Admin testing is off. Configure its reservation and enable it explicitly in Model Status.';
    try { normalizeOmniRequest(omniLabBody(form, references)); return null; }
    catch (error) { return error.message; }
}
export function createOmniLabControls({ video, assets, form, changed, picker }) {
    return createH3ReferenceControls({ omni: true, anchor: video.prompt.closest('label') || video.prompt,
        classes: { root: 'admin-ai__field', select: 'admin-ai__select', button: 'admin-ai__btn admin-ai__btn--secondary' },
        read: () => form().omniReferences || [], write: value => { form().omniReferences = value; }, changed,
        pick: async request => {
            await picker.startPickerMode({ max: 1,
                isAssetCompatible: asset => request.media === 'image' ? asset.asset_type === 'image' || asset.source_module === 'image' : asset.source_module === (request.media === 'audio' ? 'music' : 'video'),
                onApply: request.onApply, onApplied: () => request.trigger.focus(), onCancel: () => request.trigger.focus() });
            assets.root.scrollIntoView({ block: 'nearest' });
        },
    });
}
