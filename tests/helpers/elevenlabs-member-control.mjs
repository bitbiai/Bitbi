import worker from '../../workers/auth/src/index.js';
import aiWorker from '../../workers/ai/src/index.js';
import { sha256Hex } from '../../workers/auth/src/lib/tokens.js';
import { grantMemberCredits } from '../../workers/auth/src/lib/billing.js';
import { elevenLabsCreditPrice } from '../../js/shared/member-music-contract.mjs';
import { ownedCanvasMusic } from '../../workers/auth/src/lib/canvas-export-recipes.js';

const check = (value, message) => { if (!value) throw new Error(message); };
export const elevenLabsMemberCases = ['prompt', 'plan-opus', 'plan-large', 'explicit-duration', 'selected-org', 'missing-usage', 'invalid-usage', 'overrun', 'failed', 'custom-revision', 'durable'];
export async function elevenLabsMemberCase(base, name, role, media) {
  check(elevenLabsMemberCases.includes(name) && ['user', 'admin'].includes(role), 'Known ElevenLabs fixture');
  const owner = `el-${role}-${name}`, now = new Date().toISOString(), db = base.DB;
  const originalTariff = await db.prepare('SELECT revision, rules_json FROM model_pricing_state WHERE id=1').first();
  const organizationDebits = Number((await db.prepare('SELECT COUNT(*) n FROM credit_ledger').first()).n);
  const calls = [], messages = [], nonces = new Set();
  const env = { ...base, BITBI_ENV: 'production', AI_SERVICE_AUTH_SECRET: 'synthetic-elevenlabs-member',
    AI_VIDEO_JOBS_QUEUE: { async send(body) { messages.push(body); } },
    AI: { async run() { throw new Error('ElevenLabs must not generate a bundled AI cover'); } },
  };
  const provider = { AI_SERVICE_AUTH_SECRET: env.AI_SERVICE_AUTH_SECRET,
    SERVICE_AUTH_REPLAY: { idFromName: id => id, get: id => ({ async fetch() { const replayed = nonces.has(id); nonces.add(id); return Response.json({ replayed }); } }) },
    AI: { async run(model, input, options) {
      calls.push({ model, input, options });
      if (name === 'failed') return { state: 'Failed', error: 'Synthetic rejection' };
      const opus = input.output_format.startsWith('opus_');
      const result = { audio: `data:${opus ? 'audio/ogg' : 'audio/mpeg'};base64,${opus ? media.opus : media.mp3}` };
      if (name !== 'missing-usage') result.audio_duration_ms = name === 'invalid-usage' ? 'invalid' : name === 'overrun' ? 31000 : 3000;
      return { state: 'Completed', result };
    } },
  };
  env.AI_LAB = { fetch: request => aiWorker.fetch(request, provider, { waitUntil() { throw new Error('No detached AI work'); } }) };
  for (const id of [owner, `${owner}-other`]) {
    await db.prepare('INSERT INTO users(id,email,password_hash,created_at,role,email_verified_at) VALUES(?,?,?,?,?,?)').bind(id, `${id}@example.invalid`, 'synthetic', now, role, now).run();
    await db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)')
      .bind(id, id, await sha256Hex(`${id}:${env.SESSION_HASH_SECRET}`), now, new Date(Date.now()+3600000).toISOString(), now).run();
  }
  await grantMemberCredits({ env, userId: owner, amount: 2000, createdByUserId: owner, idempotencyKey: `grant-${owner}` });
  const pid = (await sha256Hex(owner+'project')).slice(0,32), nid = (await sha256Hex(owner+'node')).slice(0,32);
  const plan = { chunks: [{ text: 'Synthetic original song', duration_ms: 6000, positive_styles: ['piano'], negative_styles: ['drums'], context_adherence: 'high', condition_strength: 'low' }] };
  if(name === 'plan-large') plan.chunks = Array.from({length:30},()=>({...plan.chunks[0],text:'a'.repeat(1000),duration_ms:3000}));
  const config = name.startsWith('plan-') ? { inputMode: 'composition_plan', compositionPlan: plan, outputFormat: 'opus_48000_128', storeForInpainting: true, seed: 4294967295 }
    : { prompt: 'Synthetic member music', outputFormat: 'mp3_48000_192', forceInstrumental: true, signWithC2pa: true, seed: 0 };
  if(name === 'explicit-duration') config.musicLengthMs=3000;
  const body = { model: 'elevenlabs/music-v2', ...config };
  if (name === 'custom-revision') await db.prepare('UPDATE model_pricing_state SET revision=revision+1,rules_json=? WHERE id=1')
    .bind(JSON.stringify({ ...JSON.parse(originalTariff.rules_json), 'elevenlabs/music-v2:{}': { modelId: body.model, rates: { second: 3 } } })).run();
  const revision = (await db.prepare('SELECT revision FROM model_pricing_state WHERE id=1').first()).revision;
  const request = async (path, data, key = owner, actor = owner, method = data ? 'POST' : 'GET', tariff = revision) => {
    const response = await worker.fetch(new Request('https://bitbi.ai'+path, { method,
      headers: { Cookie: `__Host-bitbi_session=${actor}`, Origin: 'https://bitbi.ai', 'Content-Type': 'application/json',
        'Idempotency-Key': key, 'X-BITBI-Workspace': 'generate-lab', 'X-Bitbi-Tariff-Revision': String(tariff), ...(name === 'durable' ? { Prefer: 'respond-async' } : {}) },
      body: data ? JSON.stringify(data) : undefined }), env, { waitUntil() { throw new Error('No detached work'); } });
    return response;
  };
  const scalar = async sql => Number((await db.prepare(sql).bind(owner).first()).n);
  const debits = () => scalar("SELECT COUNT(*) n FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'");
  for (const extra of [{ musicLengthMs: 2999 }, { outputFormat: 'wav' }, { outputFormat: 'opus_48000_128', signWithC2pa: true }, { generateLyrics: true }]) {
    const response = await request('/api/ai/generate-music', { model: body.model, prompt: 'Invalid fixture', ...extra }, owner+'-invalid');
    check(response.status === 400, 'Invalid contract denied before provider');
  }
  check(calls.length === 0 && await debits() === 0, 'Invalid requests neither invoke nor debit');
  const stale = await request('/api/ai/generate-music', body, owner+'-stale', owner, 'POST', revision - 1);
  check(stale.status === 409 && (await stale.json()).code === 'model_pricing_stale', 'Stale prices reject before dispatch');
  check(calls.length === 0 && await debits() === 0, 'Stale quote neither invokes nor debits');
  await db.prepare("INSERT INTO canvas_projects(id,user_id,title,locale,created_at,updated_at) VALUES(?,?,?,'en',?,?)").bind(pid, owner, 'ElevenLabs fixture', now, now).run();
  const created = await request(`/api/account/canvas/projects/${pid}/nodes`, { type: 'music_generation', model_id: body.model, config });
  check(created.status === 201, `Create actual Canvas music node: ${created.status}`);
  const node = (await created.json()).data.node;
  const route = name === 'durable' ? '/api/ai/generate-music' : `/api/account/canvas/projects/${pid}/nodes/${node.id}/run`;
  check((await request(`/api/account/canvas/projects/${pid}/nodes/${node.id}/run`, {}, owner, owner+'-other')).status === 404, 'Foreign Canvas denied');
  const organizationId='org_'+pid;
  if(name === 'selected-org') {
    await db.prepare('INSERT INTO organizations(id,name,slug,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(organizationId,'Selected organization',owner,owner,now,now).run();
    await db.prepare('INSERT INTO organization_memberships(id,organization_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(owner,organizationId,owner,'owner',now,now).run();
  }
  const submission = name === 'durable' ? body : name === 'selected-org' ? {organization_id:organizationId} : {};
  const response = await request(route, submission);
  const result = await response.json();
  let assetId;
  if (name === 'durable') {
    check(response.status === 202 && calls.length === 0 && messages.length === 1, 'Durable member admission before provider');
    const deliver = () => worker.queue({ queue: 'bitbi-ai-video-jobs', messages: [{ body: messages[0], attempts: 1, ack() {}, retry() {} }] }, env, { waitUntil() { throw new Error('No detached queue'); } });
    await deliver(); await deliver();
    const job = await db.prepare('SELECT * FROM member_generation_jobs WHERE user_id=?').bind(owner).first();
    check(job.status === 'succeeded', `Durable music completion: ${job.status} ${job.error_code}`); assetId = job.asset_id;
  } else if (['failed', 'invalid-usage', 'overrun'].includes(name)) {
    check(!result.ok && response.status >= 400, `Expected failure/review: ${response.status}`);
    check(await debits() === 0, 'Failure/invalid usage never debits');
  } else {
    check(response.status === 200, `Canvas music completed: ${response.status} ${result.code}`); assetId = result.data.run.asset_id;
  }
  check(calls.length === 1 && calls[0].model === body.model, 'Exactly one invocation through real signed AI adapter');
  check(calls[0].options.gateway.id === 'default', 'Existing default Gateway');
  if (name.startsWith('plan-')) { check(!calls[0].input.prompt && !calls[0].input.music_length_ms, 'Plan has no fake prompt or explicit duration'); check(JSON.stringify(calls[0].input.composition_plan) === JSON.stringify(plan), 'Full plan preserved'); }
  else check(calls[0].input.music_length_ms === (config.musicLengthMs || 30000), 'Prompt default/explicit duration present');
  if (assetId) {
    const asset = await db.prepare('SELECT * FROM ai_text_assets WHERE id=? AND user_id=?').bind(assetId, owner).first();
    const opus = name.startsWith('plan-');
    check(asset.mime_type === (opus ? 'audio/ogg' : 'audio/mpeg') && asset.file_name.endsWith(opus ? '.opus' : '.mp3'), 'Correct MIME and extension');
    check(await env.USER_IMAGES.head(asset.r2_key), 'Durable private bytes');
    check((await ownedCanvasMusic(env, owner, assetId)).version, 'Output qualifies as protected full-video background music');
    check(await debits() === 1, 'Exactly one personal debit');
    const ledger = await db.prepare("SELECT amount FROM member_credit_ledger WHERE user_id=? AND entry_type='consume'").bind(owner).first();
    const expected = name === 'custom-revision' ? 9 : elevenLabsCreditPrice({ musicLengthMs: name === 'missing-usage' ? 30000 : 3000 }).credits;
    check(ledger.amount === -expected, 'Actual duration or explicitly unreconciled accepted quote settlement');
    const file = await request(`/api/ai/text-assets/${assetId}/file`);
    check(file.status === 200 && file.headers.get('content-type').startsWith(asset.mime_type), 'Owned playback/download endpoint');
    const delivered = new Uint8Array(await file.arrayBuffer());
    const expectedBytes = Uint8Array.from(atob(media[opus ? 'opus' : 'mp3']), value => value.charCodeAt(0));
    check(delivered.length === expectedBytes.length && delivered.every((byte, index) => byte === expectedBytes[index]), 'Stored and downloaded original audio bytes match the provider fixture');
    check((await request(`/api/ai/text-assets/${assetId}/file`, null, owner, owner+'-other')).status === 404, 'Foreign file denied');
  }
  if (name === 'custom-revision') await db.prepare('UPDATE model_pricing_state SET revision=revision+1,rules_json=? WHERE id=1').bind(originalTariff.rules_json).run();
  const before = await debits(); await request(route, submission);
  check(calls.length === 1 && await debits() === before, 'Replay cannot dispatch or debit again, even after tariff change');
  check(Number((await db.prepare('SELECT COUNT(*) n FROM credit_ledger').first()).n) === organizationDebits, 'No organization billing');
  check((await db.prepare('SELECT rules_json FROM model_pricing_state WHERE id=1').first()).rules_json === originalTariff.rules_json, 'Unrelated migrated tariffs survive the fixture');
  return { name, role, calls: calls.length, debits: before, persisted: Boolean(assetId) };
}
