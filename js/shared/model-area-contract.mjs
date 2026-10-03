import { getMemberExposedModels } from './member-model-exposure.mjs';
import { listCanvasModels } from './canvas-model-contract.mjs';

export const MODEL_AREAS = Object.freeze(['generation', 'canvas', 'main']);
// Membership is derived from the actual generation contracts. This is an area
// projection, not another provider/model registry. Main has one designated model.
export function modelAreaCatalog(mainModel) {
    const rows = new Map();
    function add(model, area) {
        const row = rows.get(model.id) || { id:model.id, label:model.label, vendor:model.vendor || 'Cloudflare', mediaType:model.mediaType || model.capability || 'chat', areas:[] };
        if (!row.areas.includes(area)) row.areas.push(area);
        rows.set(row.id, row);
    }
    for (const model of getMemberExposedModels()) add(model, 'generation');
    for (const model of listCanvasModels().filter(model => model.runnable)) add(model, 'canvas');
    if (mainModel) add({id:mainModel, label:mainModel.includes('apertus') ? 'Apertus v1.5 8B' : 'EuroLLM 9B IT', mediaType:'chat'}, 'main');
    return [...rows.values()];
}
export const modelAreaKey = (modelId, area) => `model_area:${area}:${modelId}`;
