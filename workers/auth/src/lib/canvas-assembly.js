import { canvasAssembly } from '../../../../js/shared/canvas-assembly.mjs';
import { canvasNodeMediaKind } from '../../../../js/shared/canvas-export.mjs';
import { readJsonBodyOrResponse, BODY_LIMITS } from './request.js';
import { json } from './response.js';
import { nowIso } from './tokens.js';

const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
export async function readCanvasAssembly(env, userId, projectId) {
    const row = await env.DB.prepare('SELECT assembly_json,revision FROM canvas_projects WHERE id=? AND user_id=? AND deleted_at IS NULL').bind(projectId, userId).first();
    if (!row) fail('project_not_found', 404);
    return { assembly: row.assembly_json ? canvasAssembly(JSON.parse(row.assembly_json)) : null, revision: row.revision };
}

export async function writeCanvasAssembly(env, userId, projectId, input, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('canvas_revision_required', 400);
    const assembly = canvasAssembly(input), encoded = JSON.stringify(assembly);
    const current = await readCanvasAssembly(env, userId, projectId);
    // Lost response replay: equal canonical intent has no mutation to repeat.
    if (current.revision >= expectedRevision && JSON.stringify(current.assembly) === encoded) return current;
    if (current.revision !== expectedRevision) fail('canvas_project_changed');
    const nodes = (await env.DB.prepare('SELECT id,type,asset_id,content_json,output_json FROM canvas_nodes WHERE project_id=? AND user_id=? AND deleted_at IS NULL').bind(projectId, userId).all()).results;
    if(assembly.anchorNodeId&&!await env.DB.prepare('SELECT id FROM canvas_nodes WHERE id=? AND project_id=? AND user_id=?').bind(assembly.anchorNodeId,projectId,userId).first())fail('canvas_assembly_node_invalid');
    if(current.assembly?.anchorNodeId&&assembly.anchorNodeId!==current.assembly.anchorNodeId)fail('canvas_assembly_anchor_immutable');
    if(assembly.musicNodeId) {
        const music=nodes.find(n=>n.id===assembly.musicNodeId);
        if(!music&&assembly.musicNodeId!==current.assembly?.musicNodeId)fail('canvas_assembly_music_invalid');
        if(music&&canvasNodeMediaKind({...music,content:JSON.parse(music.content_json||'{}'),output:JSON.parse(music.output_json||'null')})!=='audio')fail('canvas_assembly_music_invalid');
    }
    for (const clip of assembly.clips) {
        const node = nodes.find(node => node.id === clip.nodeId);
        // Existing missing entries may be retained for explicit relinking. New
        // references must resolve in this owned project; no foreign node IDs.
        if (!node && current.assembly?.clips.some(old => old.nodeId === clip.nodeId)) continue;
        if (!node || canvasNodeMediaKind({ ...node, content: JSON.parse(node.content_json || '{}'), output: JSON.parse(node.output_json || 'null') }) !== 'video') fail('canvas_assembly_node_invalid');
    }
    const result = await env.DB.prepare('UPDATE canvas_projects SET assembly_json=?,updated_at=? WHERE id=? AND user_id=? AND revision=? AND deleted_at IS NULL')
        .bind(encoded, nowIso(), projectId, userId, expectedRevision).run();
    if (!result.meta?.changes) fail('canvas_project_changed');
    return readCanvasAssembly(env, userId, projectId);
}

export async function handleCanvasAssembly(ctx, userId, projectId) {
    let data;
    if (ctx.method === 'GET') data = await readCanvasAssembly(ctx.env, userId, projectId);
    else {
        const parsed = await readJsonBodyOrResponse(ctx.request, { maxBytes: BODY_LIMITS.smallJson });
        if (parsed.response) return parsed.response;
        if (!parsed.body || Object.keys(parsed.body).sort().join(',') !== 'assembly,revision') fail('canvas_assembly_invalid', 400);
        data = await writeCanvasAssembly(ctx.env, userId, projectId, parsed.body.assembly, parsed.body.revision);
    }
    return json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
}
