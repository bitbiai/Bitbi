import { SEEDANCE_25_MODEL, normalizeSeedance25Request } from '../../shared/seedance-25-contract.mjs';
import { createSeedance25Controls } from '../../shared/seedance-25-controls.js';

// Persist only supported input settings; provider URLs and private output bytes
// belong to existing durable jobs, never the browser form snapshot.
export function snapshotVideoPayload(payload = {}) {
    if(payload.model===SEEDANCE_25_MODEL)return normalizeSeedance25Request(payload);
    return {
        preset: payload.preset || undefined,
        model: payload.model || undefined,
        prompt: typeof payload.prompt === 'string' ? payload.prompt : null,
        duration: Number.isFinite(Number(payload.duration)) ? Number(payload.duration) : undefined,
        aspect_ratio: payload.aspect_ratio || undefined,
        ratio: payload.ratio || undefined,
        quality: payload.quality || undefined,
        resolution: payload.resolution || undefined,
        references: payload.references ? structuredClone(payload.references) : undefined,
        seed: payload.seed ?? null,
        generate_audio: payload.generate_audio ?? payload.audio ?? null,
        audio: payload.audio ?? undefined,
        watermark: payload.watermark ?? null,
        hasImageInput: !!(payload.image_input || payload.start_image),
        hasVideoInput: !!(payload.video || payload.source_video),
        hasEndImageInput: !!payload.end_image,
        source_type: payload.source_video?.source_type || undefined,
        source_asset_id: payload.source_video?.asset_id || undefined,
        workflow: payload._operation === 'extend'
            ? 'video_extend'
            : payload._operation === 'edit'
                ? 'video_edit'
                : payload.end_image
                    ? 'start_end_to_video'
                    : payload.start_image || payload.image_input
                        ? 'image_to_video'
                        : 'text_to_video',
    };
}

// Manual recovery may open a job from another browser. The current form is not
// evidence of that job's inputs; Seedance save provenance comes from its server job.
export function fallbackVideoPayload(form, model) {
    return model === SEEDANCE_25_MODEL ? { model } : snapshotVideoPayload({ ...form, model });
}


export function createSeedance25Lab(refs,state,savedAssetsBrowser,changed) {
    return createSeedance25Controls({anchor:refs.video.prompt.closest('label')||refs.video.prompt,
        classes:{root:'admin-ai__field',select:'admin-ai__select',button:'admin-ai__btn admin-ai__btn--secondary'},
        read:()=>state.forms.video.seedance25 || {},write:value=>{state.forms.video.seedance25=value;},changed,
        pick:async request=>{await savedAssetsBrowser.startPickerMode({max:1,isAssetCompatible:asset=>request.media==='image'?asset.asset_type==='image'||asset.source_module==='image':asset.source_module===(request.media==='audio'?'music':'video'),onApply:request.onApply,onApplied:()=>request.trigger.focus(),onCancel:()=>request.trigger.focus()});refs.savedAssets.root.scrollIntoView({block:'nearest'});}});
}
