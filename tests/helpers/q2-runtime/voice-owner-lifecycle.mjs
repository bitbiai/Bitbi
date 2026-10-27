import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const CANVAS_VOICE_OWNER_LIFECYCLE_CASES = Object.freeze([
  'pending_fetch_stop', 'abnormal_close', 'no_close_ack', 'delayed_close_ack', 'concurrent_text',
  'partial_stop', 'projection_after_stop', 'replacement_isolation', 'optin_resumption', 'handshake_rejected',
]);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 32);
async function until(read, predicate, label, milliseconds = 10000) {
  const deadline = Date.now() + milliseconds; let value;
  while (Date.now() < deadline) { value = await read(); if (predicate(value)) return value; await pause(25); }
  assert.fail(label + ': ' + JSON.stringify(value));
}
export async function runCanvasVoiceOwnerLifecycleTest(f, name) {
  assert(CANVAS_VOICE_OWNER_LIFECYCLE_CASES.includes(name));
  const provider = await f.mf.getWorker('q2-voice-provider');
  const command = async (path, body) => {
    const response = await provider.fetch('https://voice-fixture.invalid/lifecycle/' + path,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const mode = name === 'handshake_rejected' ? 'rejected' : name === 'delayed_close_ack' ? 'delayed_ack' : name === 'optin_resumption' ? 'resume' : name === 'pending_fetch_stop' ? 'pending' : name === 'abnormal_close' ? 'abnormal'
    : name === 'no_close_ack' ? 'no_ack' : ['partial_stop', 'projection_after_stop'].includes(name) ? 'partial' : 'idle';
  await command('control', { mode });
  const seeded = await f.control('/canvas-voice-owner-seed', { name: 'life-' + name.replaceAll('_', '-') });
  assert.equal(seeded.status, 200, await seeded.clone().text());
  const { userId, projectId, sessionId } = await seeded.json();
  const base = `https://bitbi.ai/api/account/canvas/projects/${projectId}/agent/voice`;
  const request = (suffix, body, extra = {}) => f.mf.dispatchFetch(base + suffix, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'https://bitbi.ai', Cookie: '__Host-bitbi_session=' + userId,
      'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).data; };
  await json(await request('/settings', { settings: { turn_detection: { type: null }, resumption: { enabled: name === 'optin_resumption' } }, expectedRevision: 0 }, { 'Idempotency-Key': 'life-settings-' + name }));
  const admit = async id => {
    const conversation = await f.db.prepare('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
    const input = { maxDurationSeconds: 30, settingsRevision: 1, expectedConversationRevision: conversation.revision,
      expectedBriefRevision: conversation.brief_revision, expectedProjectRevision: 0 };
    const { quote } = await json(await request('/quote', input));
    return { ...await json(await request('/sessions', { ...input, requestId: id, quoteId: quote.id, capCredits: quote.capCredits, consent: true }, { 'Idempotency-Key': id })), quote };
  };
  await admit(sessionId);
  const usage = () => f.db.prepare("SELECT status,billing_status,provider_outcome,reservation_released_at,metadata_json FROM member_ai_usage_attempts_v2 WHERE json_extract(metadata_json,'$.canvas_voice.session_id')=?").bind(sessionId).first();
  const debit = () => f.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(amount),0) AS amount FROM member_credit_ledger WHERE user_id=? AND amount<0').bind(userId).first();
  const stop = id => request(`/sessions/${id}/stop`, {}, { 'Idempotency-Key': id });
  const sockets = [];
  const open = async id => {
    const response = await request(`/sessions/${id}/socket`, undefined, { Upgrade: 'websocket' });
    assert.equal(response.status, 101, response.status === 101 ? '' : await response.text());
    const socket = response.webSocket, events = []; let sequence = 0;
    socket.addEventListener('message', event => events.push(JSON.parse(event.data))); socket.accept(); sockets.push(socket);
    const client = { socket, events, send: event => socket.send(JSON.stringify({ ...event, sequence: sequence++ })),
      wait: predicate => until(() => events, list => list.some(predicate), 'Native lifecycle event ' + name) };
    await client.wait(event => event.type === 'voice.state' && event.state === 'listening');
    return client;
  };
  try {
    if (name === 'handshake_rejected') {
      const rejected = await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' });
      assert.equal(rejected.status, 502);
      assert.deepEqual(await rejected.json(), { ok: false, code: 'canvas_voice_provider_connection_rejected_403' });
      const row = await usage();
      assert.equal(row.provider_outcome, 'failed'); assert.equal(row.billing_status, 'released');
      assert(row.reservation_released_at); assert.equal(row.metadata_json.includes('synthetic-private-detail'), false);
      const diagnostic = await f.db.prepare('SELECT error_code,updated_at FROM member_ai_usage_attempts_v2 WHERE idempotency_key=? AND user_id=?')
        .bind('canvas-voice-' + sessionId, userId).first();
      assert.equal(diagnostic.error_code, 'canvas_voice_provider_connection_rejected_403');
      assert(Number.isFinite(Date.parse(diagnostic.updated_at)));
      assert.equal((await debit()).n, 0);
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.notEqual((await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' })).status, 101);
      assert.equal((await command('state')).attempts, 1, 'Rejected identity is observed, never resubmitted');
      assert.equal((await debit()).n, 0); return;
    }
    if (name === 'pending_fetch_stop') {
      const connecting = request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' });
      await until(() => command('state'), state => state.pending && state.attempts === 1, 'Native provider fetch entered');
      await json(await stop(sessionId));
      await command('release', {});
      const failed = await connecting;
      assert.notEqual(failed.status, 101, 'Stop during pending provider fetch cannot revive a browser session');
      await until(usage, row => row?.provider_outcome === 'unknown', 'Pending accepted outcome stays unknown');
      assert.equal((await debit()).n, 0);
      assert.notEqual((await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' })).status, 101);
      assert.equal((await command('state')).attempts, 1, 'Unknown outcome does not dispatch replacement');
      return;
    }
    const client = await open(sessionId);
    assert.equal((await command('state')).configurations, 1, 'Early session.created survived the durable acceptance fence');
    if (name === 'delayed_close_ack') {
      client.send({ type: 'audio.append', audio: Buffer.alloc(960).toString('base64') });
      await until(() => command('state'), state => state.appends === 1, 'Original accepted audio forwarded once');
      client.send({ type: 'voice.stop' }); await client.wait(event => event.type === 'voice.ended');
      const held = await until(usage, row => row?.provider_outcome === 'unknown', 'No close acknowledgement after3s remains unknown');
      assert.equal(held.billing_status, 'reserved'); assert.equal((await debit()).n, 0);
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Late normal close reconciles the original session');
      assert.equal(JSON.parse(settled.metadata_json).canvas_voice_receipt.code, 'canvas_voice_late_close');
      assert.deepEqual(await debit(), { n: 1, amount: -9 });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.deepEqual(await debit(), { n: 1, amount: -9 });
      assert.equal((await command('state')).attempts, 1, 'Close observation does not repeat provider dispatch'); return;
    }
    if (['abnormal_close', 'no_close_ack'].includes(name)) {
      if (name === 'abnormal_close') await command('emit', { command: 'close_abnormal' });
      else client.send({ type: 'voice.stop' });
      await client.wait(event => event.type === 'voice.ended');
      const row = await until(usage, value => value?.provider_outcome === 'unknown', 'Unconfirmed close retains original identity');
      assert.equal(row.billing_status, 'reserved'); assert.equal(row.reservation_released_at, null); assert.equal((await debit()).n, 0);
      assert.notEqual((await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' })).status, 101);
      assert.equal((await command('state')).attempts, 1); return;
    }
    if (name === 'concurrent_text') {
      const now = new Date().toISOString(), id = hash(sessionId + '-text');
      await f.db.batch([
        f.db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,?,'{}',1,0,?,'completed',?,?)")
          .bind(id, projectId, 'synthetic-concurrent-text', 'Keep this concurrent text turn.', now, now),
        f.db.prepare('UPDATE canvas_agent_conversations SET revision=revision+1 WHERE project_id=?').bind(projectId),
      ]);
      await client.wait(event => event.type === 'voice.ended' && event.code === 'canvas_voice_context_changed');
      await until(usage, row => row?.billing_status === 'finalized', 'Concurrent text closes only Voice');
      assert.equal((await f.db.prepare('SELECT user_text FROM canvas_agent_turns WHERE id=?').bind(id).first()).user_text, 'Keep this concurrent text turn.');
      assert.equal((await debit()).n, 0, 'Manual turn with no audio has zero usage'); return;
    }
    if (['partial_stop', 'projection_after_stop'].includes(name)) {
      client.send({ type: 'audio.append', audio: Buffer.alloc(960).toString('base64') });
      client.send({ type: 'audio.commit' });
      await client.wait(event => event.type === 'voice.audio');
      await until(() => command('state'), state => state.responses === 1 && state.configurations >= 2, 'Partial response and canonical user turn');
      // A real protocol event queued after the transcript proves that the
      // partial text reached the relay; elapsed time does not prove delivery.
      await client.wait(event => event.type === 'voice.state' && event.state === 'processing');
      const trigger = 'voice_fixture_reply_' + hash(sessionId).slice(0, 12);
      if (name === 'projection_after_stop') await f.db.prepare(`CREATE TRIGGER ${trigger} BEFORE UPDATE OF assistant_text ON canvas_agent_turns
        WHEN NEW.project_id='${projectId}' BEGIN SELECT RAISE(ABORT,'synthetic_voice_projection_failed'); END`).run();
      try {
        await json(await stop(sessionId));
        const row = await until(usage, value => value?.billing_status === 'finalized', 'Stop settles verified audio even if transcript projection fails');
        assert.equal(JSON.parse(row.metadata_json).canvas_voice_receipt.credits, 9);
        assert.deepEqual(await debit(), { n: 1, amount: -9 });
        const turns = (await f.db.prepare('SELECT t.user_text,t.assistant_text,v.interrupted FROM canvas_agent_turns t JOIN canvas_voice_turns v ON v.turn_id=t.id WHERE t.project_id=?').bind(projectId).all()).results;
        assert.equal(turns.length, 1); assert.equal(turns[0].user_text, 'Ein Katzenvideo bitte.');
        if (name === 'partial_stop') { assert.equal(turns[0].assistant_text, 'Welche Dauer möchtest du?'); assert.equal(turns[0].interrupted, 1); }
        else {
          assert(!turns[0].assistant_text, 'Failed projection is not fabricated into success');
          assert.deepEqual(JSON.parse(row.metadata_json).canvas_voice_projection_errors, ['canvas_voice_internal_failed'], 'Bounded diagnostic survives settlement and owner-claim removal');
        }
        await json(await stop(sessionId)); assert.deepEqual(await debit(), { n: 1, amount: -9 });
      } finally { if (name === 'projection_after_stop') await f.db.prepare(`DROP TRIGGER ${trigger}`).run(); }
      return;
    }
    if (name === 'optin_resumption') {
      const original = await f.db.prepare('SELECT provider_identity,usage_attempt_id FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first();
      assert.equal(original.provider_identity, 'lifecycle_conversation_1', 'Capture the provider conversation identity, not the browser session ID');
      await json(await stop(sessionId)); await until(usage, row => row?.billing_status === 'finalized', 'Opt-in original settles before resumption');
      const nextId = hash(sessionId + '-resumed');
      const admitted = await admit(nextId);
      assert.equal(admitted.quote.resumption.resuming, true, 'A new explicit quote and consent select the original settled conversation');
      const next = await f.db.prepare('SELECT resume_session_id,resume_conversation_id,usage_attempt_id FROM canvas_voice_sessions WHERE id=?').bind(nextId).first();
      assert.equal(next.resume_session_id, sessionId); assert.equal(next.resume_conversation_id, original.provider_identity);
      assert.notEqual(next.usage_attempt_id, original.usage_attempt_id, 'Resumption has its own authorized accounting identity');
      await open(nextId);
      assert.deepEqual((await command('state')).resumedIds, [null, original.provider_identity], 'Only trusted original ID reaches the native outgoing WebSocket query');
      await json(await stop(nextId));
      await until(() => f.db.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(nextId).first(), row => row?.state === 'completed', 'Resumed session separately settles');
      assert.equal((await command('state')).attempts, 2); assert.equal((await debit()).n, 0); return;
    }
    // Complete the first original identity, then prove an old Stop cannot
    // dispose of the same user's new, independently admitted session.
    await json(await stop(sessionId)); await until(usage, row => row?.billing_status === 'finalized', 'First owner ends');
    const successor = hash(sessionId + '-successor'); await admit(successor); const next = await open(successor);
    const stale = await stop(sessionId); assert.equal(stale.status, 404, 'Old scope cannot terminate successor');
    assert.equal((await f.db.prepare('SELECT state,stop_requested FROM canvas_voice_sessions WHERE id=?').bind(successor).first()).state, 'active');
    assert.equal(next.events.some(event => event.type === 'voice.ended'), false);
    await json(await stop(successor));
    await until(() => f.db.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(successor).first(), row => row?.state === 'completed', 'Successor separately closes');
    assert.equal((await command('state')).attempts, 2); assert.equal((await debit()).n, 0);
  } finally { for (const socket of sockets) try { socket.close(1000); } catch { /* Test owns every browser socket. */ } }
}
