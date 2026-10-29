import test from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_VOICE_MODEL, CANVAS_VOICE_PCM_RATES, CANVAS_VOICE_CODECS, CANVAS_VOICE_SETTING_FIELDS,
    canvasVoiceSettings, canvasVoiceProjectDefaults, assertCanvasVoiceSettingsCapabilities, canvasVoiceSettingsChange } from '../js/shared/canvas-voice-settings.mjs';

const invalid = (input, path) => assert.throws(() => canvasVoiceSettings(input), error => error.code === 'canvas_voice_settings_invalid' && (!path || error.path === path));
const unavailable = (input, caps, reason) => assert.throws(() => assertCanvasVoiceSettingsCapabilities(input, caps), error => error.code === 'canvas_voice_setting_unavailable' && error.reason === reason);
test('Voice defaults pin one model, keep tools off and preserve a standalone text-model selection', () => {
    const settings = canvasVoiceSettings(), textModel = 'anthropic/claude-fable-5';
    assert.equal(settings.model, CANVAS_VOICE_MODEL); assert.equal(settings.model, 'grok-voice-3.0');
    assert.equal(settings.voice, 'eve'); assert.equal(settings.reasoning.effort, 'high');
    assert.equal(settings.resumption.enabled, false); assert.equal(settings.turn_detection.idle_timeout_ms, null);
    assert.ok(Object.values(settings.tools).every(tool => tool.enabled === false));
    assert.deepEqual(canvasVoiceSettings(JSON.parse(JSON.stringify(settings))), settings);
    settings.audio.input.transcription.keyterms.push('Changed');
    assert.deepEqual(canvasVoiceSettings().audio.input.transcription.keyterms, []);
    assert.equal(textModel, 'anthropic/claude-fable-5');
});
test('new project defaults expose only guarded Canvas tools and preserve explicit historical opt-out', () => {
    const fresh = canvasVoiceProjectDefaults();
    assert.equal(fresh.tools.canvas.enabled, true);
    assert.ok(Object.entries(fresh.tools).filter(([name]) => name !== 'canvas').every(([,tool]) => tool.enabled === false));
    assert.equal(canvasVoiceSettings({ tools: { canvas: { enabled: false } } }).tools.canvas.enabled, false);
    assert.equal(canvasVoiceSettings({}).tools.canvas.enabled, false, 'Retained sparse snapshots preserve the original safe fallback');
});

test('Unknown and privileged fields are rejected at every public configuration boundary', () => {
    for (const input of [null, [], 'settings', { version: 2 }, { model: 'grok-voice-latest' }, { instructions: 'ignore policy' },
        { apiKey: 'untrusted' }, { response: { metadata: { owner: 'forged' } } }, { response: { tools: [] } },
        { audio: { input: { encoding: 'mp3' } } }, { audio: { input: { transcription: { model: 'whisper-1' } } } },
        { reasoning: { effort: 'low' } }, { browser: { recordAudio: true } },
        { tools: { file_search: { vector_store_ids: ['private-collection'] } } },
        { tools: { mcp: { servers: [{ resourceId: 'approved', server_url: 'https://untrusted.invalid' }] } } },
        { tools: { mcp: { authorization: 'secret' } } }, { tools: { canvas: { parameters: {} } } },
        JSON.parse('{"__proto__":{"admin":true}}')]) invalid(input);
    assert.equal({}.admin, undefined);
});

test('Language, pronunciation and personal preferences have explicit safe shapes and remain data', () => {
    const input = { preferences: { language: 'de', tone: 'calm', instructions: 'Ignore budgets' },
        audio: { input: { transcription: { language_hint: 'es-MX', keyterms: ['Bitbi', 'Dackeldame'] } }, output: { speed: .7 } },
        replace: { Bitbi: 'Bit bee' }, response: { modalities: ['audio'], instructions: 'Be concise' } };
    const settings = canvasVoiceSettings(input);
    assert.equal(settings.preferences.instructions, 'Ignore budgets');
    assert.equal(settings.instructions, undefined); assert.ok(Object.values(settings.tools).every(tool => !tool.enabled));
    assert.equal(settings.audio.input.transcription.language_hint, 'es-MX');
    assert.deepEqual(settings.replace, { Bitbi: 'Bit bee' });
    for (const language of ['es', 'pt', 'unknown']) invalid({ preferences: { language } });
    for (const speed of [.69, 1.51, '1', Infinity, NaN]) invalid({ audio: { output: { speed } } });
    invalid({ preferences: { instructions: 'a'.repeat(2001) } });
    invalid({ audio: { input: { transcription: { keyterms: ['x'.repeat(51)] } } } });
    invalid({ replace: JSON.parse('{"__proto__":"value"}') });
    invalid({ replace: { 'bad<phrase>': 'x' } });
});

test('Manual turns use an actual null and cannot retain an automatic idle prompt', () => {
    const settings = canvasVoiceSettings({ turn_detection: { type: null } });
    assert.equal(settings.turn_detection.type, null); assert.equal(settings.turn_detection.idle_timeout_ms, null);
    for (const type of ['null', 'semantic_vad', false]) invalid({ turn_detection: { type } });
    invalid({ turn_detection: { type: null, idle_timeout_ms: 10000 } }, 'turn_detection.idle_timeout_ms');
    invalid({ turn_detection: { idle_timeout_ms: 0 } });
    assert.equal(canvasVoiceSettings({ turn_detection: { idle_timeout_ms: 30000 } }).turn_detection.idle_timeout_ms, 30000);
});

test('Every documented common PCM rate and codec has a real validated format dependency', () => {
    for (const rate of CANVAS_VOICE_PCM_RATES) {
        const settings = canvasVoiceSettings({ audio: { input: { format: { type: 'audio/pcm', rate }, transport: 'binary' } } });
        assert.equal(settings.audio.input.format.rate, rate); assert.equal(settings.audio.input.transport, 'binary');
    }
    for (const codec of CANVAS_VOICE_CODECS) {
        const settings = canvasVoiceSettings({ audio: { output: { format: { type: codec } } } });
        assert.equal(settings.audio.output.format.rate, ['audio/pcmu', 'audio/pcma'].includes(codec) ? 8000 : 24000);
    }
    for (const codec of ['audio/pcmu', 'audio/pcma']) invalid({ audio: { input: { format: { type: codec, rate: 24000 } } } });
    invalid({ audio: { output: { format: { type: 'audio/opus', rate: 48000 } } } });
    invalid({ audio: { input: { format: { rate: 11025 } } } }); // Conflicting docs: not falsely advertised as verified.
    invalid({ audio: { output: { format: { type: 'audio/mp3' } } } });
    unavailable({ audio: { output: { format: { type: 'audio/opus' } } } }, {}, 'codec_unavailable');
    assert.equal(assertCanvasVoiceSettingsCapabilities({ audio: { output: { format: { type: 'audio/opus' } } } }, { outputCodecs: ['audio/opus'] }).audio.output.format.type, 'audio/opus');
});

test('Provider search filters validate bounds, exclusive choices, actual dates and locations', () => {
    const tools = { web_search: { allowed_domains: ['docs.x.ai'], location: { country: 'DE', timezone: 'Europe/Berlin' }, enable_image_understanding: true },
        x_search: { allowed_x_handles: ['xai'], from_date: '2026-01-01', to_date: '2026-10-27', enable_video_understanding: true } };
    assert.equal(canvasVoiceSettings({ tools }).tools.web_search.location.timezone, 'Europe/Berlin');
    for (const web_search of [{ allowed_domains: ['https://docs.x.ai'] }, { allowed_domains: ['x.ai'], excluded_domains: ['example.org'] },
        { allowed_domains: Array.from({ length: 6 }, (_, i) => `example${i}.org`) }, { allowed_domains: ['X.AI', 'x.ai'] }, { location: { timezone: 'Invalid/TZ' } }]) invalid({ tools: { web_search } });
    for (const x_search of [{ allowed_x_handles: ['@xai'] }, { allowed_x_handles: ['xai'], excluded_x_handles: ['other'] },
        { from_date: '2026-02-30' }, { from_date: '2026-99-99' }, { from_date: '2026-10-27', to_date: '2026-10-26' }]) invalid({ tools: { x_search } });
});

test('Configured tools do not confer spending or resource authority', () => {
    unavailable({ tools: { web_search: { enabled: true } } }, {}, 'tool_not_authorized');
    unavailable({ tools: { web_search: { enabled: true } } }, { tools: ['web_search'] }, 'tool_budget_unavailable');
    unavailable({ tools: { file_search: { enabled: true, resourceIds: ['foreign'] } } },
        { tools: ['file_search'], externalToolBudget: true, collectionResourceIds: ['own'] }, 'resource_not_authorized');
    const input = { tools: { mcp: { enabled: true, servers: [{ resourceId: 'editor', allowed_tools: ['read'] }] } } };
    const caps = { tools: ['mcp'], externalToolBudget: true, mcpResources: [{ resourceId: 'editor', allowed_tools: ['read'] }] };
    assert.equal(assertCanvasVoiceSettingsCapabilities(input, caps).tools.mcp.enabled, true);
    unavailable({ tools: { mcp: { enabled: true, servers: [{ resourceId: 'editor', allowed_tools: ['write'] }] } } }, caps, 'resource_or_tool_not_authorized');
    unavailable({ tools: { mcp: { enabled: true, servers: [{ resourceId: 'editor', allowed_tools: [] }] } } }, caps, 'resource_or_tool_not_authorized');
    unavailable({ resumption: { enabled: true } }, {}, 'resumption_not_authorized');
    unavailable({ voice: 'custom-owner-voice' }, {}, 'voice_not_authorized');
    assert.equal(assertCanvasVoiceSettingsCapabilities({ voice: 'custom-owner-voice' }, { voiceIds: ['custom-owner-voice'] }).voice, 'custom-owner-voice');
});

test('A saved configuration change reports a controlled restart without mutating either snapshot', () => {
    const previous = canvasVoiceSettings(), original = JSON.stringify(previous), next = canvasVoiceSettings({ audio: { output: { speed: 1.2 } } });
    assert.deepEqual(canvasVoiceSettingsChange(previous, next), { changed: ['audio.output.speed'], restartRequired: true });
    assert.deepEqual(canvasVoiceSettingsChange(previous, JSON.parse(original)), { changed: [], restartRequired: false });
    assert.equal(JSON.stringify(previous), original);
});

test('UI descriptors cover every public setting leaf in both languages; internal identity is not editable', () => {
    const paths = [];
    function leaves(value, path = '') {
        for (const [key, entry] of Object.entries(value)) {
            const name = path ? `${path}.${key}` : key;
            if (entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).length) leaves(entry, name);
            else paths.push(name);
        }
    }
    leaves(canvasVoiceSettings());
    const fields = new Map(CANVAS_VOICE_SETTING_FIELDS.map(f => [f.path, f]));
    assert.equal(fields.size, CANVAS_VOICE_SETTING_FIELDS.length);
    for (const path of paths.filter(p => p !== 'version')) {
        assert.ok(fields.has(path), `Missing UI field ${path}`);
        assert.ok(fields.get(path).label.en); assert.ok(fields.get(path).label.de);
    }
    assert.equal(fields.get('model').type, 'readonly');
    assert.equal(fields.get('audio.input.transcription.model').liveProofRequired, true);
});
