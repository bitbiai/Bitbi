// This purpose is intentionally outside the inference graph.
export const EXPORT_MUSIC_PURPOSE = 'export_background_music';
export const isExportMusic = config => config?.purpose === EXPORT_MUSIC_PURPOSE;

export const canvasClipIdentity = clip => ({ runId: clip.runId, assetId: clip.assetId, version: clip.version });
export const sameCanvasClip = (a, b) => Boolean(a && b && a.runId === b.runId && a.assetId === b.assetId && a.version === b.version);
const videoNode = node => node?.type === 'video_generation' || node?.output?.kind === 'video'
    || node?.content?.asset?.asset_type === 'video';

// The blue strand and export order share this current-graph resolver. Immutable
// generation ancestry is evidence about included footage, never graph membership.
export function canvasMergeStrand(nodes, edges, endpointId) {
    const byId = new Map(nodes.map(node => [node.id, node])), nodeIds = [], links = [], seen = new Set();
    let id = endpointId;
    const failed = error => ({ nodeIds: [], edges: [], error });
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
    const clips = strand.nodeIds.map(id => choices.find(clip => clip.nodeId === id));
    if (clips.some(clip => !clip)) return { ...strand, clips: [], error: 'canvas_chain_unavailable' };
    const included = new Set();
    for (const clip of clips) for (const parent of clip.includedSources || []) {
        const current = clips.find(candidate => candidate.runId === parent.runId);
        if (!current) continue;
        if (!sameCanvasClip(current, parent)) return { ...strand, clips: [], error: 'canvas_chain_provenance' };
        included.add(current.runId);
    }
    const sequence = clips.filter(clip => !included.has(clip.runId));
    const error = sequence.length < 2 ? 'canvas_chain_too_short'
        : new Set(sequence.map(clip => clip.assetId)).size !== sequence.length ? 'canvas_sequence_invalid' : null;
    return { ...strand, clips: sequence, error, includedCount: included.size };
}
export function exportMusicSettings(value = { enabled: false, gain: 1 }) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['enabled', 'gain', 'musicAssetId'].includes(key))
        || (value.musicAssetId!==undefined && (typeof value.musicAssetId!=='string' || !/^[a-f0-9]{32}$/.test(value.musicAssetId)))
        || typeof value.enabled !== 'boolean' || typeof value.gain !== 'number'
        || !Number.isFinite(value.gain) || value.gain < 0 || value.gain > 1) {
        throw Object.assign(new Error('Invalid background music settings.'), { code: 'canvas_music_settings', status: 400 });
    }
    return { enabled: value.enabled, gain: value.gain, ...(value.musicAssetId?{musicAssetId:value.musicAssetId}:{}) };
}
