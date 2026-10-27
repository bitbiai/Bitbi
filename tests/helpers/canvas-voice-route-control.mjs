import worker from '../../workers/auth/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { ensureConversation } from '../../workers/auth/src/lib/canvas-agent-conversation.js';

const check = (value, message) => { if (!value) throw new Error(message); };
export async function canvasVoiceRouteCase(env) {
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 600000).toISOString();
  const owner = 'voice-route-owner', other = 'voice-route-other', pending = [];
  const projectId = (await sha256Hex(owner)).slice(0, 32), sessionId = (await sha256Hex(owner + '-stop')).slice(0, 32);
  for (const user of [owner, other]) {
    await env.DB.prepare("INSERT INTO users(id,email,password_hash,created_at,role,status,email_verified_at) VALUES(?,?,?,?,'user','active',?)")
      .bind(user, user + '@example.invalid', 'synthetic', now, now).run();
    await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(user, user, await sha256Hex(`${user}:${env.SESSION_HASH_SECRET}`), now, expiry, now).run();
  }
  await env.DB.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,'Voice route fixture','en',?,?)")
    .bind(projectId, owner, now, now).run();
  await ensureConversation(env, projectId, owner);
  const base = `/api/account/canvas/projects/${projectId}/agent/voice`;
  const request = (suffix = '', { method = 'GET', body, user = owner, origin = 'https://bitbi.ai', headers = {} } = {}) => {
    const h = new Headers({ 'Content-Type': 'application/json', ...headers });
    if (origin !== null) h.set('Origin', origin);
    if (user) h.set('Cookie', `__Host-bitbi_session=${user}`);
    return worker.fetch(new Request('https://bitbi.ai' + base + suffix, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
      env, { waitUntil(promise) { pending.push(promise); } });
  };
  const get = await request(); check(get.status === 200, 'Authenticated Voice configuration is available');
  const config = (await get.json()).data;
  check(config.settings.model === 'grok-voice-3.0' && config.revision === 0 && config.availability.available === false, 'Configuration is distinct from paid admission');
  check((await request('', { user: null })).status === 401, 'Anonymous caller cannot inspect settings');
  check((await request('', { user: other })).status === 404, 'Foreign owner cannot inspect settings');
  const body = { settings: { voice: 'ara' }, expectedRevision: 0 }, key = { 'Idempotency-Key': 'voice-route-settings-1' };
  check((await request('/settings', { method: 'POST', body, origin: 'https://outside.invalid', headers: key })).status === 403, 'Actual Worker rejects cross-origin settings');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request('/settings', { method: 'POST', body, headers: key });
    check(response.status === 200 && (await response.json()).data.revision === 1, 'Actual settings route saves once across replay');
  }
  for (const suffix of ['/quote', '/sessions']) {
    const response = await request(suffix, { method: 'POST', body: {} });
    check(response.status === 503, 'Missing account and pricing evidence cannot start paid admission');
  }
  const socket = `/sessions/${sessionId}/socket`, upgrade = { Upgrade: 'websocket' };
  for (const options of [{ origin: null, headers: upgrade }, { origin: 'https://outside.invalid', headers: upgrade },
    { headers: { ...upgrade, 'Sec-Fetch-Site': 'cross-site' } }, { headers: {} }]) {
    check((await request(socket, options)).status === 403, 'Socket GET enforces Origin and upgrade independently of POST-only CSRF');
  }
  check((await request(socket, { headers: upgrade })).status === 503, 'Valid-origin socket still cannot bypass unapproved Voice admission');
  const stop = `/sessions/${sessionId}/stop`, stopHeaders = { 'Idempotency-Key': sessionId };
  check((await request(stop, { method: 'POST', body: [], headers: stopHeaders })).status === 400, 'Array is not a valid stop document');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request(stop, { method: 'POST', body: {}, headers: stopHeaders });
    check(response.status === 200, 'Stop before admission persists even on duplicate delivery');
    const result = (await response.json()).data;
    check(result.stopRequested === true && result.stopped === false, 'Stop request is not a fabricated provider termination receipt');
  }
  check((await env.DB.prepare('SELECT COUNT(*) AS n FROM canvas_voice_stop_requests WHERE session_id=?').bind(sessionId).first()).n === 1, 'One stop identity');
  let refused = false;
  try { await env.DB.prepare(`INSERT INTO canvas_voice_sessions(id,project_id,user_id,state,conversation_revision,brief_revision,project_revision,created_at,expires_at)
    VALUES(?,?,?,'admitted',0,0,0,?,?)`).bind(sessionId, projectId, owner, now, expiry).run(); }
  catch (error) { refused = String(error).includes('canvas_voice_admission_stopped'); }
  check(refused, 'A delayed admission cannot resurrect a stopped session');
  for (const table of ['canvas_voice_sessions', 'canvas_agent_runs', 'member_ai_usage_attempts_v2', 'member_credit_ledger'])
    check((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind(owner).first()).n === 0,
      'Configuration and stop never start production or debit: ' + table);
  check((await env.DB.prepare('SELECT revision FROM canvas_projects WHERE id=?').bind(projectId).first()).revision === 0, 'Presentation settings preserve creative revision');
  await Promise.all(pending);
  return { case: 'routes', providerCalls: 0 };
}
