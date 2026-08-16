/* ============================================================
   BITBI — Member model exposure contract
   The single membership source for member generation surfaces.
   Server routes remain authoritative for request validation, billing,
   rate limits, and provider execution.
   ============================================================ */

import {
    getAiImageModelConfig,
    getGenerateLabAiImageModelOptions,
} from './ai-image-models.mjs';
import {
    GROK_IMAGINE_VIDEO_MODEL_ID,
    GROK_IMAGINE_VIDEO_MODEL_LABEL,
    GROK_IMAGINE_VIDEO_VENDOR,
} from './grok-imagine-video-pricing.mjs';
import {
    HAPPYHORSE_T2V_MODEL_ID,
    HAPPYHORSE_T2V_MODEL_LABEL,
    HAPPYHORSE_T2V_VENDOR,
} from './happyhorse-t2v-pricing.mjs';
import { MINIMAX_MUSIC_2_6_MODEL_ID } from './music-2-6-pricing.mjs';
import {
    PIXVERSE_V6_MODEL_ID,
    PIXVERSE_V6_MODEL_LABEL,
} from './pixverse-v6-pricing.mjs';
import { SEEDANCE_2_FAST_MODEL_ID } from './seedance-2-pricing.mjs';

function imageExposure(model) {
    const config = getAiImageModelConfig(model?.id);
    return Object.freeze({
        id: model.id,
        mediaType: 'image',
        label: model.label,
        vendor: config?.vendor || config?.provider || '',
    });
}

const MEMBER_IMAGE_MODEL_EXPOSURE = Object.freeze(
    getGenerateLabAiImageModelOptions().map(imageExposure),
);

const MEMBER_NON_IMAGE_MODEL_EXPOSURE = Object.freeze([
    Object.freeze({
        id: PIXVERSE_V6_MODEL_ID,
        mediaType: 'video',
        label: PIXVERSE_V6_MODEL_LABEL,
        vendor: 'PixVerse',
    }),
    Object.freeze({
        id: HAPPYHORSE_T2V_MODEL_ID,
        mediaType: 'video',
        label: HAPPYHORSE_T2V_MODEL_LABEL,
        vendor: HAPPYHORSE_T2V_VENDOR,
    }),
    Object.freeze({
        id: SEEDANCE_2_FAST_MODEL_ID,
        mediaType: 'video',
        label: 'Seedance 2.0 Fast',
        vendor: 'ByteDance',
    }),
    Object.freeze({
        id: GROK_IMAGINE_VIDEO_MODEL_ID,
        mediaType: 'video',
        label: GROK_IMAGINE_VIDEO_MODEL_LABEL,
        vendor: GROK_IMAGINE_VIDEO_VENDOR,
    }),
    Object.freeze({
        id: MINIMAX_MUSIC_2_6_MODEL_ID,
        mediaType: 'music',
        label: 'MiniMax Music 2.6',
        vendor: 'MiniMax',
    }),
]);

export const MEMBER_MODEL_EXPOSURE = Object.freeze([
    ...MEMBER_IMAGE_MODEL_EXPOSURE,
    ...MEMBER_NON_IMAGE_MODEL_EXPOSURE,
]);

const MEMBER_MODEL_EXPOSURE_BY_ID = new Map(
    MEMBER_MODEL_EXPOSURE.map((model) => [model.id, model]),
);

export function getMemberExposedModels() {
    return MEMBER_MODEL_EXPOSURE;
}

export function getMemberExposedModelsByMediaType(mediaType) {
    return MEMBER_MODEL_EXPOSURE.filter((model) => model.mediaType === mediaType);
}

export function getMemberExposedModel(modelId) {
    return MEMBER_MODEL_EXPOSURE_BY_ID.get(modelId) || null;
}

export function isMemberModelExposed(modelId, mediaType = null) {
    const model = getMemberExposedModel(modelId);
    return !!model && (mediaType === null || model.mediaType === mediaType);
}
