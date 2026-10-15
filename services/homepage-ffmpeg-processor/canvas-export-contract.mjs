// This purpose is intentionally outside the inference graph.
export const EXPORT_MUSIC_PURPOSE = 'export_background_music';
export const isExportMusic = config => config?.purpose === EXPORT_MUSIC_PURPOSE;
export const canvasExportSubject = value => value?.nodeId
    ? { id: value.nodeId, column: 'node_id', runId: null, nodeId: value.nodeId, key: `node:${value.nodeId}`, path: `nodes/${value.nodeId}` }
    : { id: value, column: 'run_id', runId: value, nodeId: null, key: `run:${value}`, path: `runs/${value}` };

export const canvasClipKey = clip => clip?.runId ? `run:${clip.runId}` : clip?.nodeId ? `node:${clip.nodeId}` : '';
export const canvasClipIdentity = clip => ({ ...(clip.runId ? { runId: clip.runId } : { nodeId: clip.nodeId }), assetId: clip.assetId, version: clip.version });
export const sameCanvasClip = (a, b) => Boolean(a && b && canvasClipKey(a) && canvasClipKey(a) === canvasClipKey(b) && a.assetId === b.assetId && a.version === b.version);
export const canvasNodeMediaKind = node => node?.type === 'asset_reference'
    ? ({ video: 'video', image: 'image', audio: 'audio', music: 'audio' }[node.content?.asset?.asset_type] || null)
    : node?.output?.kind || ({ video_generation: 'video', image_generation: 'image', music_generation: 'audio' }[node?.type] || null);
const videoNode = node => canvasNodeMediaKind(node) === 'video';

// The blue strand and export order share this current-graph resolver. Immutable
// generation ancestry is evidence about included footage, never graph membership.
export function canvasMergeStrand(nodes, edges, endpointId) {
    const byId = new Map(nodes.map(node => [node.id, node])), nodeIds = [], links = [], seen = new Set();
    let id = endpointId;
    const failed = error => ({ nodeIds: [], edges: [], error });
    if (!id || !byId.has(id)) return failed('canvas_chain_endpoint_missing');
    while (id) {
        if (seen.has(id)) return failed('canvas_chain_cycle');
        if (seen.size >= 120) return failed('canvas_chain_limit');
        const node = byId.get(id);
        if (!node || !videoNode(node)) return failed('canvas_chain_broken');
        seen.add(id); nodeIds.unshift(id);
        const incoming = edges.filter(edge => edge.target_node_id === id && !isExportMusic(edge.config));
        if (incoming.some(edge => !byId.has(edge.source_node_id))) return failed('canvas_chain_broken');
        const video = incoming.filter(edge => videoNode(byId.get(edge.source_node_id)));
        if (video.length > 1) return failed('canvas_chain_ambiguous');
        if (!video.length) break;
        const edge = video[0];
        links.unshift({ id: edge.id, sourceNodeId: edge.source_node_id, targetNodeId: edge.target_node_id });
        id = edge.source_node_id;
    }
    return { nodeIds, edges: links, error: null };
}

export function canvasMergeSequence(strand, choices) {
    if (strand.error) return { ...strand, clips: [] };
    if (!strand.nodeIds.length) return { ...strand, clips: [], error: 'canvas_chain_endpoint_missing' };
    const clips = strand.nodeIds.map(id => choices.find(clip => clip.nodeId === id));
    if (!clips.at(-1)) return { ...strand, clips: [], error: 'canvas_chain_endpoint_unavailable' };
    if (clips.some(clip => !clip)) return { ...strand, clips: [], error: 'canvas_chain_unavailable' };
    const included = new Set();
    for (const clip of clips) for (const parent of clip.includedSources || []) {
        const current = clips.find(candidate => canvasClipKey(candidate) === canvasClipKey(parent));
        if (!current) continue;
        if (!sameCanvasClip(current, parent)) return { ...strand, clips: [], error: 'canvas_chain_provenance' };
        included.add(canvasClipKey(current));
    }
    const sequence = clips.filter(clip => !included.has(canvasClipKey(clip)));
    const error = sequence.length < 2 ? 'canvas_chain_too_short'
        : new Set(sequence.map(canvasClipKey)).size !== sequence.length ? 'canvas_sequence_invalid' : null;
    return { ...strand, clips: sequence, error, includedCount: included.size };
}
export function exportMusicSettings(value = { enabled: false, gain: 1 }) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['enabled', 'gain', 'musicAssetId', 'fadeIn', 'fadeOut'].includes(key))
        || ['fadeIn', 'fadeOut'].some(key => value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 600))
        || (value.musicAssetId!==undefined && (typeof value.musicAssetId!=='string' || !/^[a-f0-9]{32}$/.test(value.musicAssetId)))
        || typeof value.enabled !== 'boolean' || typeof value.gain !== 'number'
        || !Number.isFinite(value.gain) || value.gain < 0 || value.gain > 1) {
        throw Object.assign(new Error('Invalid background music settings.'), { code: 'canvas_music_settings', status: 400 });
    }
    return { enabled: value.enabled, gain: value.gain, ...(value.musicAssetId?{musicAssetId:value.musicAssetId}:{}),
        ...(value.fadeIn !== undefined ? {fadeIn:value.fadeIn} : {}), ...(value.fadeOut !== undefined ? {fadeOut:value.fadeOut} : {}) };
}
