// Native workerd-only provider. The surrounding runtime denies all network
// egress; normal coverage uses the unchanged provider until a case opts in.
import normalProvider from './voice-provider.mjs';

const modes = new Set(['idle', 'pending', 'abnormal', 'no_ack', 'delayed_ack', 'partial', 'resume', 'rejected', 'startup_order', 'startup_audio', 'startup_tool', 'startup_error_envelope', 'startup_ping', 'startup_partial_ack']);
let current = null;
const snapshot = state => state ? { enabled: true, mode: state.mode, attempts: state.attempts,
  connections: state.connections, appends: state.appends, responses: state.responses,
  configurations: state.configurations, closeRequests: state.closeRequests, resumedIds: state.resumedIds,
  released: state.released, pending: Boolean(state.release) } : { enabled: false };
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
          configurations: 0, closeRequests: 0, released: false, release: null, socket: null, resumedIds: [], conversationId: null };
      } else if (url.pathname === '/lifecycle/release') {
        if (!current?.release) return new Response(null, { status: 409 });
        current.released = true; current.release(); current.release = null;
      } else if (url.pathname === '/lifecycle/emit') {
        if (!current?.socket || body.command !== 'close_abnormal') return new Response(null, { status: 400 });
        current.socket.close(4001, 'Synthetic provider failure');
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
        if (['startup_audio', 'startup_tool'].includes(state.mode)) return;
        if (state.mode === 'startup_order') {
          emit({ type: 'session.created', session: { id: 'lifecycle_provider', model: 'grok-voice-3.0' } });
          emit({ type: 'conversation.created', event_id: 'startup_conversation', conversation: { id: conversationId } });
          emit({ type: 'conversation.created', conversation: { id: conversationId } });
        }
        if (state.mode === 'startup_ping') emit({ type: 'ping', private: 'ignored heartbeat payload' });
        emit({ type: 'session.updated', session: state.mode === 'startup_partial_ack'
          ? { model: item.session.model, instructions: item.session.instructions } : item.session });
        if (state.mode === 'startup_ping') emit({ type: 'ping' });
      }
      else if (item.type === 'input_audio_buffer.append') state.appends++;
      else if (item.type === 'input_audio_buffer.commit') {
        emit({ type: 'input_audio_buffer.committed', item_id: 'lifecycle_utterance' });
        emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'lifecycle_utterance', transcript: 'Ein Katzenvideo bitte.' });
      } else if (item.type === 'response.create') {
        state.responses++;
        emit({ type: 'response.created', response: { id: 'lifecycle_answer' } });
        emit({ type: 'response.output_item.added', response_id: 'lifecycle_answer', item: { id: 'lifecycle_answer_item', type: 'message' } });
        emit({ type: 'response.output_audio.delta', response_id: 'lifecycle_answer', item_id: 'lifecycle_answer_item', delta: btoa('\0'.repeat(4800)) });
        emit({ type: 'response.output_audio_transcript.delta', response_id: 'lifecycle_answer', item_id: 'lifecycle_answer_item', delta: 'Welche Dauer möchtest du?' });
        if (state.mode !== 'partial') emit({ type: 'response.done', response: { id: 'lifecycle_answer', status: 'completed' } });
        else emit({ type: 'input_audio_buffer.timeout_triggered' }); // Observable ordering barrier after the partial transcript.
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
      else if (['startup_ping', 'startup_partial_ack'].includes(state.mode)) emit({ type: 'ping' });
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
