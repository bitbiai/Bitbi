// Public presentation contract. System instructions, credentials, target URLs and
// tool schemas are assembled by the server; these preferences grant no authority.
export const CANVAS_VOICE_SETTINGS_VERSION = 1;
export const CANVAS_VOICE_MODEL = 'grok-voice-3.0';
export const CANVAS_VOICE_PCM_RATES = Object.freeze([8000, 16000, 22050, 24000, 32000, 44100, 48000]);
export const CANVAS_VOICE_CODECS = Object.freeze(['audio/pcm', 'audio/pcmu', 'audio/pcma', 'audio/opus']);
export const CANVAS_VOICE_LANGUAGES = Object.freeze(['auto', 'en', 'de', 'ar-EG', 'ar-SA', 'ar-AE', 'bn', 'zh', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'pt-PT', 'ru', 'es-MX', 'es-ES', 'tr', 'vi']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function invalid(path, reason = 'invalid') {
    throw Object.assign(new TypeError('canvas_voice_settings_invalid'), { code: 'canvas_voice_settings_invalid', status: 400, path, reason });
}
function object(value, keys, path) {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, 'object_required');
    for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`${path}.${key}`, 'unknown_field');
    return value;
}
function one(value, values, fallback, path) {
    if (value === undefined) return fallback;
    if (!values.includes(value)) invalid(path, 'unsupported_value');
    return value;
}
function bool(value, fallback, path) { return one(value, [true, false], fallback, path); }
function string(value, fallback, max, path) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) invalid(path, 'string_invalid');
    return value.trim();
}
function number(value, fallback, min, max, path, integer = false) {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(path, 'number_out_of_range');
    return value;
}
function list(value, fallback, maxItems, maxLength, path, pattern) {
    if (value === undefined) return [...fallback];
    if (!Array.isArray(value) || value.length > maxItems) invalid(path, 'list_invalid');
    const result = value.map((entry, i) => {
        const text = string(entry, '', maxLength, `${path}.${i}`);
        if (!text || (pattern && !pattern.test(text))) invalid(`${path}.${i}`, 'entry_invalid');
        return text;
    });
    if (new Set(result).size !== result.length) invalid(path, 'duplicate_entry');
    return result;
}
function format(value, path) {
    const data = object(value, ['type', 'rate'], path);
    const type = one(data.type, CANVAS_VOICE_CODECS, 'audio/pcm', `${path}.type`);
    const rates = type === 'audio/pcm' ? CANVAS_VOICE_PCM_RATES : [type === 'audio/opus' ? 24000 : 8000];
    return { type, rate: one(data.rate, rates, type === 'audio/pcm' ? 24000 : rates[0], `${path}.rate`) };
}
function audio(value) {
    const data = object(value, ['input', 'output'], 'audio');
    const input = object(data.input, ['format', 'transport', 'transcription'], 'audio.input');
    const transcription = object(input.transcription, ['model', 'language_hint', 'keyterms'], 'audio.input.transcription');
    const output = object(data.output, ['format', 'transport', 'speed'], 'audio.output');
    return {
        input: { format: format(input.format, 'audio.input.format'), transport: one(input.transport, ['json', 'binary'], 'json', 'audio.input.transport'),
            transcription: { model: one(transcription.model, ['grok-transcribe'], 'grok-transcribe', 'audio.input.transcription.model'),
                language_hint: one(transcription.language_hint, CANVAS_VOICE_LANGUAGES, 'auto', 'audio.input.transcription.language_hint'),
                keyterms: list(transcription.keyterms, [], 100, 50, 'audio.input.transcription.keyterms') } },
        output: { format: format(output.format, 'audio.output.format'), transport: one(output.transport, ['json', 'binary'], 'json', 'audio.output.transport'),
            speed: number(output.speed, 1, .7, 1.5, 'audio.output.speed') },
    };
}
const RESOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
function resourceIds(value, path) { return list(value, [], 20, 80, path, RESOURCE_ID); }
function domains(value, path) {
    return list(value, [], 5, 253, path, /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i).map(v => v.toLowerCase());
}
function date(value, path) {
    const result = string(value, '', 10, path);
    if (result) {
        const parsed = new Date(`${result}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalid(path, 'date_invalid');
    }
    return result;
}
function tools(value) {
    const data = object(value, ['canvas', 'web_search', 'x_search', 'file_search', 'mcp'], 'tools');
    const canvas = object(data.canvas, ['enabled'], 'tools.canvas');
    const web = object(data.web_search, ['enabled', 'allowed_domains', 'excluded_domains', 'location', 'enable_image_understanding'], 'tools.web_search');
    const location = object(web.location, ['country', 'city', 'region', 'timezone'], 'tools.web_search.location');
    const x = object(data.x_search, ['enabled', 'allowed_x_handles', 'excluded_x_handles', 'from_date', 'to_date', 'enable_image_understanding', 'enable_video_understanding'], 'tools.x_search');
    const files = object(data.file_search, ['enabled', 'resourceIds', 'max_num_results'], 'tools.file_search');
    const mcp = object(data.mcp, ['enabled', 'servers'], 'tools.mcp');
    const webResult = { enabled: bool(web.enabled, false, 'tools.web_search.enabled'), allowed_domains: domains(web.allowed_domains, 'tools.web_search.allowed_domains'),
        excluded_domains: domains(web.excluded_domains, 'tools.web_search.excluded_domains'), enable_image_understanding: bool(web.enable_image_understanding, false, 'tools.web_search.enable_image_understanding'),
        location: Object.fromEntries(['country', 'city', 'region', 'timezone'].map(key => [key, string(location[key], '', 100, `tools.web_search.location.${key}`)])) };
    if (webResult.allowed_domains.length && webResult.excluded_domains.length) invalid('tools.web_search', 'mutually_exclusive_filters');
    if (new Set(webResult.allowed_domains).size !== webResult.allowed_domains.length || new Set(webResult.excluded_domains).size !== webResult.excluded_domains.length) invalid('tools.web_search', 'duplicate_entry');
    if (webResult.location.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: webResult.location.timezone }); } catch { invalid('tools.web_search.location.timezone', 'timezone_invalid'); } }
    const xResult = { enabled: bool(x.enabled, false, 'tools.x_search.enabled'), allowed_x_handles: list(x.allowed_x_handles, [], 20, 15, 'tools.x_search.allowed_x_handles', /^[a-zA-Z0-9_]+$/),
        excluded_x_handles: list(x.excluded_x_handles, [], 20, 15, 'tools.x_search.excluded_x_handles', /^[a-zA-Z0-9_]+$/), from_date: date(x.from_date, 'tools.x_search.from_date'),
        to_date: date(x.to_date, 'tools.x_search.to_date'), enable_image_understanding: bool(x.enable_image_understanding, false, 'tools.x_search.enable_image_understanding'),
        enable_video_understanding: bool(x.enable_video_understanding, false, 'tools.x_search.enable_video_understanding') };
    if (xResult.allowed_x_handles.length && xResult.excluded_x_handles.length) invalid('tools.x_search', 'mutually_exclusive_filters');
    if (xResult.from_date && xResult.to_date && xResult.from_date > xResult.to_date) invalid('tools.x_search', 'date_order');
    const servers = mcp.servers === undefined ? [] : mcp.servers;
    if (!Array.isArray(servers) || servers.length > 8) invalid('tools.mcp.servers', 'list_invalid');
    const parsedServers = servers.map((entry, i) => {
        const path = `tools.mcp.servers.${i}`, server = object(entry, ['resourceId', 'allowed_tools'], path);
        const resourceId = string(server.resourceId, '', 80, `${path}.resourceId`);
        if (!RESOURCE_ID.test(resourceId)) invalid(`${path}.resourceId`, 'resource_invalid');
        return { resourceId, allowed_tools: list(server.allowed_tools, [], 50, 100, `${path}.allowed_tools`, /^[a-zA-Z0-9_-]+$/) };
    });
    if (new Set(parsedServers.map(s => s.resourceId)).size !== parsedServers.length) invalid('tools.mcp.servers', 'duplicate_entry');
    return { canvas: { enabled: bool(canvas.enabled, false, 'tools.canvas.enabled') }, web_search: webResult, x_search: xResult,
        file_search: { enabled: bool(files.enabled, false, 'tools.file_search.enabled'), resourceIds: resourceIds(files.resourceIds, 'tools.file_search.resourceIds'),
            max_num_results: number(files.max_num_results, 10, 1, 100, 'tools.file_search.max_num_results', true) },
        mcp: { enabled: bool(mcp.enabled, false, 'tools.mcp.enabled'), servers: parsedServers } };
}
export function canvasVoiceSettings(input = {}) {
    const data = object(input, ['version', 'model', 'voice', 'preferences', 'reasoning', 'turn_detection', 'resumption', 'audio', 'replace', 'response', 'tools', 'browser'], 'settings');
    const prefs = object(data.preferences, ['language', 'tone', 'instructions'], 'preferences');
    const reasoning = object(data.reasoning, ['effort'], 'reasoning');
    const detection = object(data.turn_detection, ['type', 'idle_timeout_ms'], 'turn_detection');
    const resumption = object(data.resumption, ['enabled'], 'resumption');
    const response = object(data.response, ['modalities', 'instructions'], 'response');
    const browser = object(data.browser, ['echoCancellation', 'noiseSuppression', 'autoGainControl'], 'browser');
    const replace = data.replace === null || data.replace === undefined ? {} : data.replace;
    object(replace, Object.keys(replace || {}), 'replace');
    if (Object.keys(replace).length > 100) invalid('replace', 'too_many_entries');
    const replacements = Object.fromEntries(Object.entries(replace).map(([key, value]) => {
        if (!key || key.length > 100 || !/^[\p{L}\p{N}' ]+$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('replace', 'phrase_invalid');
        const replacement = string(value, '', 128, 'replace.value');
        if (!replacement) invalid('replace', 'replacement_empty');
        return [key, replacement];
    }));
    const detectionType = one(detection.type, ['server_vad', null], 'server_vad', 'turn_detection.type');
    const idle = detection.idle_timeout_ms == null ? null : number(detection.idle_timeout_ms, null, 1000, 300000, 'turn_detection.idle_timeout_ms', true);
    if (detectionType === null && idle !== null) invalid('turn_detection.idle_timeout_ms', 'requires_server_vad');
    const modalities = list(response.modalities, ['text', 'audio'], 2, 5, 'response.modalities');
    if (!modalities.length || modalities.some(v => !['text', 'audio'].includes(v))) invalid('response.modalities', 'unsupported_value');
    const voice = string(data.voice, 'eve', 100, 'voice');
    if (!/^[a-zA-Z0-9_-]+$/.test(voice)) invalid('voice', 'voice_invalid');
    return { version: one(data.version, [CANVAS_VOICE_SETTINGS_VERSION], CANVAS_VOICE_SETTINGS_VERSION, 'version'),
        model: one(data.model, [CANVAS_VOICE_MODEL], CANVAS_VOICE_MODEL, 'model'), voice,
        preferences: { language: one(prefs.language, CANVAS_VOICE_LANGUAGES, 'auto', 'preferences.language'),
            tone: string(prefs.tone, '', 300, 'preferences.tone'), instructions: string(prefs.instructions, '', 2000, 'preferences.instructions') },
        reasoning: { effort: one(reasoning.effort, ['high', 'none'], 'high', 'reasoning.effort') },
        turn_detection: { type: detectionType, idle_timeout_ms: idle }, resumption: { enabled: bool(resumption.enabled, false, 'resumption.enabled') },
        audio: audio(data.audio), replace: replacements, response: { modalities, instructions: string(response.instructions, '', 1000, 'response.instructions') },
        tools: tools(data.tools), browser: Object.fromEntries(['echoCancellation', 'noiseSuppression', 'autoGainControl'].map(key => [key, bool(browser[key], true, `browser.${key}`)])) };
}
function unavailable(path, reason) {
    throw Object.assign(new Error('canvas_voice_setting_unavailable'), { code: 'canvas_voice_setting_unavailable', status: 409, path, reason });
}
// Call only with trusted server capabilities. Never accept this object from JSON
// supplied by the browser. Validation and saving do not authorize a paid session.
export function assertCanvasVoiceSettingsCapabilities(input, capabilities = {}) {
    const settings = canvasVoiceSettings(input);
    if (!(capabilities.voiceIds || ['eve']).includes(settings.voice)) unavailable('voice', 'voice_not_authorized');
    for (const side of ['input', 'output']) {
        if (!(capabilities[`${side}Codecs`] || ['audio/pcm']).includes(settings.audio[side].format.type)) unavailable(`audio.${side}.format.type`, 'codec_unavailable');
    }
    if (settings.resumption.enabled && capabilities.resumption !== true) unavailable('resumption.enabled', 'resumption_not_authorized');
    for (const name of ['canvas', 'web_search', 'x_search', 'file_search', 'mcp']) {
        if (!settings.tools[name].enabled) continue;
        if (!capabilities.tools?.includes(name)) unavailable(`tools.${name}`, 'tool_not_authorized');
        if (name !== 'canvas' && capabilities.externalToolBudget !== true) unavailable(`tools.${name}`, 'tool_budget_unavailable');
    }
    if (settings.tools.file_search.enabled) {
        if (!settings.tools.file_search.resourceIds.length) unavailable('tools.file_search.resourceIds', 'resource_required');
        for (const id of settings.tools.file_search.resourceIds) if (!capabilities.collectionResourceIds?.includes(id)) unavailable('tools.file_search.resourceIds', 'resource_not_authorized');
    }
    if (settings.tools.mcp.enabled) {
        if (!settings.tools.mcp.servers.length) unavailable('tools.mcp.servers', 'resource_required');
        for (const server of settings.tools.mcp.servers) {
            const allowed = capabilities.mcpResources?.find(entry => entry.resourceId === server.resourceId);
            if (!allowed || !server.allowed_tools.length || server.allowed_tools.some(name => !allowed.allowed_tools?.includes(name))) unavailable('tools.mcp.servers', 'resource_or_tool_not_authorized');
        }
    }
    return settings;
}
export function canvasVoiceSettingsChange(previous, next) {
    const before = canvasVoiceSettings(previous), after = canvasVoiceSettings(next), paths = [];
    function walk(a, b, path = '') {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const name = path ? `${path}.${key}` : key;
            if (!own(a, key) || !own(b, key)) paths.push(name);
            else if (a[key] && b[key] && typeof a[key] === 'object' && typeof b[key] === 'object' && !Array.isArray(a[key]) && !Array.isArray(b[key])) walk(a[key], b[key], name);
            else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) paths.push(name);
        }
    }
    walk(before, after);
    // Conservative controlled restart prevents stale audio/tool context. API
    // support for some live updates does not make them locally active on Save.
    return { changed: paths, restartRequired: paths.length > 0 };
}

const field = (path, group, type, en, de, extra = {}) => Object.freeze({ path, group, type, label: Object.freeze({ en, de }), ...extra });
export const CANVAS_VOICE_SETTING_FIELDS = Object.freeze([
    field('model', 'voice', 'readonly', 'Voice model', 'Sprachmodell', { value: CANVAS_VOICE_MODEL }),
    field('voice', 'voice', 'voice', 'Voice', 'Stimme', { capability: 'voiceIds' }),
    field('preferences.language', 'voice', 'select', 'Conversation language', 'Gesprächssprache', { options: CANVAS_VOICE_LANGUAGES }),
    field('audio.input.transcription.model', 'voice', 'readonly', 'Streaming transcription', 'Live-Transkription', { value: 'grok-transcribe', liveProofRequired: true }),
    field('audio.input.transcription.language_hint', 'voice', 'select', 'Transcription language hint', 'Sprachhinweis zur Transkription', { options: CANVAS_VOICE_LANGUAGES }),
    field('audio.input.transcription.keyterms', 'voice', 'list', 'Key terms', 'Schlüsselbegriffe', { maxItems: 100, maxLength: 50 }),
    field('audio.output.speed', 'voice', 'number', 'Speech speed', 'Sprechgeschwindigkeit', { min: .7, max: 1.5, step: .1 }),
    field('replace', 'voice', 'map', 'Pronunciation replacements', 'Aussprache-Ersetzungen', { maxItems: 100 }),
    field('preferences.tone', 'behaviour', 'text', 'Tone preference', 'Gewünschter Tonfall', { maxLength: 300 }),
    field('preferences.instructions', 'behaviour', 'textarea', 'Additional communication preferences', 'Zusätzliche Gesprächswünsche', { maxLength: 2000 }),
    field('reasoning.effort', 'behaviour', 'select', 'Reasoning', 'Schlussfolgern', { options: ['high', 'none'] }),
    field('turn_detection.type', 'behaviour', 'select', 'Turn detection', 'Sprecherwechsel', { options: ['server_vad', null] }),
    field('turn_detection.idle_timeout_ms', 'behaviour', 'nullable-number', 'Proactive check-in after silence (ms)', 'Nachfragen nach Stille (ms)', { min: 1000, max: 300000, dependsOn: 'server_vad' }),
    field('resumption.enabled', 'behaviour', 'boolean', 'Provider conversation resumption', 'Gesprächsfortsetzung beim Anbieter', { capability: 'resumption' }),
    field('response.modalities', 'advanced', 'multiselect', 'Response output', 'Antwortausgabe', { options: ['text', 'audio'] }),
    field('response.instructions', 'advanced', 'textarea', 'Response communication preference', 'Gesprächswunsch für Antworten', { maxLength: 1000 }),
    ...['input', 'output'].flatMap(side => [
        field(`audio.${side}.format.type`, 'advanced', 'select', `${side === 'input' ? 'Input' : 'Output'} codec`, `${side === 'input' ? 'Eingangs' : 'Ausgangs'}-Codec`, { options: CANVAS_VOICE_CODECS, capability: `${side}Codecs` }),
        field(`audio.${side}.format.rate`, 'advanced', 'select', `${side === 'input' ? 'Input' : 'Output'} sample rate (Hz)`, `${side === 'input' ? 'Eingangs' : 'Ausgangs'}-Abtastrate (Hz)`, { options: CANVAS_VOICE_PCM_RATES, dependsOn: 'audio/pcm' }),
        field(`audio.${side}.transport`, 'advanced', 'select', `${side === 'input' ? 'Input' : 'Output'} transport`, `${side === 'input' ? 'Eingangs' : 'Ausgangs'}-Transport`, { options: ['json', 'binary'] }),
    ]),
    field('browser.echoCancellation', 'advanced', 'boolean', 'Echo cancellation', 'Echounterdrückung', { native: false }),
    field('browser.noiseSuppression', 'advanced', 'boolean', 'Noise suppression', 'Rauschunterdrückung', { native: false }),
    field('browser.autoGainControl', 'advanced', 'boolean', 'Automatic microphone gain', 'Automatische Mikrofonverstärkung', { native: false }),
    ...['canvas', 'web_search', 'x_search', 'file_search', 'mcp'].map(name => field(`tools.${name}.enabled`, 'tools', 'boolean', { canvas: 'Canvas project functions', web_search: 'Web search', x_search: 'X search', file_search: 'Approved collections', mcp: 'Approved MCP tools' }[name], { canvas: 'Canvas-Projektfunktionen', web_search: 'Websuche', x_search: 'X-Suche', file_search: 'Freigegebene Sammlungen', mcp: 'Freigegebene MCP-Werkzeuge' }[name], { capability: `tools.${name}` })),
    ...['allowed_domains', 'excluded_domains'].map(key => field(`tools.web_search.${key}`, 'tools', 'list', key === 'allowed_domains' ? 'Allowed domains' : 'Excluded domains', key === 'allowed_domains' ? 'Erlaubte Domains' : 'Ausgeschlossene Domains', { maxItems: 5 })),
    ...['country', 'city', 'region', 'timezone'].map(key => field(`tools.web_search.location.${key}`, 'tools', 'text', { country: 'Country', city: 'City', region: 'Region', timezone: 'Time zone' }[key], { country: 'Land', city: 'Stadt', region: 'Region', timezone: 'Zeitzone' }[key], { maxLength: 100 })),
    field('tools.web_search.enable_image_understanding', 'tools', 'boolean', 'Understand web images', 'Webbilder verstehen'),
    ...['allowed_x_handles', 'excluded_x_handles'].map(key => field(`tools.x_search.${key}`, 'tools', 'list', key === 'allowed_x_handles' ? 'Allowed X handles' : 'Excluded X handles', key === 'allowed_x_handles' ? 'Erlaubte X-Namen' : 'Ausgeschlossene X-Namen', { maxItems: 20 })),
    field('tools.x_search.from_date', 'tools', 'date', 'Posts from', 'Beiträge ab'),
    field('tools.x_search.to_date', 'tools', 'date', 'Posts until', 'Beiträge bis'),
    field('tools.x_search.enable_image_understanding', 'tools', 'boolean', 'Understand X images', 'X-Bilder verstehen'),
    field('tools.x_search.enable_video_understanding', 'tools', 'boolean', 'Understand X videos', 'X-Videos verstehen'),
    field('tools.file_search.resourceIds', 'tools', 'resources', 'Approved collections', 'Freigegebene Sammlungen', { capability: 'collectionResourceIds' }),
    field('tools.file_search.max_num_results', 'tools', 'number', 'Collection results', 'Sammlungsergebnisse', { min: 1, max: 100, step: 1 }),
    field('tools.mcp.servers', 'tools', 'mcp-resources', 'Approved servers and tools', 'Freigegebene Server und Werkzeuge', { capability: 'mcpResources' }),
]);
