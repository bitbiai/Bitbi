import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const CANVAS_VOICE_OWNER_LIFECYCLE_CASES = Object.freeze([
  'pending_fetch_stop', 'abnormal_close', 'no_close_ack', 'delayed_close_ack', 'concurrent_text',
  'partial_stop', 'projection_after_stop', 'replacement_isolation', 'optin_resumption', 'handshake_rejected',
  'startup_order', 'startup_audio', 'startup_tool', 'startup_error_envelope', 'startup_ping', 'startup_partial_ack', 'startup_wrapped_tools', 'startup_wrapped_extra',
  'transcript_commit_after', 'transcript_commit_before', 'transcript_abandoned', 'transcript_final_conflict',
  'latency_pcm', 'latency_opus', 'latency_legacy', 'latency_stop',
  'revision_direct', 'revision_stale', 'revision_forged', 'revision_external',
  'source_commit_after', 'source_commit_before', 'source_superseded', 'source_missing', 'source_idle',
  'context_projection', 'context_format_preserve', 'context_negative',
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
  const mode = name.startsWith('startup_') ? name : name.startsWith('context_') ? 'context' : name.startsWith('source_') ? 'source' : name.startsWith('revision_') ? 'revision' : name.startsWith('latency_') ? 'latency' : name.startsWith('transcript_') ? 'transcript' : name === 'handshake_rejected' ? 'rejected' : name === 'delayed_close_ack' ? 'delayed_ack' : name === 'optin_resumption' ? 'resume' : name === 'pending_fetch_stop' ? 'pending' : name === 'abnormal_close' ? 'abnormal'
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
  if (name === 'context_format_preserve') {
    const source = hash(projectId + '-existing-format'), now = new Date().toISOString();
    await f.db.batch([
      f.db.prepare("INSERT INTO canvas_agent_turns(id,project_id,request_key,input_json,conversation_revision,brief_revision,user_text,state,created_at,updated_at) VALUES(?,?,?,'{}',0,0,?,'completed',?,?)")
        .bind(source, projectId, 'existing-format-' + source, '16:9; preserve the special crop', now, now),
      f.db.prepare("UPDATE canvas_agent_conversations SET brief_json=json_set(brief_json,'$.fields.format',json(?)) WHERE project_id=?")
        .bind(JSON.stringify({ value: '16:9; preserve the special crop', provenance: 'user_stated', sourceMessageId: source, revision: 0 }), projectId),
    ]);
  }
  await json(await request('/settings', { settings: { ...((name.startsWith('startup_wrapped_') || ['latency', 'revision', 'source', 'context'].includes(mode)) ? { tools: { canvas: { enabled: true } } } : {}),
    ...(name === 'latency_opus' ? { audio: { input: { format: { type: 'audio/opus', rate: 24000 } } } } : {}),
    turn_detection: { type: mode === 'source' ? 'server_vad' : null }, resumption: { enabled: name === 'optin_resumption' } }, expectedRevision: 0 }, { 'Idempotency-Key': 'life-settings-' + name }));
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
    if (name.startsWith('startup_')) {
      const upgraded = await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' });
      assert.equal(upgraded.status, 101, upgraded.status === 101 ? '' : await upgraded.text());
      const events = [], socket = upgraded.webSocket; sockets.push(socket);
      socket.addEventListener('message', event => events.push(JSON.parse(event.data))); socket.accept();
      if (['startup_order', 'startup_ping', 'startup_partial_ack', 'startup_wrapped_tools'].includes(name)) {
        await until(() => events, list => list.some(event => event.type === 'voice.state' && event.state === 'listening'), 'Conversation-first startup reaches listening');
        const active = await f.db.prepare('SELECT state,active_at FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first();
        assert.equal(active.state, 'active'); assert(active.active_at);
        assert.equal((await command('state')).configurations, 1, 'Duplicated/reordered startup does not repeat configuration');
        await json(await stop(sessionId));
      } else {
        await until(() => events, list => list.some(event => event.type === 'voice.ended' && event.code === 'canvas_voice_configuration_unconfirmed'), 'Unconfirmed startup output remains blocked');
        assert.equal(events.some(event => event.type === 'voice.audio' || event.type === 'voice.state' && event.state === 'listening'), false);
        assert.equal((await f.db.prepare('SELECT active_at FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first()).active_at, null);
      }
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Startup session settles original zero-audio manual identity');
      assert.equal(JSON.parse(settled.metadata_json).canvas_voice_receipt.credits, 0);
      if (name === 'startup_wrapped_extra') {
        assert.match(JSON.parse(settled.metadata_json).canvas_voice_receipt.code, /^canvas_voice_configuration_unconfirmed_tools_/);
        assert.equal(settled.metadata_json.includes('private_unapproved'), false);
      } else if (!['startup_order', 'startup_ping', 'startup_partial_ack', 'startup_wrapped_tools'].includes(name)) assert.equal(JSON.parse(settled.metadata_json).canvas_voice_receipt.code,
        name === 'startup_error_envelope' ? 'canvas_voice_provider_not_ready_u_s0a0_o_m_k04_n0_rpermission'
          : 'canvas_voice_provider_not_ready_' + (name === 'startup_audio' ? 'audio_delta' : 'function_call'));
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      const state = await command('state');
      assert.equal(state.attempts, 1); assert.equal(state.responses, 0); assert.equal(state.appends, 0); assert.equal(state.configurations, name === 'startup_error_envelope' ? 0 : 1);
      assert.equal((await debit()).n, 0);
      assert.equal((await f.db.prepare('SELECT brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first()).brief_revision, 0);
      for (const table of ['canvas_agent_turns', 'canvas_agent_runs']) assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?`).bind(projectId).first()).n, 0);
      assert.equal(JSON.stringify(events).includes('private'), false);
      assert.equal(settled.metadata_json.includes('synthetic-private-error'), false); return;
    }
    if (name === 'handshake_rejected') {
      const rejected = await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' });
      assert.equal(rejected.status, 502);
      assert.deepEqual(await rejected.json(), { ok: false, code: 'canvas_voice_provider_connection_rejected_400_invalid_key' });
      const row = await usage();
      assert.equal(row.provider_outcome, 'failed'); assert.equal(row.billing_status, 'released');
      assert(row.reservation_released_at); assert.equal(row.metadata_json.includes('synthetic-private-detail'), false);
      const diagnostic = await f.db.prepare('SELECT error_code,updated_at FROM member_ai_usage_attempts_v2 WHERE idempotency_key=? AND user_id=?')
        .bind('canvas-voice-' + sessionId, userId).first();
      assert.equal(diagnostic.error_code, 'canvas_voice_provider_connection_rejected_400_invalid_key');
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
    if (mode === 'context') {
      const conversation = () => f.db.prepare('SELECT revision,brief_revision,brief_json FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
      const calls = async () => (await f.db.prepare('SELECT input_json,result_json FROM canvas_voice_calls WHERE session_id=? ORDER BY rowid').bind(sessionId).all()).results;
      const originalFormat = JSON.parse((await conversation()).brief_json).fields.format;
      await command('emit', { command: 'turn' }); await client.wait(event => event.type === 'voice.changed');
      const context = async () => {
        const before = await command('state'); await command('emit', { command: 'context' });
        const after = await until(() => command('state'), state => state.responses === before.responses + 1 && state.toolOutputs.length === before.toolOutputs.length + 1,
          'Actual context result crosses the spoken reply and response refresh');
        const read = after.toolOutputs.at(-1), refreshed = after.responseContexts.at(-1);
        assert.equal(read.ok, true); assert.equal(refreshed.conversationRevision, read.conversationRevision + 1);
        assert.equal((await conversation()).revision, refreshed.conversationRevision);
        assert.equal(refreshed.briefRevision, read.briefRevision); return read;
      };
      for (let cycle = 0; cycle < 2; cycle++) {
        const read = await context();
        await command('emit', { command: 'apply' });
        await until(conversation, row => row.revision === read.conversationRevision + 3 && row.brief_revision === cycle + 1,
          'Returned context remains valid across only its own reply projections');
        const saved = await calls(); assert.equal(saved.length, cycle + 1);
        const input = JSON.parse(saved[cycle].input_json), result = JSON.parse(saved[cycle].result_json);
        assert.equal(input.expectedConversationRevision, read.conversationRevision);
        assert.equal(result.conversationRevision, read.conversationRevision + 2);
        assert.deepEqual(input.format, { aspectRatio: null, resolution: null, provenance: 'unresolved' });
        assert.deepEqual(JSON.parse((await conversation()).brief_json).fields.format, originalFormat, 'No invented format and no deletion of prior meaningful format');
        const revision = (await conversation()).revision, providerBefore = await command('state');
        const prior = client.events.filter(event => event.type === 'voice.state' && event.state === 'listening').length;
        await command('emit', { command: 'replay' });
        await until(() => client.events, events => events.filter(event => event.type === 'voice.state' && event.state === 'listening').length > prior, 'Exact call replay crosses relay');
        assert.deepEqual(await calls(), saved); assert.equal((await conversation()).revision, revision);
        assert.equal((await command('state')).responses, providerBefore.responses);
      }
      const saved = await calls();
      assert.equal(JSON.parse((await conversation()).brief_json).fields.story.value, 'Eine Katze erkundet den Garten.');
      assert.equal(JSON.parse((await conversation()).brief_json).fields.style.value, 'Cartoon');
      if (name === 'context_negative') {
        await context(); // A fresh semantic fence makes the forged revision independently wrong.
        for (const operation of ['stale', 'unknown']) {
          const before = await command('state'); await command('emit', { command: operation });
          const after = await until(() => command('state'), state => state.toolOutputs.length === before.toolOutputs.length + 1 && state.responses === before.responses + 1,
            'Rejected context reaches the actual provider result: ' + operation);
          assert.deepEqual({ ok: after.toolOutputs.at(-1).ok, code: after.toolOutputs.at(-1).code }, { ok: false, code: 'canvas_agent_conversation_changed' });
          assert.deepEqual(await calls(), saved); assert.equal((await conversation()).brief_revision, 2);
        }
        const foreign = await request(`/sessions/${sessionId}/stop`, {}, { Cookie: '__Host-bitbi_session=' + userId.replace('voice-native-owner-', 'voice-native-other-'), 'Idempotency-Key': sessionId });
        assert.equal(foreign.status, 404); assert.equal((await f.db.prepare('SELECT state FROM canvas_voice_sessions WHERE id=?').bind(sessionId).first()).state, 'active');
        const before = await command('state');
        await f.db.prepare('UPDATE canvas_projects SET revision=revision+1 WHERE id=?').bind(projectId).run();
        await client.wait(event => event.type === 'voice.ended' && event.code === 'canvas_voice_authority_changed');
        // A project edit revokes admission before tool dispatch, not merely its
        // proposed revision. This stronger existing boundary remains required.
        assert.deepEqual(await calls(), saved); assert.equal((await conversation()).brief_revision, 2);
        assert.equal((await command('state')).responses, before.responses);
        assert.equal((await command('state')).toolOutputs.length, before.toolOutputs.length);
      }
      await json(await stop(sessionId));
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Context lifecycle settles original usage');
      const receipt = JSON.parse(settled.metadata_json).canvas_voice_receipt, once = await debit();
      assert(receipt.outputSamples >= 9600); assert.deepEqual(once, { n: 1, amount: -receipt.credits });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.notEqual((await request(`/sessions/${sessionId}/socket`, undefined, { Upgrade: 'websocket' })).status, 101);
      assert.deepEqual(await debit(), once); assert.deepEqual(await calls(), saved);
      assert.equal((await command('state')).connections, 1);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n, 0);
      return;
    }
    if (mode === 'source') {
      const conversation = () => f.db.prepare('SELECT revision,brief_revision,brief_json FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
      const calls = async () => (await f.db.prepare('SELECT input_json,result_json FROM canvas_voice_calls WHERE session_id=?').bind(sessionId).all()).results;
      const turns = async () => (await f.db.prepare('SELECT t.id,t.user_text,t.assistant_text,v.source_turn_id,v.provider_response_id FROM canvas_agent_turns t JOIN canvas_voice_turns v ON v.turn_id=t.id WHERE v.session_id=? ORDER BY t.rowid').bind(sessionId).all()).results;
      const emitted = async (operation, source = 'a') => {
        const prior = client.events.filter(event => event.type === 'voice.state' && event.state === 'listening').length;
        await command('emit', { command: operation, source });
        await until(() => client.events, events => events.filter(event => event.type === 'voice.state' && event.state === 'listening').length > prior, 'Source event reached relay: ' + operation);
      };
      if (name === 'source_idle') {
        for (const operation of ['start', 'commit', 'final', 'idle']) await emitted(operation);
      } else await emitted(name === 'source_missing' ? 'missing' : 'start');
      await emitted('response'); // Automatic VAD response exists before commit/final.
      if (name === 'source_superseded') {
        for (const operation of ['start', 'commit', 'final']) await emitted(operation, 'b');
        // Delayed A completion and duplicated old speech cannot steal B's source.
        for (const operation of ['final', 'commit', 'start']) await emitted(operation);
      } else if (name !== 'source_idle') {
        for (const operation of name === 'source_commit_before' ? ['commit', 'final'] : ['final', 'commit']) await emitted(operation);
      }
      const before = await conversation();
      assert.equal(before.brief_revision, 0); assert.deepEqual(await calls(), []);
      await emitted('output'); // Must inherit response A, even after B is current.
      await emitted('tool');
      const outcome = client.events.find(event => event.type === 'voice.changed' && event.tool)?.tool;
      const succeeds = ['source_commit_after', 'source_commit_before'].includes(name);
      assert.deepEqual(outcome, succeeds ? { name: 'canvas_update_brief', ok: true, sourceState: 'ready' }
        : { name: 'canvas_update_brief', ok: false, code: name === 'source_superseded' ? 'canvas_voice_source_changed' : 'canvas_voice_transcript_pending',
          sourceState: name === 'source_superseded' ? 'superseded' : 'unbound' });
      const saved = await calls(), applied = await conversation();
      assert.equal(saved.length, succeeds ? 1 : 0); assert.equal(applied.brief_revision, succeeds ? 1 : 0);
      if (succeeds) assert.equal(JSON.parse(applied.brief_json).fields.story.value, 'Eine Katze erkundet den Garten.');
      // Duplicate final/start/commit/call are inert before the response completes.
      if (succeeds) for (const operation of ['start', 'commit', 'final', 'replay']) await emitted(operation);
      else await emitted('replay');
      assert.deepEqual(await calls(), saved); assert.deepEqual(await conversation(), applied);
      await emitted('done');
      await until(() => command('state'), state => state.responses === 1 && state.toolOutputs.length === 1, 'Exactly one original tool result and continuation');
      if (name === 'source_superseded') {
        const projected = await until(turns, rows => rows.some(row => row.provider_response_id === 'source_response_a'), 'Late response retains its original user');
        const reply = projected.find(row => row.provider_response_id === 'source_response_a');
        assert.equal(projected.find(row => row.id === reply.source_turn_id).user_text, 'Eine Katze erkundet den Garten.');
        assert.notEqual(reply.source_turn_id, projected.find(row => row.user_text === 'Bitte stattdessen einen Hund im Park.').id);
      }
      await json(await stop(sessionId));
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Source fixture settles its original VAD session');
      const receipt = JSON.parse(settled.metadata_json).canvas_voice_receipt, once = await debit();
      assert(receipt.outputSamples >= 2400); assert.deepEqual(once, { n: 1, amount: -receipt.credits });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.deepEqual(await debit(), once); assert.deepEqual(await calls(), saved);
      assert.equal((await command('state')).connections, 1);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n, 0);
      return;
    }
    if (mode === 'revision') {
      const conversation = () => f.db.prepare('SELECT revision,brief_revision,brief_json FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
      const calls = async () => (await f.db.prepare('SELECT input_json,result_json FROM canvas_voice_calls WHERE session_id=?').bind(sessionId).all()).results;
      await command('emit', { command: 'turn' }); await client.wait(event => event.type === 'voice.changed');
      await command('emit', { command: 'answer' });
      await until(conversation, row => row.revision === 2, 'Real transcript and reply advance only conversation revision');
      assert.equal((await command('state')).configurations, 1, 'Provider still has original revision0 from initial context');
      if (name === 'revision_external') {
        await f.db.prepare('UPDATE canvas_agent_conversations SET revision=revision+1 WHERE project_id=?').bind(projectId).run();
        await command('emit', { command: 'apply' });
        await client.wait(event => event.type === 'voice.ended' && event.code === 'canvas_voice_context_changed');
        assert.deepEqual(await calls(), []); assert.equal((await conversation()).brief_revision, 0);
      } else if (name === 'revision_forged') {
        for (const [operation, code] of [['forged', 'canvas_agent_conversation_changed'], ['injected', 'canvas_voice_tool_arguments_invalid']]) {
          await command('emit', { command: operation });
          await client.wait(event => event.type === 'voice.changed' && event.tool?.name === 'canvas_update_brief' && event.tool.code === code);
        }
        assert.deepEqual(await calls(), []); assert.equal((await conversation()).brief_revision, 0);
      } else {
        await command('emit', { command: 'apply' });
        await client.wait(event => event.type === 'voice.changed' && event.tool?.name === 'canvas_update_brief' && event.tool.ok === true);
        await until(conversation, row => row.revision === 4, 'Applied brief and final reply complete through real Owner');
        const saved = await calls(); assert.equal(saved.length, 1);
        assert.equal(JSON.parse(saved[0].input_json).expectedConversationRevision, 0, 'Immutable receipt retains the actual model argument, not a rewritten revision');
        assert.equal(JSON.parse(saved[0].result_json).conversationRevision, 3);
        assert.equal(JSON.parse((await conversation()).brief_json).fields.story.value, 'Eine Katze erkundet den Garten.');
        await command('emit', { command: 'replay' });
        // Processed after replay: an observable provider event, not a timed assumption.
        const prior = client.events.filter(event => event.type === 'voice.state' && event.state === 'listening').length;
        await command('emit', { command: 'turn' });
        await until(() => client.events, events => events.filter(event => event.type === 'voice.state' && event.state === 'listening').length > prior, 'Exact tool replay passes relay queue');
        assert.deepEqual(await calls(), saved); assert.equal((await conversation()).revision, 4);
        assert.equal((await command('state')).responses, 1, 'Same original call never schedules another provider response');
        if (name === 'revision_stale') {
          await command('emit', { command: 'stale' });
          await client.wait(event => event.type === 'voice.changed' && event.tool?.code === 'canvas_agent_conversation_changed');
          assert.deepEqual(await calls(), saved); assert.equal((await conversation()).brief_revision, 1);
        }
      }
      await json(await stop(sessionId));
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Revision fence settles original accepted usage');
      const receipt = JSON.parse(settled.metadata_json).canvas_voice_receipt, once = await debit();
      assert.deepEqual(once, { n: 1, amount: -receipt.credits });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.deepEqual(await debit(), once); assert.equal((await command('state')).connections, 1);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n, 0);
      return;
    }
    if (mode === 'latency') {
      const latency = async delayMs => {
        const response = await f.control('/canvas-voice-owner-latency', { userId, ...(delayMs === undefined ? {} : { delayMs }) });
        assert.equal(response.status, 200, await response.clone().text()); return response.json();
      };
      const before = await latency(1600);
      assert.equal(before.reads, 1, 'Calibrate the real initial canonical history query');
      await command('emit', { command: 'turn' });
      await client.wait(event => event.type === 'voice.changed');
      await command('emit', { command: 'answer' });
      await until(() => client.events, events => events.filter(event => event.type === 'voice.changed').length === 2, 'Both canonical conversation projections are stored');
      assert.deepEqual(await latency(), before, 'Ordinary user/reply persistence must not repeat full context reads');
      assert.equal((await command('state')).configurations, 1);
      const original = await f.db.prepare('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
      assert.equal(original.revision, 2); assert.equal(original.brief_revision, 0);
      const cadence = name === 'latency_opus' ? 60 : name === 'latency_legacy' ? 20 : 100;
      // Opus is one structurally valid 60ms packet, not concatenated 20ms packets.
      const packet = name === 'latency_opus' ? Buffer.from([0x18, 0]).toString('base64') : Buffer.alloc(cadence * 24 * 2).toString('base64');
      let streaming = true, sent = 0;
      const stream = (async () => { while (streaming && !client.events.some(event => event.type === 'voice.ended')) {
        client.send({ type: 'audio.append', audio: packet }); sent++; await pause(cadence);
      } })();
      try {
        await command('emit', { command: 'context' });
        await until(latency, value => value.pending === 1, 'Required context tool reaches controlled native D1 latency');
        if (name === 'latency_stop') {
          await json(await stop(sessionId)); await client.wait(event => event.type === 'voice.ended');
        } else if (name === 'latency_legacy') {
          await client.wait(event => event.type === 'voice.ended' && event.code === 'canvas_voice_backpressure');
        } else {
          await until(() => command('state'), state => state.responses === 3, 'Context, guarded brief change and continuation complete under capture', 20000);
          await until(() => client.events, events => events.filter(event => event.type === 'voice.changed').length >= 6, 'Final reply is durably projected after tools');
          assert.equal(client.events.some(event => event.type === 'voice.ended'), false);
          const state = await command('state');
          assert.deepEqual(state.toolOutputs.map(output => output.ok), [true, true, true]);
          assert.equal(state.toolOutputs[1].applied, true); assert.equal(state.toolOutputs[2].style, 'Cartoon');
          assert.equal(state.toolOutputs[2].briefRevision, 1);
          assert.deepEqual(state.responseContexts.map(context => context.briefRevision), [0, 1, 1]);
          assert.deepEqual(state.responseContexts.slice(1).map(context => context.style), ['Cartoon', 'Cartoon']);
          assert.equal(state.configurations, 2, 'Only the confirmed brief change refreshes session policy/context');
          assert.equal((await latency()).delayed, 6, 'Explicit tool/response and brief-change reads remain real and fresh');
        }
      } finally { streaming = false; await stream; }
      await json(await stop(sessionId));
      await until(latency, value => value.pending === 0, 'No delayed native context read survives fixture cleanup');
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Pressure fixture settles original accepted session');
      const receipt = JSON.parse(settled.metadata_json).canvas_voice_receipt, state = await command('state');
      if (name === 'latency_legacy') assert.equal(receipt.code, 'canvas_voice_backpressure_count', 'Broken old cadence still trips the unchanged queue limit');
      if (['latency_legacy', 'latency_stop'].includes(name)) {
        assert.equal(state.responses, 0); assert.equal(state.toolOutputs.length, 0);
        assert.deepEqual(await f.db.prepare('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first(), original);
      } else assert.equal(state.appends, sent, 'No packet is silently dropped to survive latency');
      assert.equal(receipt.inputSamples, state.appends * cadence * 24);
      assert.equal(receipt.outputSamples, name === 'latency_pcm' || name === 'latency_opus' ? 4800 : 2400);
      const once = await debit(); assert.deepEqual(once, { n: 1, amount: -receipt.credits });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.deepEqual(await debit(), once); assert.equal(state.connections, 1); assert.equal(state.attempts, 1);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n, 0);
      return;
    }
    if (name.startsWith('transcript_')) {
      const turns = async () => (await f.db.prepare('SELECT t.user_text,t.assistant_text,v.provider_item_id FROM canvas_agent_turns t JOIN canvas_voice_turns v ON v.turn_id=t.id WHERE t.project_id=?').bind(projectId).all()).results;
      const revision = () => f.db.prepare('SELECT revision,brief_revision FROM canvas_agent_conversations WHERE project_id=?').bind(projectId).first();
      const original = await revision();
      const emitted = async event => {
        const prior = client.events.filter(item => item.type === 'voice.state' && item.state === 'listening').length;
        await command('emit', { command: event });
        await until(() => client.events, list => list.filter(item => item.type === 'voice.state' && item.state === 'listening').length > prior, 'Transcript boundary reached ' + event);
      };
      const unpublished = async () => {
        assert.deepEqual(await turns(), [], 'No transcript row before both provider boundaries');
        assert.deepEqual(await revision(), original, 'Provisional transcription does not advance creative/conversation state');
        assert.equal((await command('state')).configurations, 1, 'Provisional transcription cannot refresh provider context');
      };
      client.send({ type: 'audio.append', audio: Buffer.alloc(960).toString('base64') });
      await until(() => command('state'), state => state.appends === 1, 'Original accepted input reaches provider once');
      if (name === 'transcript_commit_before') {
        await emitted('commit'); await unpublished(); await emitted('final');
      } else {
        await emitted('prefix'); await unpublished();
        await emitted('interim'); await unpublished();
        if (name !== 'transcript_abandoned') { await emitted('final'); await unpublished(); await emitted('commit'); }
      }
      if (name !== 'transcript_abandoned') {
        const expected = [{ user_text: 'Ich möchte ein Katzenvideo erstellen.', assistant_text: null, provider_item_id: 'input:lifecycle_transcript_item' }];
        assert.deepEqual(await turns(), expected);
        const saved = await revision(); assert.equal(saved.revision, original.revision + 1); assert.equal(saved.brief_revision, original.brief_revision);
        assert.equal((await command('state')).configurations, 1, 'Provider already owns the committed transcript');
        for (const event of ['commit', 'final', 'commit', 'final']) await emitted(event);
        assert.deepEqual(await turns(), expected); assert.deepEqual(await revision(), saved);
        assert.equal((await command('state')).configurations, 1, 'Replay does not repeat context refresh');
        if (name === 'transcript_final_conflict') {
          await command('emit', { command: 'conflict' });
          await client.wait(event => event.type === 'voice.ended' && event.code === 'idempotency_conflict');
          assert.deepEqual(await turns(), expected, 'A changed final cannot rewrite an immutable user turn');
          assert.deepEqual(await revision(), saved);
        }
      }
      await json(await stop(sessionId));
      const settled = await until(usage, row => row?.billing_status === 'finalized', 'Transcript boundary session settles its original usage');
      const receipt = JSON.parse(settled.metadata_json).canvas_voice_receipt;
      assert.equal(receipt.inputSamples, 480); assert.equal(receipt.outputSamples, 0);
      assert(Number.isSafeInteger(receipt.credits) && receipt.credits > 0, 'Actual forwarded input remains accounted');
      const once = await debit(); assert.deepEqual(once, { n: 1, amount: -receipt.credits });
      for (let replay = 0; replay < 2; replay++) await json(await stop(sessionId));
      assert.deepEqual(await debit(), once, 'Repeated Stop never debits the original usage twice');
      if (name === 'transcript_abandoned') await unpublished();
      const state = await command('state'); assert.equal(state.attempts, 1); assert.equal(state.connections, 1); assert.equal(state.appends, 1); assert.equal(state.responses, 0);
      assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM canvas_agent_runs WHERE project_id=?').bind(projectId).first()).n, 0);
      return;
    }
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
      await until(() => command('state'), state => state.responses === 1 && state.configurations === 1, 'Partial response retains initial configuration');
      // A real protocol event queued after the transcript proves that the
      // partial text reached the relay; elapsed time does not prove delivery.
      await until(() => client.events, events => events.filter(event => event.type === 'voice.state' && event.state === 'listening').length === 2,
        'Partial text is followed by its queue fence, beyond the initial readiness event');
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
