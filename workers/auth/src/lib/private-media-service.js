import { nowIso, randomTokenHex } from './tokens.js';
import { getMemvidStreamPreviewProcessorDispatchStatus } from './memvid-stream-preview-dispatch.js';

export const PRIVATE_MEDIA_WAKE = 'private_media.wake';
export const MEDIA_SERVICE_KEY = 'private_media_service';
export const MEDIA_BACKENDS = ['github','cloudflare'];
export const MEDIA_BACKEND_SQL = "COALESCE((SELECT json_extract(value_json,'$.backend') FROM app_settings WHERE key='private_media_service'),'github')";
const failure=code=>Object.assign(new Error(code),{code,status:409});
const future=ms=>new Date(Date.now()+ms).toISOString();
const validBackend=value=>{if(!MEDIA_BACKENDS.includes(value))throw failure('media_backend_invalid');return value;};

export async function privateMediaStatus(env) {
  const row=await env.DB.prepare('SELECT value_json FROM app_settings WHERE key=?').bind(MEDIA_SERVICE_KEY).first();
  const backend=row?JSON.parse(row.value_json).backend:'github';validBackend(backend);
  let container={state:'not_configured'};
  if(env.PRIVATE_MEDIA_PROCESSOR?.fetch) {
    try {
      const r=await env.PRIVATE_MEDIA_PROCESSOR.fetch('https://private-media/status',{signal:AbortSignal.timeout(5000)});
      const data=await r.json();
      container=r.ok&&data.protocol===1&&data.functional_verified===true?{state:'ready',version:data.version}:{state:'not_configured'};
    } catch {container={state:'degraded'};}
  }
  const dispatch=getMemvidStreamPreviewProcessorDispatchStatus(env);
  const rows=await env.DB.prepare('SELECT backend,error_code,updated_at FROM private_media_dispatch').all();
  const services={github:{state:dispatch.configured?'ready':'not_configured'},cloudflare:container};
  for(const row of rows.results||[])if(row.error_code&&services[row.backend]?.state==='ready')services[row.backend]={...services[row.backend],state:'degraded'};
  return {backend,services,dispatch:rows.results||[]};
}

export async function setPrivateMediaService(env,{backend,actor,reason}) {
  validBackend(backend);const status=await privateMediaStatus(env);
  if(status.services[backend].state!=='ready')throw failure('media_service_not_ready');
  await env.DB.prepare(`INSERT INTO app_settings(key,value_json,updated_at,updated_by_user_id,reason) VALUES(?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by_user_id=excluded.updated_by_user_id,reason=excluded.reason`)
    .bind(MEDIA_SERVICE_KEY,JSON.stringify({backend}),nowIso(),actor,reason).run();
  return {...status,backend};
}

// Different processor credentials identify the backend; a caller-supplied flag
// never selects another backend's jobs. Neither credential is returned to UI.
export async function processorBackend(env,request) {
  const authorization=request.headers.get('Authorization')||'';
  const encoder=new TextEncoder();
  for(const [backend,secret] of [['github',env.MEMVID_STREAM_PREVIEW_PROCESSOR_SECRET],['cloudflare',env.PRIVATE_MEDIA_PROCESSOR_SECRET]]) {
    if(!secret)continue;
    const [a,b]=await Promise.all([authorization,`Bearer ${secret}`].map(v=>crypto.subtle.digest('SHA-256',encoder.encode(v))));
    const x=new Uint8Array(a),y=new Uint8Array(b);let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];
    if(difference===0)return backend;
  }
  return null;
}

export async function duePrivateMedia(env,backend) {
  validBackend(backend);const now=nowIso();
  const row=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM member_generation_jobs WHERE processing_backend=? AND media_type='video' AND status='preview_pending'
      AND attempt_count<16 AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?)) +
    (SELECT COUNT(*) FROM canvas_video_processing WHERE processing_backend=? AND status IN ('queued','processing','preview_pending')
      AND attempt_count<8 AND next_attempt_at<=? AND (locked_until IS NULL OR locked_until<=?)) AS count`)
    .bind(backend,now,now,backend,now,now).first();
  return Number(row?.count||0);
}

// A lost queue send is recovered from the durable job by the existing cron.
// A successful send survives the browser/request; no waitUntil-only delivery.
export async function notifyPrivateMedia(env,backend) {
  validBackend(backend);
  try {await env.AI_VIDEO_JOBS_QUEUE.send({type:PRIVATE_MEDIA_WAKE,backend});}catch { /* Durable recovery below. */ }
}

export async function dispatchPrivateMedia(env,backend) {
  validBackend(backend);
  if(!await duePrivateMedia(env,backend))return {status:'idle'};
  const token=randomTokenHex(16),now=nowIso();
  const claimed=await env.DB.prepare(`UPDATE private_media_dispatch SET token=?,runner_id=NULL,lease_until=?,error_code=NULL,updated_at=?
    WHERE backend=? AND (lease_until IS NULL OR lease_until<=?)`).bind(token,future(20*60_000),now,backend,now).run();
  if(!claimed.meta?.changes)return {status:'active'};
  try {
    let response;
    if(backend==='cloudflare') {
      if(!env.PRIVATE_MEDIA_PROCESSOR?.fetch)throw failure('media_service_not_configured');
      response=await env.PRIVATE_MEDIA_PROCESSOR.fetch('https://private-media/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(15000)});
    } else {
      const config=getMemvidStreamPreviewProcessorDispatchStatus(env);
      if(!config.configured)throw failure('media_service_not_configured');
      const owner=env.GITHUB_ACTIONS_DISPATCH_OWNER,repo=env.GITHUB_ACTIONS_DISPATCH_REPO;
      response=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(config.workflow_file)}/dispatches`,{
        method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_ACTIONS_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'bitbi-auth-worker','X-GitHub-Api-Version':'2022-11-28'},
        body:JSON.stringify({ref:config.ref,inputs:{member_generation_posters:'true',private_media_dispatch:token,job_limit:'1',max_runs:'1',repair_downloads:'false',dry_run:'false',dispatch_reason:'Private media ready.'}}),signal:AbortSignal.timeout(15000)});
    }
    if(!response.ok)throw failure('media_dispatch_rejected');
    return {status:'accepted'};
  } catch(error) {
    // Ambiguous responses retain the fencing token. A late runner can acquire
    // it once; replacement after expiry invalidates every older activation.
    await env.DB.prepare('UPDATE private_media_dispatch SET error_code=?,updated_at=? WHERE backend=? AND token=?')
      .bind(error.code==='media_service_not_configured'?error.code:'media_dispatch_unconfirmed',nowIso(),backend,token).run();
    return {status:'retry',delaySeconds:120};
  }
}

export async function mediaRunner(env,backend,{token,runner,action}) {
  validBackend(backend);
  if(!/^[a-f0-9]{32}$/.test(token||'') || !/^[a-zA-Z0-9_-]{1,100}$/.test(runner||'') || !['acquire','heartbeat','finish'].includes(action))throw failure('media_runner_invalid');
  if(action==='acquire') {
    const changed=await env.DB.prepare(`UPDATE private_media_dispatch SET runner_id=?,lease_until=?,error_code=NULL,updated_at=?
      WHERE backend=? AND token=? AND runner_id IS NULL`).bind(runner,future(20*60_000),nowIso(),backend,token).run();
    if(!changed.meta?.changes)throw failure('media_runner_claim_lost');
  } else {
    const changed=await env.DB.prepare(`UPDATE private_media_dispatch SET lease_until=?,updated_at=? WHERE backend=? AND token=? AND runner_id=? AND lease_until>?`)
      .bind(future(20*60_000),nowIso(),backend,token,runner,nowIso()).run();
    if(!changed.meta?.changes)throw failure('media_runner_claim_lost');
  }
  if(action==='finish') {
    // Clearing first makes an arriving job independently wakeable. Then recheck
    // durable work, covering arrival after the runner's last empty claim.
    await env.DB.prepare('UPDATE private_media_dispatch SET token=NULL,runner_id=NULL,lease_until=NULL WHERE backend=? AND token=? AND runner_id=?').bind(backend,token,runner).run();
    if(await duePrivateMedia(env,backend))await notifyPrivateMedia(env,backend);
  }
  return {protocol:1,pending:await duePrivateMedia(env,backend)};
}

export async function recoverPrivateMedia(env) {
  for(const backend of MEDIA_BACKENDS)if(await duePrivateMedia(env,backend))await notifyPrivateMedia(env,backend);
}
