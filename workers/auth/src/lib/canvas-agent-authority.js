// In-process execution authority only. No browser header, cookie, serialized
// object or model output can create this WeakMap entry.
const authorities=new WeakMap();
const paths=new Set(['/api/ai/generate-image','/api/ai/generate-video','/api/ai/generate-music','/api/ai/generate-text','/api/ai/images/save']);
export function canvasAgentAuthority(env) {
    for(let scope=env;scope;scope=Object.getPrototypeOf(scope))if(authorities.has(scope))return authorities.get(scope);
    return null;
}
export function canvasAgentEnvironment(env,authority) {const scoped=Object.create(env);authorities.set(scoped,Object.freeze({...authority}));return scoped;}
const fail=()=>{throw Object.assign(new Error('Canvas execution authority has been revoked.'),{code:'canvas_agent_authority_revoked',status:409});};
export async function canvasAgentSession(request,env) {
    const authority=canvasAgentAuthority(env);if(!authority)return null;
    const pathname=new URL(request.url).pathname;
    if(!paths.has(pathname)&&!/^\/api\/account\/canvas\/projects\/[a-f0-9]{32}\//.test(pathname))fail();
    const row=await env.DB.prepare(`SELECT u.id,u.status,u.role,r.project_id,r.status AS run_status,r.expected_revision,p.revision,p.deleted_at,r.expires_at,r.lease_token,r.lease_until
      FROM canvas_agent_runs r JOIN users u ON u.id=r.user_id JOIN canvas_projects p ON p.id=r.project_id
      JOIN canvas_agent_steps s ON s.run_id=r.id WHERE r.id=? AND r.user_id=? AND s.id=?`).bind(authority.runId,authority.userId,authority.stepId).first();
    if(!row||row.status!=='active'||row.deleted_at||row.project_id!==authority.projectId||row.expires_at<=new Date().toISOString())fail();
    if(!['planning','running','exporting'].includes(row.run_status)||row.expected_revision!==row.revision)fail();
    if(authority.leaseToken!==row.lease_token||!row.lease_until||row.lease_until<=new Date().toISOString())fail();
    if(pathname.startsWith('/api/account/canvas/')&&!pathname.startsWith(`/api/account/canvas/projects/${authority.projectId}/`))fail();
    return {sessionId:null,user:{id:row.id,status:'active',role:row.role}};
}
export async function canvasAgentUsageMetadata(env,request,{userId,modelId,credits}) {
    const authority=canvasAgentAuthority(env);if(!authority)return {};
    const session=await canvasAgentSession(request,env);
    const step=await env.DB.prepare('SELECT * FROM canvas_agent_steps WHERE id=? AND run_id=?').bind(authority.stepId,authority.runId).first();
    const input=JSON.parse(step?.input_json||'null');
    if(session.user.id!==userId||!step||credits>step.allocation_credits||modelId!==input.modelId)fail();
    return {canvas_agent:{run_id:authority.runId,step_id:authority.stepId,project_id:authority.projectId}};
}
