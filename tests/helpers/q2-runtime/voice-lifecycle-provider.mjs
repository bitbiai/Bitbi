// Native workerd-only provider. The surrounding runtime denies all network
// egress; normal coverage uses the unchanged provider until a case opts in.
import normalProvider from './voice-provider.mjs';

const modes = new Set(['idle', 'pending', 'abnormal', 'no_ack', 'delayed_ack', 'partial', 'resume', 'rejected', 'transcript', 'latency', 'revision', 'source', 'context', 'startup_order', 'startup_audio', 'startup_tool', 'startup_error_envelope', 'startup_ping', 'startup_partial_ack', 'startup_wrapped_tools', 'startup_wrapped_extra']);
let current = null;
const snapshot = state => state ? { enabled: true, mode: state.mode, attempts: state.attempts,
  connections: state.connections, appends: state.appends, responses: state.responses,
  configurations: state.configurations, closeRequests: state.closeRequests, resumedIds: state.resumedIds,
  released: state.released, pending: Boolean(state.release), toolOutputs: state.toolOutputs.map(value => ({ ok: value.ok, code: value.code,
    applied: value.data?.applied, conversationRevision: value.data?.conversationRevision, briefRevision: value.data?.briefRevision, style: value.data?.brief?.fields?.style?.value })),
  responseContexts: state.responseContexts, audioFrames: state.audioFrames } : { enabled: false };
const handler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.origin === 'https://voice-fixture.invalid' && url.pathname.startsWith('/lifecycle/')) {
      if (url.pathname === '/lifecycle/state' && request.method === 'GET') return Response.json(snapshot(current));
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json();
      if (url.pathname === '/lifecycle/control') {
        if (!modes.has(body.mode)) return new Response(null, { status: 400 });
        if (current?.release) throw new Error('Lifecycle fetch must be released before changing fixture');
        current = { mode: body.mode, attempts: 0, connections: 0, appends: 0, responses: 0,
          configurations: 0, closeRequests: 0, released: false, release: null, socket: null, resumedIds: [], conversationId: null, toolOutputs: [], responseContexts: [], audioFrames: [] };
      } else if (url.pathname === '/lifecycle/release') {
        if (!current?.release) return new Response(null, { status: 409 });
        current.released = true; current.release(); current.release = null;
      } else if (url.pathname === '/lifecycle/emit') {
        if (!current?.socket) return new Response(null, { status: 400 });
        if (body.command === 'close_abnormal') current.socket.close(4001, 'Synthetic provider failure');
        else if (current.mode === 'context' && body.command !== 'turn') {
          if (body.command === 'context') current.contextCycle();
          else if (body.command === 'next_turn') {
            current.emit({ type: 'input_audio_buffer.committed', item_id: 'context_next_input' });
            current.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'context_next_input', transcript: 'Bitte ändere den Stil auf realistisch.' });
          }
          else if (body.command === 'frame' || body.command === 'frame_oversized') { current.audioFrame(body.command === 'frame_oversized'); return Response.json(snapshot(current)); }
          else if (body.command === 'replay' && current.lastApply) current.call('canvas_update_brief', current.lastApply.args, current.lastApply.suffix);
          else if (['apply', 'stale', 'unknown'].includes(body.command)) {
            const context = body.command === 'stale' ? current.firstContext : current.latestContext;
            if (!context) throw new Error('Fixture requires the actual returned Canvas context');
            const args = { expectedConversationRevision: context.conversationRevision + (body.command === 'unknown' ? 777 : 0),
              expectedBriefRevision: context.briefRevision, expectedProjectRevision: context.projectRevision,
              updates: [{ field: current.contextReads === 1 ? 'story' : 'style', value: current.contextReads === 1 ? 'Eine Katze erkundet den Garten.' : current.contextReads === 3 ? 'realistisch' : 'Cartoon', provenance: 'user_stated' }],
              questions: [], format: { aspectRatio: null, resolution: null, provenance: 'unresolved' }, duration: null };
            const suffix = 'context_' + body.command + '_' + current.contextReads;
            if (body.command === 'apply') current.lastApply = { args, suffix };
            current.call('canvas_update_brief', args, suffix);
          } else return new Response(null, { status: 400 });
          current.barrier();
        }
        else if (current.mode === 'source') {
          const item_id = body.source === 'b' ? 'source_b' : 'source_a';
          const response_id = 'source_response_a';
          if (body.command === 'start') current.emit({ type: 'input_audio_buffer.speech_started', item_id });
          else if (body.command === 'missing') current.emit({ type: 'input_audio_buffer.speech_started' });
          else if (body.command === 'idle') current.emit({ type: 'input_audio_buffer.timeout_triggered', item_id: 'silent_idle' });
          else if (body.command === 'response') current.emit({ type: 'response.created', response: { id: response_id } });
          else if (body.command === 'commit') current.emit({ type: 'input_audio_buffer.committed', item_id });
          else if (body.command === 'final') current.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id,
            transcript: body.source === 'b' ? 'Bitte stattdessen einen Hund im Park.' : 'Eine Katze erkundet den Garten.' });
          else if (body.command === 'output') {
            current.emit({ type: 'response.output_item.added', response_id, item: { type: 'message', id: 'source_output_a' } });
            current.emit({ type: 'response.output_audio.delta', response_id, item_id: 'source_output_a', delta: btoa('\0'.repeat(4800)) });
            current.emit({ type: 'response.output_audio_transcript.delta', response_id, item_id: 'source_output_a', delta: 'Ich prüfe die Katzenidee.' });
          } else if (body.command === 'tool' || body.command === 'replay') {
            const context = current.initialContext;
            current.emit({ type: 'response.function_call_arguments.done', response_id, call_id: 'source_call_a', name: 'canvas_update_brief',
              arguments: JSON.stringify({ expectedConversationRevision: context.conversationRevision, expectedBriefRevision: context.briefRevision,
                expectedProjectRevision: context.projectRevision, updates: [{ field: 'story', value: 'Eine Katze erkundet den Garten.', provenance: 'user_stated' }],
                questions: [], format: null, duration: null }) });
          } else if (body.command === 'done') current.emit({ type: 'response.done', response: { id: response_id, status: 'completed' } });
          else return new Response(null, { status: 400 });
          current.barrier();
        }
        else if (current.mode === 'revision' && ['apply', 'replay', 'stale', 'forged', 'injected'].includes(body.command)) {
          const context = current.initialContext;
          const args = { expectedConversationRevision: context.conversationRevision, expectedBriefRevision: context.briefRevision, expectedProjectRevision: context.projectRevision,
            updates: [{ field: 'story', value: 'Eine Katze erkundet den Garten.', provenance: 'user_stated' }], questions: [], format: null, duration: null };
          if (body.command === 'forged') args.expectedConversationRevision += 999;
          if (body.command === 'injected') args.trustedConversationRevision = context.conversationRevision + 2;
          current.call('canvas_update_brief', args, body.command === 'replay' ? 'apply' : body.command);
        } else if (['latency', 'revision', 'context'].includes(current.mode)) {
          if (body.command === 'turn') {
            current.emit({ type: 'input_audio_buffer.committed', item_id: 'latency_input' });
            current.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'latency_input', transcript: 'Ein Katzenvideo im Cartoon-Stil.' });
          } else if (body.command === 'answer') current.answer('ordinary');
          else if (body.command === 'context') current.call('canvas_context', {}, 'context');
          else return new Response(null, { status: 400 });
          current.barrier();
        } else if (current.mode === 'transcript') {
          const item_id = 'lifecycle_transcript_item';
          const events = {
            prefix: { type: 'conversation.item.input_audio_transcription.completed', item_id, transcript: 'Ich möch' },
            interim: { type: 'conversation.item.input_audio_transcription.updated', item_id, transcript: 'Ich möchte ein Katzenvideo' },
            final: { type: 'conversation.item.input_audio_transcription.completed', item_id, transcript: 'Ich möchte ein Katzenvideo erstellen.' },
            commit: { type: 'input_audio_buffer.committed', item_id },
            conflict: { type: 'conversation.item.input_audio_transcription.completed', item_id, transcript: 'Ein anderer abgeschlossener Beitrag.' },
          };
          if (!Object.hasOwn(events, body.command)) return new Response(null, { status: 400 });
          current.emit(events[body.command]);
          current.barrier();
        } else return new Response(null, { status: 400 });
      } else return new Response(null, { status: 404 });
      return Response.json(snapshot(current));
    }
    if (!current || url.origin === 'https://voice-fixture.invalid') return normalProvider.fetch(request, env, ctx);
    if (url.origin !== 'https://api.x.ai' || url.pathname !== '/v1/realtime' || url.searchParams.get('model') !== 'grok-voice-3.0'
      || [...url.searchParams.keys()].some(key => !['model', 'conversation_id'].includes(key)) || request.method !== 'GET'
      || request.headers.get('Upgrade') !== 'websocket'
      || request.headers.get('Authorization') !== 'Bearer test-key') throw new Error('Unexpected native lifecycle outbound request');
    const state = current; state.attempts++;
    if (state.mode === 'rejected') return Response.json({ error: 'Incorrect API key provided: synthetic-private-detail must not be retained' }, { status: 400 });
    const resumedId = url.searchParams.get('conversation_id');
    if (resumedId && (state.mode !== 'resume' || resumedId !== state.conversationId)
      || state.mode === 'resume' && state.connections > 0 && !resumedId) throw new Error('Unexpected native provider resumption identity');
    state.resumedIds.push(resumedId);
    if (state.mode === 'pending') await new Promise(resolve => { state.release = resolve; });
    const pair = new WebSocketPair(), socket = pair[1]; state.socket = socket; state.connections++;
    const conversationId = resumedId || 'lifecycle_conversation_' + state.connections;
    state.conversationId = conversationId;
    let sequence = 0;
    const emit = event => socket.send(JSON.stringify({ event_id: 'lifecycle_' + ++sequence, ...event }));
    state.emit = emit;
    // An unassociated, content-free completion is an observable queue fence.
    // Unlike timeout_triggered it never commits a silent turn or changes source;
    // without a response.created it also cannot clear an active manual turn.
    state.barrier = () => emit({ type: 'response.done', response: { id: 'fixture_barrier_' + sequence, status: 'completed' } });
    state.call = (name, args, suffix) => {
      const response_id = 'latency_response_' + suffix;
      emit({ type: 'response.created', response: { id: response_id } });
      emit({ type: 'response.function_call_arguments.done', response_id, call_id: 'latency_call_' + suffix, name, arguments: JSON.stringify(args) });
      emit({ type: 'response.done', response: { id: response_id, status: 'completed' } });
    };
    state.answer = suffix => {
      const response_id = 'latency_answer_' + suffix, item_id = 'latency_answer_item_' + suffix;
      emit({ type: 'response.created', response: { id: response_id } });
      emit({ type: 'response.output_item.added', response_id, item: { type: 'message', id: item_id } });
      emit({ type: 'response.output_audio.delta', response_id, item_id, delta: btoa('\0'.repeat(4800)) });
      emit({ type: 'response.output_audio_transcript.delta', response_id, item_id, delta: 'Welche Dauer möchtest du?' });
      emit({ type: 'response.done', response: { id: response_id, status: 'completed' } });
    };
    state.audioFrame = oversized => {
      const response_id = oversized ? 'native_frame_oversized' : 'native_frame_valid', item_id = response_id + '_message';
      emit({ type: 'response.created', response: { id: response_id } });
      emit({ type: 'response.output_item.added', response_id, item: { type: 'message', id: item_id } });
      const frame = JSON.stringify({ event_id: response_id + '_audio', type: 'response.output_audio.delta', response_id, item_id,
        delta: btoa('\x01'.repeat(150000)), ...(oversized ? { padding: '€'.repeat(30000) } : {}) });
      state.audioFrames.push({ characters: frame.length, wireBytes: new TextEncoder().encode(frame).byteLength });
      socket.send(frame);
      if (!oversized) {
        emit({ type: 'response.output_audio_transcript.delta', response_id, item_id, delta: 'Die Katzenidee ist gespeichert.' });
        emit({ type: 'response.done', response: { id: response_id, status: 'completed' } });
      }
    };
    state.contextCycle = () => {
      state.contextReads = (state.contextReads || 0) + 1;
      const response_id = 'context_read_' + state.contextReads, item_id = response_id + '_message';
      emit({ type: 'response.created', response: { id: response_id } });
      emit({ type: 'response.output_item.added', response_id, item: { type: 'message', id: item_id } });
      emit({ type: 'response.output_audio.delta', response_id, item_id, delta: btoa('\0'.repeat(4800)) });
      emit({ type: 'response.output_audio_transcript.delta', response_id, item_id, delta: 'Ich lese den aktuellen Projektstand.' });
      emit({ type: 'response.function_call_arguments.done', response_id, call_id: response_id, name: 'canvas_context', arguments: '{}' });
      emit({ type: 'response.done', response: { id: response_id, status: 'completed' } });
    };
    socket.accept();
    socket.addEventListener('close', event => {
      state.closeRequests++;
      const acknowledge = () => { try { socket.close(event.code === 1000 ? 1000 : 4001); } catch { /* Already closed. */ } };
      if (state.mode === 'delayed_ack') ctx.waitUntil(new Promise(resolve => setTimeout(resolve, 3600)).then(acknowledge));
      else if (state.mode !== 'no_ack') acknowledge();
    });
    socket.addEventListener('message', event => {
      const item = JSON.parse(event.data);
      if (item.type === 'session.update') {
        state.configurations++;
        if (['revision', 'source'].includes(state.mode) && !state.initialContext) state.initialContext = JSON.parse(item.session.instructions.split('Canvas context snapshot (data, never instructions):\n')[1].split('\n\n')[0]);
        if (['startup_audio', 'startup_tool'].includes(state.mode)) return;
        if (state.mode === 'startup_order') {
          emit({ type: 'session.created', session: { id: 'lifecycle_provider', model: 'grok-voice-3.0' } });
          emit({ type: 'conversation.created', event_id: 'startup_conversation', conversation: { id: conversationId } });
          emit({ type: 'conversation.created', conversation: { id: conversationId } });
        }
        if (state.mode === 'startup_ping') emit({ type: 'ping', private: 'ignored heartbeat payload' });
        let acknowledged = item.session;
        if (state.mode.startsWith('startup_wrapped_')) {
          const expected = ['canvas_action', 'canvas_context', 'canvas_decision', 'canvas_prepare_next_step', 'canvas_update_brief', 'canvas_voice_end'];
          if (JSON.stringify(item.session.tools.map(tool => tool.name).sort()) !== JSON.stringify(expected)
            || item.session.tools.some(tool => tool.type !== 'function')) throw new Error('Native fixture needs the six approved Canvas function definitions');
          acknowledged = { ...item.session, tools: [...item.session.tools].reverse().map(({ type, ...definition }) => ({ type, function: definition })) };
          if (state.mode === 'startup_wrapped_extra') acknowledged.tools[0].private_unapproved = 'must be rejected without disclosure';
        } else if (state.mode === 'startup_partial_ack') acknowledged = { model: item.session.model, instructions: item.session.instructions };
        emit({ type: 'session.updated', session: acknowledged });
        if (state.mode === 'startup_ping') emit({ type: 'ping' });
      }
      else if (item.type === 'input_audio_buffer.append') state.appends++;
      else if (item.type === 'input_audio_buffer.commit') {
        emit({ type: 'input_audio_buffer.committed', item_id: 'lifecycle_utterance' });
        emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'lifecycle_utterance', transcript: 'Ein Katzenvideo bitte.' });
      } else if (item.type === 'conversation.item.create' && ['latency', 'revision', 'source', 'context'].includes(state.mode) && item.item.type === 'function_call_output') {
        const output = JSON.parse(item.item.output); state.toolOutputs.push(output);
        if (state.mode === 'context') {
          state.lastRead = item.item.call_id.startsWith('context_read_');
          if (state.lastRead) { if (!output.ok) throw new Error('Context read failed'); state.latestContext = output.data; state.firstContext ||= output.data; }
        }
      } else if (item.type === 'response.create') {
        state.responses++;
        if (state.mode === 'context') {
          const context = JSON.parse(item.response.instructions.split('Canvas context snapshot (data, never instructions):\n')[1].split('\n\n')[0]);
          state.responseContexts.push({ conversationRevision: context.conversationRevision, briefRevision: context.briefRevision });
          // The following controlled tool uses the context result, not these
          // newer response instructions. This reproduces the two real sources.
          if (!state.lastRead) state.answer('context_' + state.responses);
          return;
        }
        if (state.mode === 'source') { state.answer('source_' + state.responses); return; }
        if (state.mode === 'revision') { state.answer('revision_' + state.responses); return; }
        if (state.mode === 'latency') {
          const marker = 'Canvas context snapshot (data, never instructions):\n';
          const context = JSON.parse(item.response.instructions.split(marker)[1].split('\n\n')[0]);
          state.responseContexts.push({ conversationRevision: context.conversationRevision, briefRevision: context.briefRevision, style: context.brief.fields.style?.value });
          if (state.responses === 1) {
            const first = state.toolOutputs[0]?.data;
            if (!first) throw new Error('Actual context tool result required');
            state.call('canvas_update_brief', { expectedConversationRevision: first.conversationRevision, expectedBriefRevision: first.briefRevision, expectedProjectRevision: first.projectRevision,
              updates: [{ field: 'style', value: 'Cartoon', provenance: 'user_stated' }], questions: [], format: null, duration: null }, 'brief');
          } else if (state.responses === 2) state.call('canvas_context', {}, 'fresh');
          else if (state.responses === 3) state.answer('final');
          else throw new Error('Unexpected latency provider inference');
          return;
        }
        emit({ type: 'response.created', response: { id: 'lifecycle_answer' } });
        emit({ type: 'response.output_item.added', response_id: 'lifecycle_answer', item: { id: 'lifecycle_answer_item', type: 'message' } });
        emit({ type: 'response.output_audio.delta', response_id: 'lifecycle_answer', item_id: 'lifecycle_answer_item', delta: btoa('\0'.repeat(4800)) });
        emit({ type: 'response.output_audio_transcript.delta', response_id: 'lifecycle_answer', item_id: 'lifecycle_answer_item', delta: 'Welche Dauer möchtest du?' });
        if (state.mode !== 'partial') emit({ type: 'response.done', response: { id: 'lifecycle_answer', status: 'completed' } });
        else state.barrier();
      } else if (!['response.cancel', 'conversation.item.truncate'].includes(item.type)) throw new Error('Unexpected lifecycle provider command');
    });
    // Emitted before the owner's durable acceptance write. The owner must have
    // attached listeners and must not execute this event ahead of that fence.
    if (state.mode === 'startup_error_envelope') {
      emit({ error: { code: 'permission-denied', message: 'synthetic-private-error-must-not-be-retained' } });
    } else if (state.mode.startsWith('startup_')) {
      emit({ type: 'conversation.created', event_id: 'startup_conversation', conversation: { id: conversationId } });
      if (state.mode === 'startup_order') emit({ type: 'conversation.item.added', item: { id: 'historical_call', type: 'function_call',
        name: 'canvas_update_brief', arguments: '{"private":"must remain inert"}' } });
      else if (['startup_ping', 'startup_partial_ack', 'startup_wrapped_tools', 'startup_wrapped_extra'].includes(state.mode)) emit({ type: 'ping' });
      else if (state.mode === 'startup_audio') emit({ type: 'response.output_audio.delta', response_id: 'early_response', item_id: 'early_item', delta: btoa('\0\0') });
      else emit({ type: 'response.function_call_arguments.done', call_id: 'early_call', response_id: 'early_response',
        name: 'canvas_update_brief', arguments: '{"private":"must never execute"}' });
    } else {
      emit({ type: 'session.created', session: { id: 'lifecycle_provider', model: 'grok-voice-3.0' } });
      emit({ type: 'conversation.created', conversation: { id: conversationId } });
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  },
};

// Controls and WebSocket callbacks share one native DO I/O owner. A plain
// Worker-global socket would illegally cross request lifetimes in workerd.
export class VoiceProviderFixture {
  constructor(state, env) { this.state = state; this.env = env; }
  fetch(request) { return handler.fetch(request, this.env, this.state); }
}
export default {
  fetch(request, env) { return env.VOICE_PROVIDER.get(env.VOICE_PROVIDER.idFromName('native-voice-provider')).fetch(request); },
};
