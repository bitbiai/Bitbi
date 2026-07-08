const GENERATION_CAPABILITY = Object.freeze({
    text_generation: 'text',
    image_generation: 'image',
    video_generation: 'video',
    music_generation: 'music',
});

function assetKind(asset) {
    const type = String(asset?.asset_type || asset?.assetType || '').toLowerCase();
    const mime = String(asset?.mime_type || asset?.mimeType || '').toLowerCase();
    if (type === 'image' || mime.startsWith('image/')) return 'image_asset';
    if (type === 'video' || mime.startsWith('video/')) return 'video_asset';
    if (type === 'audio' || type === 'music' || mime.startsWith('audio/')) return 'audio_asset';
    return 'json';
}

function expectedKind(node) {
    if (node?.type === 'text_prompt') return 'prompt';
    if (node?.type === 'text_generation' || node?.type === 'note') return 'text';
    if (node?.type === 'image_generation') return 'image_asset';
    if (node?.type === 'video_generation') return 'video_asset';
    if (node?.type === 'music_generation') return 'audio_asset';
    return 'none';
}

export function nodeOutputValue(node) {
    const title = node?.title || node?.type || 'Node';
    const base = { sourceNodeId: node?.id, sourceTitle: title, sourceType: node?.type };
    if (node?.type === 'text_prompt') {
        const text = String(node.content?.prompt || node.content?.text || '').trim();
        return text ? { ...base, kind: 'prompt', text } : { ...base, kind: 'none', expectedKind: 'prompt' };
    }
    if (node?.type === 'note') {
        const text = String(node.content?.text || node.content?.prompt || '').trim();
        return text ? { ...base, kind: 'text', text } : { ...base, kind: 'none', expectedKind: 'text' };
    }
    if (node?.output?.kind === 'text' && String(node.output.text || '').trim()) {
        return { ...base, kind: 'text', text: String(node.output.text).trim(), runId: node.output.runId || null };
    }
    const asset = node?.content?.asset || node?.output?.asset || (node?.asset_id ? {
        id: node.asset_id,
        asset_type: node.output?.assetType,
        mime_type: node.output?.mimeType,
        preview_url: node.output?.previewUrl,
        file_url: node.output?.fileUrl,
    } : null);
    if (asset?.id) return {
        ...base,
        kind: assetKind(asset),
        assetId: asset.id,
        assetType: asset.asset_type || asset.assetType || node.output?.assetType || null,
        mimeType: asset.mime_type || asset.mimeType || node.output?.mimeType || null,
        previewUrl: asset.preview_url || asset.previewUrl || node.output?.previewUrl || null,
        fileUrl: asset.file_url || asset.fileUrl || node.output?.fileUrl || null,
        runId: node.output?.runId || null,
    };
    if (node?.output?.kind === 'json') return { ...base, kind: 'json', json: node.output.json || null };
    return { ...base, kind: 'none', expectedKind: expectedKind(node) };
}

function compatibility(target, model, kind, copy) {
    if (target.type === 'output_result') return { compatible: kind !== 'none', inputKind: kind };
    if (kind === 'text' || kind === 'prompt') return { compatible: true, inputKind: 'prompt' };
    if (kind === 'image_asset' || kind === 'image_reference') {
        if (target.type === 'image_generation' && model?.controls?.supportsReferenceImages) return { compatible: true, inputKind: 'image_reference' };
        if (target.type === 'video_generation' && model?.controls?.supportsImageInput) return { compatible: true, inputKind: 'image_reference' };
        return { compatible: false, inputKind: 'image_reference', reason: copy.imageInputUnsupported.replace('{model}', model?.label || copy.selectedModel) };
    }
    if (kind === 'video_asset' || kind === 'video_reference') {
        if (target.type === 'video_generation' && model?.controls?.supportsVideoInput) return { compatible: true, inputKind: 'video_reference' };
        return { compatible: false, inputKind: 'video_reference', reason: copy.videoInputUnsupported.replace('{model}', model?.label || copy.selectedModel) };
    }
    if (kind === 'audio_asset') return { compatible: false, inputKind: 'audio_asset', reason: copy.audioInputUnsupported };
    if (kind === 'json') return { compatible: false, inputKind: 'json', reason: copy.jsonInputUnsupported };
    return { compatible: false, inputKind: 'none', reason: copy.noUsableOutput };
}

export function analyzeNodeInputs(target, nodes, edges, models, copy) {
    const model = models.find((item) => item.id === target?.model_id)
        || models.find((item) => item.capability === GENERATION_CAPABILITY[target?.type] && item.runnable)
        || null;
    const incoming = edges
        .filter((edge) => edge.target_node_id === target?.id)
        .map((edge, index) => ({ edge, index, source: nodes.find((node) => node.id === edge.source_node_id) }))
        .filter((item) => item.source);
    const sources = incoming.map(({ edge, source }) => {
        const value = nodeOutputValue(source);
        const kind = value.kind === 'none' ? value.expectedKind : value.kind;
        const accepted = compatibility(target, model, kind, copy);
        const status = value.kind === 'none' ? (accepted.compatible ? 'unresolved' : 'incompatible') : (accepted.compatible ? 'compatible' : 'incompatible');
        return { ...value, edgeId: edge.id, inputKind: accepted.inputKind, status, reason: status === 'unresolved' ? copy.runUpstream : accepted.reason || '' };
    });
    const compatible = sources.filter((item) => item.status === 'compatible');
    const connectedPrompt = compatible.filter((item) => item.inputKind === 'prompt' && item.text).map((item) => item.text).join('\n\n').trim();
    const directPrompt = String(target?.config?.prompt || target?.content?.prompt || target?.content?.text || '').trim();
    return {
        model,
        sources,
        compatible,
        incompatible: sources.filter((item) => item.status === 'incompatible'),
        unresolved: sources.filter((item) => item.status === 'unresolved'),
        connectedPrompt,
        directPrompt,
        effectivePrompt: directPrompt || connectedPrompt,
        promptSource: directPrompt ? 'direct' : connectedPrompt ? 'connected' : 'none',
    };
}

export function analyzeWorkflow(nodes, edges, models, copy) {
    const byNode = new Map();
    const edgeStates = new Map();
    for (const node of nodes) {
        const analysis = analyzeNodeInputs(node, nodes, edges, models, copy);
        byNode.set(node.id, analysis);
        for (const source of analysis.sources) edgeStates.set(source.edgeId, { status: source.status, reason: source.reason });
    }
    return { byNode, edgeStates };
}

export function validationForNode(node, analysis, copy) {
    if (!GENERATION_CAPABILITY[node?.type]) return null;
    if (analysis?.incompatible.length) return analysis.incompatible[0].reason;
    if (analysis?.unresolved.length) return `${analysis.unresolved[0].sourceTitle}: ${copy.runUpstream}`;
    if (!analysis?.effectivePrompt) return copy.promptRequired;
    return null;
}

export function upstreamDisplayNode(node, nodes, edges, visited = new Set()) {
    if (!node || visited.has(node.id)) return node;
    visited.add(node.id);
    if (node.output || node.content?.asset) return node;
    if (node.type !== 'output_result') return node;
    const candidates = edges
        .filter((edge) => edge.target_node_id === node.id)
        .map((edge) => nodes.find((item) => item.id === edge.source_node_id))
        .filter(Boolean)
        .reverse();
    for (const source of candidates) {
        const resolved = upstreamDisplayNode(source, nodes, edges, visited);
        if (resolved?.output || resolved?.content?.asset) return resolved;
    }
    return node;
}
