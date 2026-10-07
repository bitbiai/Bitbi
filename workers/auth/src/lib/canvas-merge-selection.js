import { sequenceTransitions } from '../../../../js/shared/canvas-transitions.mjs';
import { ownedCanvasVideo } from './canvas-video-input.js';
import { canvasProcessingError as fail, parseCanvasJson as parse, CANVAS_VIDEO_LIMITS } from './canvas-video-processing.js';
import { canvasMergeStrand, canvasMergeSequence, sameCanvasClip, canvasClipIdentity, canvasClipKey } from '../../../../js/shared/canvas-export.mjs';
import { originalAudioSettings } from '../../../../js/shared/canvas-audio.mjs';

async function includedSources(env, userId, projectId, run) {
  const included = [], seen = new Set([run.id]);
  let input = parse(run.input_json);
  while (input.connected_video_inputs?.length === 1 && ['edit', 'extend'].includes(input.connected_video_inputs[0].method)) {
    const parent = input.connected_video_inputs[0];
    if (!parent.runId && parent.nodeId && parent.assetId && parent.sourceVersion) {
      const asset = await ownedCanvasVideo(env, userId, parent.assetId, parent.sourceVersion, 80_000_000);
      included.push({ nodeId: parent.nodeId, assetId: asset.id, version: asset.version });
      break; // An imported source has no generation ancestry.
    }
    if (seen.has(parent.runId) || seen.size >= 120) throw fail('canvas_chain_cycle');
    seen.add(parent.runId);
    const prior = await env.DB.prepare('SELECT id,asset_id,input_json FROM canvas_runs WHERE id=? AND user_id=? AND project_id=? AND deleted_at IS NULL')
      .bind(parent.runId, userId, projectId).first();
    if (!prior || prior.asset_id !== parent.assetId || !parent.sourceVersion) throw fail('canvas_chain_provenance');
    const asset = await ownedCanvasVideo(env, userId, parent.assetId, parent.sourceVersion, 80_000_000);
    included.push({ runId: prior.id, assetId: asset.id, version: asset.version });
    input = parse(prior.input_json);
  }
  return included;
}

export async function canvasMergeView(env, userId, projectId, runId) {
  const [nodeRows, edgeRows, runRows] = await env.DB.batch([
    env.DB.prepare('SELECT id,type,title,asset_id,output_json,content_json,config_json,created_at FROM canvas_nodes WHERE user_id=? AND project_id=? AND deleted_at IS NULL ORDER BY id').bind(userId, projectId),
    env.DB.prepare('SELECT id,source_node_id,target_node_id,config_json FROM canvas_edges WHERE user_id=? AND project_id=? AND deleted_at IS NULL ORDER BY id').bind(userId, projectId),
    // Selected output, its owning node and its immutable completed run must agree.
    // Neither account assets nor project run history defines this list.
    env.DB.prepare(`SELECT r.* FROM canvas_runs r JOIN canvas_nodes n ON n.id=r.node_id AND n.user_id=r.user_id AND n.project_id=r.project_id
      AND n.asset_id=r.asset_id AND json_extract(n.output_json,'$.runId')=r.id
      WHERE r.user_id=? AND r.project_id=? AND r.deleted_at IS NULL AND n.deleted_at IS NULL
      AND r.status='completed' AND r.operation_type='canvas.video.generate'
      AND json_extract(n.output_json,'$.kind')='video' AND json_extract(r.output_json,'$.kind')='video'
      ORDER BY n.id`).bind(userId, projectId),
  ]);
  const nodes = nodeRows.results.map(row => ({ ...row, output: parse(row.output_json), content: parse(row.content_json) }));
  const edges = edgeRows.results.map(row => ({ ...row, config: parse(row.config_json) }));
  const availableClips = [];
  for (const run of runRows.results) {
    const node = nodes.find(node => node.id === run.node_id), output = parse(run.output_json);
    const version = output.sourceVersion;
    if (!/^[a-f0-9]{64}$/.test(version || '') || node.output.sourceVersion !== version
      || (node.output.assetId || node.output.asset?.id) !== run.asset_id) continue;
    try {
      const asset = await ownedCanvasVideo(env, userId, run.asset_id, version, 80_000_000);
      availableClips.push({ nodeId: node.id, title: node.title || '', runId: run.id, assetId: asset.id, version,
        modelId: run.model_id, createdAt: run.created_at, size: asset.size, originalAudio: originalAudioSettings(parse(node.config_json).originalAudio),
        includedSources: await includedSources(env, userId, projectId, run) });
    } catch (error) {
      if (!error.status) throw error;
      // Missing, inaccessible or replaced originals never become new sources.
    }
  }
  for (const node of nodes.filter(node => node.type === 'asset_reference' && node.asset_id)) {
    if (node.content.asset?.id && node.content.asset.id !== node.asset_id) continue;
    try {
      const asset = await ownedCanvasVideo(env, userId, node.asset_id, node.content.asset?.sourceVersion || null, 80_000_000);
      // Legacy references may store only asset_id. Projected graph capability
      // comes from the owned media row, while admission still fences raw JSON.
      node.content={...node.content,asset:{...node.content.asset,id:asset.id,asset_type:'video',sourceVersion:asset.version}};
      availableClips.push({ nodeId: node.id, title: node.title || '', assetId: asset.id, version: asset.version,
        modelId: null, createdAt: node.created_at, size: asset.size, originalAudio: originalAudioSettings(parse(node.config_json).originalAudio), includedSources: [] });
    } catch (error) { if (!error.status) throw error; }
  }
  const anchor = nodes.find(node => runId?.nodeId ? node.id === runId.nodeId : node.output?.runId === runId);
  const chain = canvasMergeSequence(canvasMergeStrand(nodes, edges, anchor?.id), availableClips);
  return { availableClips, chain, nodes, edges };
}

export async function canvasVideoSelection(env, userId, projectId, runId, selection, mode = 'manual', view = null) {
  view ||= await canvasMergeView(env, userId, projectId, runId);
  if (!Array.isArray(selection) || selection.length < 2 || selection.length > 120
    || !selection.some(clip => runId?.nodeId ? clip?.nodeId === runId.nodeId : clip?.runId === runId) || !['manual', 'chain'].includes(mode)) throw fail('canvas_sequence_invalid');
  const selected = [], seen = new Set();
  for (const clip of selection) {
    if (!clip || Object.keys(clip).sort().join(',') !== (clip.runId ? 'assetId,runId,version' : 'assetId,nodeId,version')
      || !canvasClipKey(clip) || seen.has(canvasClipKey(clip))) throw fail('canvas_sequence_invalid');
    seen.add(canvasClipKey(clip));
    const current = view.availableClips.find(candidate => sameCanvasClip(candidate, clip));
    if (!current) throw fail('canvas_selection_changed', 'A selected node or output changed. Refresh the clip selection.');
    selected.push(current);
  }
  if (mode === 'chain' && (view.chain.error || selected.length !== view.chain.clips.length
    || selected.some((clip, i) => !sameCanvasClip(clip, view.chain.clips[i])))) throw fail(view.chain.error || 'canvas_selection_changed');
  if (selected.some(clip => clip.includedSources.some(parent => seen.has(canvasClipKey(parent))))) throw fail('canvas_sequence_included');
  if (selected.reduce((total, clip) => total + clip.size, 0) > CANVAS_VIDEO_LIMITS.sourceBytes) throw fail('canvas_chain_size');
  return {
    transitions:sequenceTransitions(selected,view.edges),
    videos: selected.map(clip => ({ ...canvasClipIdentity(clip), size: clip.size, originalAudio: clip.originalAudio })),
    // Rechecked atomically by INSERT, after asynchronous R2/music validation.
    admission: { nodes: view.nodes
      .map(({ id, type, asset_id, output_json, content_json, config_json }) => ({ id, type, asset_id, output_json, content_json, config_json })),
    edges: view.edges.map(({ id, source_node_id, target_node_id, config_json }) => ({ id, source_node_id, target_node_id, config_json })) },
  };
}

// One statement is the admission boundary. A deletion/replacement between the
// read and insertion cannot enqueue a stale clip. Accepted jobs never use it again.
export const CANVAS_MERGE_ADMISSION_SQL = `
  NOT EXISTS (SELECT 1 FROM json_each(?) s LEFT JOIN canvas_nodes n
    ON n.id=json_extract(s.value,'$.id') AND n.user_id=? AND n.project_id=? AND n.deleted_at IS NULL
    WHERE n.id IS NULL OR n.type IS NOT json_extract(s.value,'$.type') OR n.asset_id IS NOT json_extract(s.value,'$.asset_id')
      OR n.output_json IS NOT json_extract(s.value,'$.output_json') OR n.content_json IS NOT json_extract(s.value,'$.content_json')
      OR n.config_json IS NOT json_extract(s.value,'$.config_json'))
  AND (? IS NULL OR (
    (SELECT COUNT(*) FROM canvas_nodes WHERE user_id=? AND project_id=? AND deleted_at IS NULL)=json_array_length(?)
    AND (SELECT COUNT(*) FROM canvas_edges WHERE user_id=? AND project_id=? AND deleted_at IS NULL)=json_array_length(?)
    AND NOT EXISTS (SELECT 1 FROM json_each(?) s LEFT JOIN canvas_edges e
      ON e.id=json_extract(s.value,'$.id') AND e.user_id=? AND e.project_id=? AND e.deleted_at IS NULL
      WHERE e.id IS NULL OR e.source_node_id IS NOT json_extract(s.value,'$.source_node_id')
        OR e.target_node_id IS NOT json_extract(s.value,'$.target_node_id') OR e.config_json IS NOT json_extract(s.value,'$.config_json'))))`;
