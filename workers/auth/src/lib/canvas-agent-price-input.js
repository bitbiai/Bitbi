import { canvasGenerationSettings } from '../../../../js/shared/canvas-generation-settings.mjs';
import { canvasNodeMediaKind } from '../../../../js/shared/canvas-export.mjs';
import { canvasVideoMethods } from '../../../../js/shared/canvas-video-input.mjs';
import { H3_MODEL, h3References, h3MediaType } from '../../../../js/shared/minimax-h3.mjs';
import { OMNI_MODEL, omniReferences, omniOperation } from '../../../../js/shared/gemini-omni-contract.mjs';
import { SEEDANCE_25_MODEL, seedance25References, seedance25Settings } from '../../../../js/shared/seedance-25-contract.mjs';
import { isGptImage25Model } from '../../../../js/shared/gpt-image-25-contract.mjs';

const fail = code => { throw Object.assign(new Error(code), {code, status:400}); };
const parsed = value => typeof value === 'string' ? JSON.parse(value) : value || {};
const currentSource = (source, existingNodes) => {
    const row = existingNodes.find(node => node.id === source?.id) || {};
    return {...row, ...source, content:source?.content || parsed(source?.content_json ?? row.content_json), output:source?.output || parsed(source?.output_json ?? row.output_json)};
};

export function canvasAgentDependencyKind(source, existingNodes = []) {
    const current = currentSource(source, existingNodes);
    if (current.type === 'text_generation') return 'text';
    if (current.type === 'note') return 'note';
    return canvasNodeMediaKind(current) || ({music:'audio'}[current.output?.kind] || current.output?.kind) || null;
}

// Quote-only projection. These placeholders never enter a generation request:
// real execution resolves owned assets, bytes and the current tariff again.
// Counting the intended references here prevents admitting a cheaper operation
// than the normal Canvas request will use after its sources finish.
export function prepareCanvasAgentPriceInput({node, model, dependencies = [], existingNodes = []}) {
    const body = canvasGenerationSettings(node.config || {}, model, node.prompt);
    const identities = new Map();
    const placeholder = identity => {
        if (!identities.has(identity)) identities.set(identity, `canvas_agent_quote_${identities.size + 1}`);
        return {source_type:'saved_asset', asset_id:identities.get(identity)};
    };
    const media = dependencies.map(({dep, source, kind}, index) => {
        const actual = canvasAgentDependencyKind(source, existingNodes) || kind;
        if (kind && actual !== kind && !(actual === 'audio' && kind === 'music')) fail('canvas_agent_reference_unsupported');
        if (dep.role === 'prompt') {
            if (!['text','note'].includes(actual)) fail('canvas_agent_reference_unsupported');
            return null;
        }
        if (!['image','video','audio','music'].includes(actual)) fail('canvas_agent_reference_unsupported');
        const current = currentSource(source, existingNodes);
        // An updated generation creates a new asset; its old selected output is
        // not an identity shared with unchanged existing sources.
        const assetId = !source.update && (current.asset_id || current.assetId || current.output?.assetId || current.content?.asset?.id);
        const identity = assetId || source.key || source.id || dep.key || `dependency:${index}`;
        return {dep, kind:actual === 'music' ? 'audio' : actual, source:placeholder(identity)};
    }).filter(Boolean);

    if ([H3_MODEL, OMNI_MODEL, SEEDANCE_25_MODEL].includes(model.id)) {
        const references = media.map(({dep, kind, source}) => {
            // Role-based adapters receive native video references. Their edit /
            // extend intent belongs to supported model settings, not a generic
            // videoInput method that normal Canvas cannot execute for the model.
            if (dep.method && !['reference','reference_video'].includes(dep.method)
                && !(model.id === H3_MODEL && kind === 'video' && dep.method === 'last_frame')) fail('canvas_agent_reference_unsupported');
            if (kind === 'video' && dep.method === 'last_frame') {
                // The existing H3 adapter converts a prepared last frame to a
                // first-frame image. Omni/Seedance accept native video roles.
                if (model.id !== H3_MODEL) fail('canvas_agent_reference_unsupported');
                return {role:'first_frame', source:placeholder(`frame:${source.asset_id}`)};
            }
            if (h3MediaType(dep.role) !== kind) fail('canvas_agent_reference_unsupported');
            return {role:dep.role, source};
        });
        const validate = model.id === H3_MODEL ? h3References : model.id === OMNI_MODEL ? omniReferences : seedance25References;
        body.references = validate(references);
        if (model.id === OMNI_MODEL) body.operation = omniOperation(body.references);
        if (model.id === SEEDANCE_25_MODEL) Object.assign(body, seedance25Settings(body, body.references));
        if (model.id === H3_MODEL && body.references.some(ref => ['first_frame','last_frame'].includes(ref.role)) && body.aspect_ratio !== 'adaptive') fail('canvas_agent_reference_unsupported');
        delete body.referenceOrder;
        return body;
    }

    const videos = media.filter(ref => ref.kind === 'video');
    const images = media.filter(ref => ref.kind === 'image');
    if (media.some(ref => ref.kind === 'audio')) fail('canvas_agent_reference_unsupported');
    if (videos.length > 1) fail('canvas_agent_reference_limit');
    if (videos.length) {
        const video = videos[0], method = video.dep.method;
        if (!canvasVideoMethods(model, {kind:'video_asset', assetId:'quote-only'}).includes(method)) fail('canvas_agent_reference_unsupported');
        if (method === 'last_frame') {
            if (images.length) fail('canvas_agent_reference_unsupported');
            body.source_image = placeholder(`frame:${video.source.asset_id}`);
        } else {
            body._operation = method;
            body.source_video = video.source;
        }
    }
    const uniqueImages = [...new Map(images.map(ref => [ref.source.asset_id, ref.source])).values()];
    if (isGptImage25Model(model.id)) {
        // Ordinary GPT 2.5 includes every explicitly selected image and connected
        // edge, including duplicates. Its unverified reference tariff still fails.
        const selected = node.config?.source_images || [];
        if (!Array.isArray(selected)) fail('canvas_agent_reference_unsupported');
        const all = [...selected.map((_, index) => placeholder(`selected:${index}`)), ...images.map(ref => ref.source)];
        if (all.length > 16) fail('canvas_agent_reference_limit');
        body.source_images = all;
        body.referenceImageCount = all.length;
        delete body.referenceOrder;
        return body;
    }
    if (uniqueImages.length) {
        const maximum = model.capability === 'image'
            ? Math.max(1, Math.min(Number(model.controls.maxReferenceImages || 1), model.id === 'xai/grok-imagine-image-2.0' ? 5 : 4))
            : model.id.startsWith('xai/grok-imagine-video') ? model.controls.maxReferenceImages : 1;
        if (model.capability === 'image' && !model.controls.supportsReferenceImages
            || model.capability === 'video' && !model.controls.supportsImageInput) fail('canvas_agent_reference_unsupported');
        if (uniqueImages.length > maximum) fail('canvas_agent_reference_limit');
        body.referenceImageCount = uniqueImages.length;
        body.referenceImages = uniqueImages.map(() => ({}));
        if (model.id.startsWith('xai/grok-imagine-video')) body.source_images = uniqueImages;
        // The existing pricing contract caps EACH input at 32 MP. Planned media
        // have no authoritative byte measurement yet; editable dimensions cannot
        // lower this bound. An array preserves the sum for multiple references.
        if (['@cf/black-forest-labs/flux-2-klein-9b','black-forest-labs/flux-2-klein-9b','black-forest-labs/flux-2-max'].includes(model.id)) {
            body.inputImageMegapixels = uniqueImages.map(() => 32);
        }
    }
    if (model.id === 'elevenlabs/music-v2') body.duration_ms = node.config?.musicLengthMs;
    return body;
}
