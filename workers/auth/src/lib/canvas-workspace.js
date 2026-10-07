import {workspaceBounds,validWorkspaceSize} from '../../../../js/shared/canvas-workspace.mjs';
export async function updateWorkspace(env,userId,projectId,body) {
    const read=()=>env.DB.prepare('SELECT id,x,y,width,height FROM canvas_nodes WHERE project_id=? AND user_id=? AND deleted_at IS NULL ORDER BY id').bind(projectId,userId).all();
    const nodes=(await read()).results,bounds=workspaceBounds(nodes);
    const width=body.workspace_width,height=body.workspace_height;
    const fail=minimum=>{throw Object.assign(new Error(`Workspace minimum: ${minimum.width} × ${minimum.height}.`),{status:409,code:'canvas_workspace_bounds'});};
    if(!validWorkspaceSize(width,height,bounds))fail(bounds);
    // Geometry and node membership must remain identical at the mutation boundary.
    const result=await env.DB.prepare(`UPDATE canvas_projects SET workspace_width=?,workspace_height=?,updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL
      AND (SELECT COUNT(*) FROM canvas_nodes WHERE project_id=? AND user_id=? AND deleted_at IS NULL)=json_array_length(?)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) s LEFT JOIN canvas_nodes n ON n.id=json_extract(s.value,'$.id') AND n.project_id=? AND n.user_id=? AND n.deleted_at IS NULL
        WHERE n.id IS NULL OR n.x IS NOT json_extract(s.value,'$.x') OR n.y IS NOT json_extract(s.value,'$.y')
          OR n.width IS NOT json_extract(s.value,'$.width') OR n.height IS NOT json_extract(s.value,'$.height'))`)
      .bind(width,height,new Date().toISOString(),projectId,userId,projectId,userId,JSON.stringify(nodes),JSON.stringify(nodes),projectId,userId).run();
    if(!result.meta?.changes)fail(workspaceBounds((await read()).results));
    return {workspace_width:width,workspace_height:height};
}
