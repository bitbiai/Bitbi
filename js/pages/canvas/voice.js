import { canvasVoiceOpusSupport } from './voice-opus.js?v=__ASSET_VERSION__';
import { canvasRequest } from './api.js?v=__ASSET_VERSION__';
import { createCanvasVoiceAudio } from './voice-audio.js?v=__ASSET_VERSION__';
import { createCanvasVoiceSettings } from './voice-settings.js?v=__ASSET_VERSION__';
const create = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (text, action) => { const node = create('button', 'canvas-button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
const randomId = () => crypto.randomUUID().replaceAll('-', '');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function sameSettings(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left); return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameSettings(left[key], right[key]));
}
const liveStates = new Set(['permission', 'connecting', 'listening', 'processing', 'speaking', 'muted']);
const safeState = new Set([...liveStates, 'ready', 'disconnected', 'error']);
// Voice is a transport into the existing server conversation. Interim audio
// transcripts here never become messages or creative changes on their own.
export function createCanvasVoice({ root, german = false, onChanged = () => {}, getSnapshot = () => null }) {
    const t = (de, en) => german ? de : en;
    const stateText = { ready: t('Bereit', 'Ready'), permission: t('Mikrofonberechtigung erforderlich', 'Microphone permission required'), connecting: t('Verbindet …', 'Connecting…'), listening: t('Hört zu', 'Listening'), processing: t('Verarbeitet …', 'Processing…'), speaking: t('Spricht', 'Speaking'), muted: t('Mikrofon stumm', 'Microphone muted'), disconnected: t('Getrennt', 'Disconnected'), error: t('Voice nicht verfügbar', 'Voice unavailable') };
    const reasons = { canvas_voice_provider_unavailable: t('Der Voice-Zugang ist noch nicht eingerichtet.', 'Voice provider access is not configured.'), canvas_voice_contract_unverified: t('Die freigegebene Voice-Verbindung ist noch nicht verifiziert.', 'The approved Voice connection has not yet been verified.'), canvas_voice_browser_unsupported: t('Dieser Browser unterstützt die benötigte AudioWorklet-Aufnahme nicht.', 'This browser does not support the required AudioWorklet capture.'), NotAllowedError: t('Mikrofonzugriff wurde nicht erlaubt.', 'Microphone access was not allowed.'), NotFoundError: t('Kein Mikrofon gefunden.', 'No microphone found.'), NotReadableError: t('Das Mikrofon ist belegt oder nicht zugänglich.', 'The microphone is busy or unavailable.') };
    Object.assign(reasons, {
        canvas_voice_opus_unavailable: t('Dieser Browser kann Opus-Audio nicht vollständig aufnehmen und wiedergeben. Wählen Sie in den Voice-Einstellungen einen verfügbaren Codec.', 'This browser cannot fully capture and play Opus audio. Choose an available codec in Voice settings.'),
        canvas_voice_disabled: t('Voice ist derzeit nicht aktiviert. Text und Canvas bleiben verfügbar.', 'Voice is not currently enabled. Text and Canvas remain available.'),
        canvas_agent_conversation_allowance_required: t('Das freigegebene Gesprächslimit reicht für diese Sitzung nicht aus. Wählen Sie eine kürzere Dauer oder geben Sie im Gespräch ausdrücklich ein passendes Limit frei.', 'The approved conversation allowance is insufficient for this session. Choose a shorter duration or explicitly authorize a suitable allowance in the conversation.'),
        canvas_voice_quote_expired: t('Die Kostenfreigabe ist abgelaufen. Bitte prüfen Sie die Kosten erneut.', 'The cost quote expired. Review the cost again.'),
        canvas_voice_quote_changed: t('Der Tarif oder die Einstellungen haben sich geändert. Bitte prüfen Sie die Kosten erneut.', 'The tariff or settings changed. Review the cost again.'),
        canvas_voice_settings_changed: t('Die Voice-Einstellungen wurden geändert. Bitte prüfen Sie die Kosten erneut.', 'Voice settings changed. Review the cost again.'),
        canvas_voice_provider_error: t('Der Sprachanbieter hat einen Fehler gemeldet. Die Sitzung ist beendet; Text und Canvas bleiben verfügbar.', 'The voice provider reported an error. The session has ended; text and Canvas remain available.'),
        canvas_voice_configuration_unconfirmed: t('Der Anbieter hat die freigegebenen Voice-Einstellungen nicht bestätigt. Die Sitzung wurde beendet.', 'The provider did not confirm the approved Voice settings. The session was ended.'),
        canvas_voice_context_changed: t('Der Gesprächsstand wurde geändert. Voice wurde beendet; prüfen Sie den aktuellen Stand vor einem neuen Start. Ihre gespeicherten Beiträge bleiben erhalten.', 'The conversation changed. Voice was ended; review the current state before starting again. Your saved messages are retained.'),
        canvas_voice_authority_changed: t('Die Berechtigung oder der Projektstand hat sich geändert. Voice wurde beendet; prüfen Sie den aktuellen Stand vor einem neuen Start.', 'Authorization or project state changed. Voice was ended; review the current state before starting again.'),
        canvas_voice_session_settings_mismatch: t('Die bestätigten Sitzungseinstellungen stimmen nicht mit Ihrer Freigabe überein. Es wurde keine Voice-Verbindung geöffnet.', 'The admitted session settings do not match your approval. No Voice connection was opened.'),
        canvas_voice_settings_stale: t('Die Voice-Einstellungen wurden geändert. Bitte prüfen Sie die Kosten erneut, bevor Sie starten.', 'Voice settings changed. Review the cost again before starting.'),
        canvas_voice_protocol_failed: t('Die Voice-Verbindung konnte nicht sicher verarbeitet werden und wurde beendet. Text und Canvas bleiben verfügbar.', 'The Voice connection could not be processed safely and was ended. Text and Canvas remain available.'),
    });
    let projectId = null, epoch = 0, state = 'ready', visible = true, config = null, audio = null, socket = null, session = null, controller = null;
    let requestId = null, muted = false, sequence = 0, lastResponse = null, lastItem = null, pendingQuote = null, timer = null, destroyed = false, finishing = false, manualPending = false, maximumDuration = 0;
    const interrupted = new Set(), seen = new Set(), section = create('section', 'canvas-voice'), row = create('div', 'canvas-voice__row');
    const toggle = button(t('Voice Assistent', 'Voice assistant'), () => liveStates.has(state) ? stop() : void prepare()); toggle.dataset.canvasVoice = 'toggle';
    const settingsButton = button(t('Settings', 'Settings'), event => void settings.open(event.currentTarget)); settingsButton.dataset.canvasVoice = 'settings';
    const status = create('p', 'canvas-voice__status', stateText.ready); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const interim = create('p', 'canvas-voice__interim'); interim.setAttribute('aria-label', t('Noch nicht gespeicherte Live-Transkription', 'Unsaved live transcription'));
    const actions = create('div', 'canvas-voice__actions'), mute = button(t('Stummschalten', 'Mute'), () => { muted = !muted; audio?.mute(muted); send({ type: 'voice.mute', muted }); sync(); });
    const interrupt = button(t('Unterbrechen', 'Interrupt'), () => interruptSpeech(true)), finishTurn = button(t('Sprechen abschließen', 'Finish speaking'), () => void finishSpeaking());
    const end = button(t('Sitzung beenden', 'End session'), () => stop()); actions.append(mute, interrupt, finishTurn, end); actions.hidden = true;
    row.append(toggle, settingsButton); section.append(row, status, interim, actions); root.append(section);
    const settings = createCanvasVoiceSettings({ german, load: loadConfig, save: saveSettings, active: () => liveStates.has(state), stop });
    const approval = create('dialog', 'canvas-voice-dialog canvas-voice-approval'), title = create('h2', '', t('Voice-Sitzung starten', 'Start a Voice session'));
    title.id = `canvasVoiceApproval${randomId()}`; approval.setAttribute('aria-labelledby', title.id);
    const privacy = create('p', '', t('Ihre Stimme und der relevante Canvas-Kontext werden an xAI übertragen. Bitbi speichert den bestätigten Textverlauf, keine Audioaufnahme. Mit aktivierten Canvas-Werkzeugen können Sie das Briefing und Projekt per Sprache steuern. Ausgaben und bestätigungspflichtige Änderungen benötigen jeweils eine konkrete Freigabe. Voice beenden stoppt keine laufende Produktion.', 'Your voice and relevant Canvas context are sent to xAI. Bitbi retains the confirmed text conversation, not an audio recording. Enabled Canvas tools let you control the brief and project by voice. Spending and changes that require confirmation each need a specific approval. Ending Voice does not stop an ongoing production.'));
    const duration = create('input', 'canvas-input'); duration.type = 'number'; duration.min = '1'; duration.max = '1'; duration.step = '1'; duration.value = '300';
    const durationLabel = create('label', 'canvas-field'); durationLabel.append(create('span', '', t('Maximale Sitzungsdauer (Sekunden)', 'Maximum session duration (seconds)')), duration);
    const resumptionText = create('p', 'canvas-muted'); resumptionText.hidden = true;
    const quoteText = create('p', 'canvas-voice-dialog__status'); quoteText.setAttribute('role', 'status');
    const consent = create('input'); consent.type = 'checkbox'; const consentLabel = create('label', 'canvas-voice-consent'); consentLabel.append(consent, create('span', '', t('Ich erlaube diese Voice-Sitzung bis zum angezeigten Höchstbetrag aus meinem freigegebenen Gesprächslimit.', 'I authorize this Voice session up to the displayed maximum from my approved conversation allowance.')));
    const refresh = button(t('Kosten prüfen', 'Review cost'), () => void quote()), approve = button(t('Mikrofon freigeben und starten', 'Allow microphone and start'), () => void start()); approve.classList.add('canvas-button--primary');
    const cancel = button(t('Abbrechen', 'Cancel'), () => { closeApproval(); stop(); }); const approvalActions = create('footer', 'canvas-voice-dialog__footer'); approvalActions.append(cancel, refresh, approve);
    approval.append(title, privacy, durationLabel, quoteText, resumptionText, consentLabel, approvalActions); document.body.append(approval);
    duration.addEventListener('input', () => { pendingQuote = null; consent.checked = false; sync(); }); consent.addEventListener('change', sync);
    approval.addEventListener('cancel', event => { event.preventDefault(); closeApproval(); stop(); }); approval.addEventListener('keydown', event => event.stopPropagation());
    function path(id = projectId, suffix = '') { return `/projects/${encodeURIComponent(id)}/agent/voice${suffix}`; }
    function sync() {
        const active = liveStates.has(state); toggle.textContent = active ? t('Voice beenden', 'End Voice') : t('Voice Assistent', 'Voice assistant'); toggle.setAttribute('aria-pressed', String(active));
        toggle.disabled = !projectId || destroyed; settingsButton.disabled = !projectId || destroyed; actions.hidden = !active;
        mute.setAttribute('aria-pressed', String(muted)); mute.textContent = muted ? t('Mikrofon einschalten', 'Unmute') : t('Stummschalten', 'Mute');
        mute.disabled = !session; interrupt.disabled = !lastResponse; finishTurn.hidden = session?.settings?.turn_detection?.type !== null; finishTurn.disabled = finishing || manualPending || muted || !socket || socket.readyState !== WebSocket.OPEN;
        approve.disabled = !pendingQuote || !consent.checked; settings.refreshState();
    }
    function setState(next, detail = '') { if (!safeState.has(next)) return; if (next === 'listening' && !muted && audio?.playing()) next = 'speaking'; state = next; status.textContent = detail || stateText[next]; sync(); }
    function failure(error) { stop('error'); status.dataset.voiceError = /^[a-zA-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : error?.name || 'Error'; status.textContent = reasons[error?.code || error?.name] || t('Die Voice-Verbindung konnte nicht bestätigt werden. Sie können weiter tippen; ein neuer Start braucht eine neue Freigabe.', 'The Voice connection could not be confirmed. You can keep typing; a new session needs fresh approval.'); }
    async function browserConfig(value) {
        const loaded = structuredClone(value), supportsOpus = await canvasVoiceOpusSupport();
        if (!supportsOpus) for (const key of ['inputCodecs', 'outputCodecs']) if (Array.isArray(loaded.capabilities?.[key])) loaded.capabilities[key] = loaded.capabilities[key].filter(codec => codec !== 'audio/opus');
        return loaded;
    }
    async function loadConfig() {
        if (!projectId) return null; const current = epoch, id = projectId;
        const result = await canvasRequest(path(id), { timeoutMs: 15000 }); if (current !== epoch || id !== projectId || destroyed) return null;
        if (!result.ok) { status.textContent = reasons[result.code] || t('Voice-Einstellungen nicht verfügbar.', 'Voice settings are unavailable.'); return null; }
        const loaded = await browserConfig(result.data);
        if (current !== epoch || id !== projectId || destroyed) return null;
        config = loaded; return config;
    }
    async function saveSettings(value, revision) {
        const current = epoch, id = projectId, result = await canvasRequest(path(id, '/settings'), { method: 'POST', body: { settings: value, expectedRevision: revision }, idempotencyKey: randomId(), timeoutMs: 15000 });
        if (current !== epoch || id !== projectId || !result.ok) return null;
        const loaded = await browserConfig(result.data); if (current !== epoch || id !== projectId || destroyed) return null; config = loaded; return config;
    }
    async function prepare() {
        if (!projectId || liveStates.has(state) || approval.open) return;
        const current = epoch, loaded = await loadConfig(); if (current !== epoch || !loaded) return;
        if (!loaded.availability?.available) { setState('error', reasons[loaded.availability?.code || loaded.availability?.reason] || t('Voice ist für dieses Konto noch nicht freigegeben.', 'Voice has not been enabled for this account.')); return; }
        const limit = loaded.availability.maxDurationSeconds;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 7200) { failure({ code: 'canvas_voice_configuration_unconfirmed' }); return; }
        maximumDuration = limit; duration.max = String(limit); duration.value = String(Math.max(1, Math.min(limit, Number(duration.value) || 300)));
        consent.checked = false; pendingQuote = null; quoteText.textContent = ''; approval.showModal(); duration.focus(); sync(); await quote();
    }
    async function quote() {
        pendingQuote = null; consent.checked = false; resumptionText.hidden = true; resumptionText.textContent = ''; sync(); const seconds = Number(duration.value), snap = getSnapshot();
        if (!approval.open || !Number.isInteger(seconds) || seconds < 1 || seconds > maximumDuration || !snap) { quoteText.textContent = t('Bitte Dauer und aktuellen Projektstand prüfen.', 'Check duration and current project state.'); return; }
        const current = epoch, id = projectId, value = duration.value, proposed = freeze(structuredClone({ settings: config.settings, settingsRevision: config.revision, snapshot: snap })); refresh.disabled = true; quoteText.textContent = t('Kosten werden geprüft …', 'Checking cost…');
        const result = await canvasRequest(path(id, '/quote'), { method: 'POST', body: { maxDurationSeconds: seconds, settingsRevision: proposed.settingsRevision,
            expectedConversationRevision: proposed.snapshot.revision, expectedBriefRevision: proposed.snapshot.briefRevision, expectedProjectRevision: proposed.snapshot.projectRevision }, idempotencyKey: randomId(), timeoutMs: 15000 });
        refresh.disabled = false; if (current !== epoch || !approval.open || duration.value !== value) return;
        const checked = result.data?.quote, resume = checked?.resumption;
        const resumeValid = resume && typeof resume.enabled === 'boolean' && resume.enabled === proposed.settings.resumption.enabled
            && typeof resume.resuming === 'boolean' && (!resume.resuming || resume.enabled && new Date(resume.expiresAt).getTime() > Date.now())
            && (resume.resuming || resume.expiresAt === null);
        if (!result.ok || !resumeValid || !checked?.id || !Number.isSafeInteger(checked.capCredits) || checked.capCredits < 1
            || checked.settingsRevision !== proposed.settingsRevision || checked.maxDurationSeconds !== seconds
            || !Number.isSafeInteger(checked.maxBillableSeconds) || checked.maxBillableSeconds < 1 || checked.maxBillableSeconds > 14400
            || checked.unitSeconds !== 10 || !Number.isSafeInteger(checked.creditsPerBlock) || checked.creditsPerBlock < 1
            || !Number.isSafeInteger(checked.remainingConversationCredits) || checked.remainingConversationCredits < checked.capCredits
            || checked.billingMode !== (proposed.settings.turn_detection.type === null ? 'audio_in_plus_out' : 'session_elapsed')
            || !(new Date(checked.expiresAt).getTime() > Date.now())) { quoteText.textContent = reasons[result.code] || t('Keine bestätigte Kostenfreigabe verfügbar.', 'No confirmed cost authorization is available.'); return; }
        pendingQuote = freeze({ ...proposed, quote: structuredClone(checked) });
        if (resume.enabled) {
            resumptionText.hidden = false;
            resumptionText.textContent = t('Gesprächsfortsetzung ist aktiviert: xAI speichert Transkripte und Werkzeugergebnisse bis zu 30 Minuten nach Inaktivität. ', 'Conversation resumption is enabled: xAI retains transcripts and tool results until 30 minutes of inactivity. ')
                + (resume.resuming ? t(`Der vorherige Kontext wird fortgesetzt; verfügbar bis ${new Date(resume.expiresAt).toLocaleTimeString('de-DE')}. `, `The previous context will resume; available until ${new Date(resume.expiresAt).toLocaleTimeString('en-GB')}. `) : t('Diese Verbindung beginnt mit dem aktuellen Canvas-Kontext. ', 'This connection starts with the current Canvas context. '))
                + t('Dieser Start erfordert die untenstehende neue Kostenfreigabe. Keine automatische Wiederverbindung.', 'This start requires the fresh cost approval below. No automatic reconnection.');
        }
        const basis = checked.billingMode === 'session_elapsed'
            ? t(`Mit automatischem Sprecherwechsel zählt die gesamte Gesprächsdauer, auch Pausen: höchstens ${checked.maxBillableSeconds} Sekunden.`, `With automatic turn detection, the entire conversation duration counts, including pauses: up to ${checked.maxBillableSeconds} seconds.`)
            : t(`Im manuellen Modus zählt die übertragene und empfangene Audiozeit zusammen: höchstens ${checked.maxBillableSeconds} Audiosekunden bei ${checked.maxDurationSeconds} Sekunden Sitzungsdauer.`, `In manual mode, transmitted and received audio time count together: up to ${checked.maxBillableSeconds} audio seconds within ${checked.maxDurationSeconds} seconds of session duration.`);
        quoteText.textContent = t(`Höchstens ${checked.capCredits} Credits aus Ihrem freigegebenen Gesprächslimit (${checked.remainingConversationCredits} Credits verfügbar). ${checked.creditsPerBlock} Credits je angefangene ${checked.unitSeconds} Sekunden. `, `Up to ${checked.capCredits} credits from your approved conversation allowance (${checked.remainingConversationCredits} credits available). ${checked.creditsPerBlock} credits per started ${checked.unitSeconds} seconds. `)
            + basis + t(' Der Höchstbetrag wird reserviert; die tatsächlichen Kosten werden einmalig zum Sitzungsende abgerechnet. Produktionsbudget und Textmodell bleiben unverändert.', ' The maximum is reserved; actual costs are charged once at session end. Production budget and text model remain unchanged.'); sync();
    }
    function closeApproval() { if (approval.open) approval.close(); pendingQuote = null; consent.checked = false; if (toggle.isConnected && visible) toggle.focus({ preventScroll: true }); }
    async function start() {
        if (!pendingQuote || !consent.checked || liveStates.has(state)) return;
        if (!(new Date(pendingQuote.quote.expiresAt).getTime() > Date.now()) || pendingQuote.quote.resumption.resuming && !(new Date(pendingQuote.quote.resumption.expiresAt).getTime() > Date.now())) { pendingQuote = null; consent.checked = false; quoteText.textContent = reasons.canvas_voice_quote_expired; sync(); return; }
        const admitted = pendingQuote, quoteValue = admitted.quote, snap = admitted.snapshot, id = projectId, current = ++epoch; requestId = randomId(); const localId = requestId;
        closeApproval(); setState('permission'); controller = new AbortController(); muted = false; sequence = 0; seen.clear(); interrupted.clear();
        audio = createCanvasVoiceAudio({ settings: admitted.settings, onAudio: bytes => send({ type: 'audio.append', audio: bytes }), onError: failure,
            onState: next => { if (epoch === current) setState(next); },
            onPlaybackComplete: played => {
                if (epoch === current && send({ type: 'voice.playback', ...played }) && lastResponse === played.responseId) {
                    lastResponse = lastItem = null; sync();
                }
            } });
        const localAudio = audio;
        try {
            await localAudio.open(); if (epoch !== current || localAudio.stopped()) return;
            const result = await canvasRequest(path(id, '/sessions'), { method: 'POST', body: { requestId: localId, quoteId: quoteValue.id, capCredits: quoteValue.capCredits,
                maxDurationSeconds: quoteValue.maxDurationSeconds, settingsRevision: admitted.settingsRevision, consent: true,
                expectedConversationRevision: snap.revision, expectedBriefRevision: snap.briefRevision, expectedProjectRevision: snap.projectRevision }, idempotencyKey: localId, signal: controller.signal, timeoutMs: 15000 });
            if (epoch !== current) return;
            if (!result.ok || !result.data?.session) throw Object.assign(new Error('session'), { code: result.code });
            session = result.data.session;
            if (session.id !== localId || !session.socketPath || session.settings?.model !== 'grok-voice-3.0') throw Object.assign(new Error('session_identity'), { code: 'canvas_voice_session_identity_invalid' });
            if (!sameSettings(session.settings, admitted.settings)) throw Object.assign(new Error('session_settings'), { code: 'canvas_voice_session_settings_mismatch' });
            const target = new URL(session.socketPath, location.origin), expected = `/api/account/canvas${path(id, `/sessions/${encodeURIComponent(session.id)}/socket`)}`;
            if (target.origin !== location.origin || target.pathname !== expected) throw Object.assign(new Error('socket_origin'), { code: 'canvas_voice_socket_origin_invalid' });
            target.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; socket = new WebSocket(target); socket.binaryType = 'arraybuffer';
            socket.onmessage = event => { if (epoch === current) receive(event); };
            socket.onerror = () => { if (epoch === current) failure({ code: 'canvas_voice_connection_failed' }); };
            socket.onclose = () => { if (epoch === current) stop('disconnected'); };
            socket.onopen = () => { if (epoch !== current) return; setState('connecting'); };
            timer = setTimeout(() => { if (epoch === current) stop('disconnected'); }, (quoteValue.maxDurationSeconds + 10) * 1000); sync();
        } catch (error) { if (epoch === current) failure(error); else localAudio.stop(); }
    }
    function send(message) {
        if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 512000) return false;
        socket.send(JSON.stringify({ ...message, sequence: sequence++ })); return true;
    }
    async function finishSpeaking() {
        if (finishing || manualPending || !audio || !session || session.settings.turn_detection.type !== null) return;
        const current = epoch, localAudio = audio; finishing = true; sync();
        try { await localAudio.finishTurn(); if (epoch === current) { if (!send({ type: 'audio.commit' })) throw Object.assign(new Error('commit_transport'), { code: 'canvas_voice_connection_failed' }); manualPending = true; setState('processing'); } }
        catch (error) { if (epoch === current) failure(error); }
        finally { if (epoch === current) { localAudio.continueCapture(); finishing = false; sync(); } }
    }
    function interruptSpeech(notify) {
        const heard = audio?.interrupt(); interim.textContent = ''; if (lastResponse) interrupted.add(lastResponse);
        if (notify && lastResponse) send({ type: 'voice.interrupt', responseId: heard?.responseId || lastResponse, itemId: heard?.itemId || lastItem, audioEndMs: heard?.audioEndMs || 0 });
        lastResponse = lastItem = null; if (liveStates.has(state)) setState(muted ? 'muted' : 'listening');
    }
    function receive(raw) {
        let event; try { if (typeof raw.data !== 'string' || raw.data.length > 300000) throw new Error('payload'); event = JSON.parse(raw.data); } catch { failure({ code: 'canvas_voice_response_invalid' }); return; }
        const identity = event.event_id || event.eventId; if (identity && seen.has(identity)) return;
        if (identity) { seen.add(identity); if (seen.size > 2048) seen.delete(seen.values().next().value); }
        if (event.type === 'voice.interrupted') { if (event.responseId) interrupted.add(event.responseId); interruptSpeech(false); return; }
        if (event.type === 'voice.ended') {
            if (event.code === 'canvas_voice_stopped') stop('ready');
            else if (event.code === 'canvas_voice_session_limit') { stop('disconnected'); status.textContent = t('Die freigegebene Sitzungsdauer ist erreicht. Für eine neue Sitzung ist eine neue Freigabe erforderlich.', 'The approved session duration has been reached. A new session requires fresh approval.'); }
            else if (event.code === 'canvas_voice_disconnected') stop('disconnected');
            else failure({ code: Object.hasOwn(reasons, event.code) ? event.code : 'canvas_voice_protocol_failed' });
            return;
        }
        if (event.type === 'voice.transcript') { interim.textContent = typeof event.text === 'string' ? event.text.slice(0, 6000) : ''; return; }
        if (event.type === 'voice.response_done') { audio?.responseDone(event); return; }
        if (event.type === 'voice.speech_started') { lastResponse ||= event.responseId; lastItem ||= event.itemId; interruptSpeech(true); return; }
        if (event.type === 'voice.turn') { if (event.state === 'ready' || event.state === 'pending') { manualPending = event.state === 'pending'; sync(); } return; }
        if (event.type === 'voice.changed') { interim.textContent = ''; onChanged(); return; }
        if (event.type === 'voice.state') { if (event.state === 'listening') audio?.ready(); setState(muted && event.state === 'listening' ? 'muted' : event.state); return; }
        if (event.type === 'session.updated') { audio?.ready(); setState(muted ? 'muted' : 'listening'); return; }
        if (event.type === 'input_audio_buffer.speech_started') { interruptSpeech(true); return; }
        if (event.type === 'input_audio_buffer.speech_stopped' || event.type === 'input_audio_buffer.timeout_triggered') { setState('processing'); return; }
        if (event.type === 'response.created') { lastResponse = event.response?.id || event.response_id; setState('processing'); return; }
        if (['voice.audio', 'response.output_audio.delta', 'response.audio.delta'].includes(event.type)) { if (interrupted.has(event.responseId || event.response_id)) return; lastResponse = event.responseId || event.response_id || lastResponse; lastItem = event.itemId || event.item_id || lastItem; audio?.play(event); return; }
        if (event.type === 'conversation.item.input_audio_transcription.updated' || event.type === 'conversation.item.input_audio_transcription.completed') { interim.textContent = typeof event.transcript === 'string' ? event.transcript.slice(0, 6000) : ''; return; }
        if (event.type === 'error' || event.type === 'voice.error') failure({ code: event.code || event.error?.code });
    }
    function stop(next = 'ready') {
        const id = projectId, operation = requestId; epoch++; controller?.abort(); controller = null; clearTimeout(timer); timer = null;
        audio?.stop(); audio = null;
        if (socket) { send({ type: 'voice.stop' }); const old = socket; socket = null; old.onopen = old.onmessage = old.onerror = old.onclose = null; old.close(); }
        session = null; requestId = null; lastResponse = lastItem = null; interim.textContent = ''; muted = false; finishing = false; manualPending = false;
        if (id && operation) void canvasRequest(path(id, `/sessions/${encodeURIComponent(operation)}/stop`), { method: 'POST', body: {}, idempotencyKey: operation, timeoutMs: 15000 }).then(result => { if ((!result.ok || result.data?.stopped !== true) && next !== 'error' && id === projectId && !requestId) status.textContent = t('Aufnahme beendet. Die serverseitige Beendigung ist noch nicht bestätigt.', 'Recording stopped. Server-side termination has not yet been confirmed.'); });
        setState(next); return true;
    }
    const pagehide = () => stop('disconnected'), visibility = () => { if (document.hidden) stop('disconnected'); else if (liveStates.has(state)) void audio?.resume().catch(failure); };
    window.addEventListener('pagehide', pagehide); document.addEventListener('visibilitychange', visibility);
    sync(); return { element: section, stop,
        suspend() { stop('disconnected'); closeApproval(); settings.close(); },
        projectChanged(value) { const next = typeof value === 'object' ? value?.id : value; if (next === projectId) return; stop(); settings.close(); closeApproval(); projectId = next || null; config = null; sync(); },
        setVisible(value) { visible = Boolean(value); section.hidden = !visible; if (!visible) { stop(); closeApproval(); settings.close(); } },
        destroy() { if (destroyed) return; stop(); destroyed = true; settings.destroy(); approval.remove(); section.remove(); window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', visibility); },
    };
}
