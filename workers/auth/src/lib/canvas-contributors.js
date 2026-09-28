import { sha256Hex } from './tokens.js';

const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
export async function captureCanvasContributors(resolution, generation) {
  const sources = resolution.sources.filter(source => source.status === 'compatible' &&
    (source.used === true || (source.inputKind === 'prompt' && generation.prompt && ['connected', 'combined'].includes(resolution.promptSource))));
  return Promise.all(sources.map(async source => ({ edgeId: source.edgeId, nodeId: source.sourceNodeId,
    runId: source.runId || null, assetId: source.assetId || null,
    version: source.videoInput?.sourceVersion || await sha256Hex(source.text || source.assetId || ''),
  })));
}

export function sameCanvasInput(previous, next) {
  if (previous === next) return true;
  const old = parse(previous), current = parse(next);
  // New provenance is additive evidence, not authority to replay a historical
  // failed run. All pre-existing request identity fields still have to match.
  if (Object.hasOwn(old, 'used_sources')) return false;
  delete current.used_sources;
  return JSON.stringify(old) === JSON.stringify(current);
}

export async function resolveCanvasContributors(env, userId, projectId, runId) {
  const read = id => env.DB.prepare(`SELECT id, node_id, status, input_json, asset_id FROM canvas_runs
    WHERE id=? AND project_id=? AND user_id=? AND deleted_at IS NULL`).bind(id, projectId, userId).first();
  const root = await read(runId);
  if (!root || root.status !== 'completed') throw Object.assign(new Error('Completed Canvas output not found.'), { status: 404, code: 'canvas_output_not_found' });
  const queue = [root], visited = new Set(), nodes = new Set(), edges = new Map();
  const cached = new Map([[root.id, root]]);
  let incomplete = false;
  const parentRun = async id => {
    if (!cached.has(id)) {
      // Bound failed/missing legacy lookups too, not only traversed runs/edges.
      if (cached.size >= 500) { incomplete = true; return null; }
      cached.set(id, await read(id));
    }
    return cached.get(id);
  };
  while (queue.length && visited.size < 200 && edges.size < 500) {
    const run = queue.shift(); if (visited.has(run.id)) continue; visited.add(run.id);
    const input = parse(run.input_json);
    let sources = input.used_sources;
    if (!Array.isArray(sources)) {
      incomplete = true; sources = [];
      // Legacy continuation records name an immutable successful run and asset.
      // connected_node_ids alone cannot establish which inputs were used.
      for (const video of (Array.isArray(input.connected_video_inputs) ? input.connected_video_inputs : []).slice(0, 200)) {
        if (!video.runId || !video.assetId || !video.edgeId) continue;
        const parent = await parentRun(video.runId);
        if (parent?.status === 'completed' && parent.asset_id === video.assetId) sources.push({ edgeId: video.edgeId, nodeId: parent.node_id, runId: parent.id, assetId: parent.asset_id });
      }
    }
    if (sources.length > 200) incomplete = true;
    for (const source of sources.slice(0, 200)) {
      if (!source.nodeId || !source.edgeId || edges.size >= 500) { incomplete = true; continue; }
      nodes.add(source.nodeId);
      edges.set(source.edgeId, { id: source.edgeId, sourceNodeId: source.nodeId, targetNodeId: run.node_id });
      if (source.runId && !visited.has(source.runId)) {
        const parent = await parentRun(source.runId);
        if (parent?.status === 'completed' && parent.node_id === source.nodeId && (!source.assetId || parent.asset_id === source.assetId)) queue.push(parent);
        else incomplete = true;
      }
    }
  }
  return { runId, nodeIds: [...nodes], edges: [...edges.values()], incomplete: incomplete || queue.length > 0 };
}
