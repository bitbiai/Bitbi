import { ELEVENLABS_MUSIC_V2_OUTPUT_FORMATS, getElevenLabsMusicV2OutputFormatInfo } from './elevenlabs-music-v2-pricing.mjs?v=__ASSET_VERSION__';

// Same member editor in Generate Lab and Canvas. The structured editor is JSON
// so all validated chunk/range/conditioning options remain available losslessly.
export function createMemberMusicControls({ config = {}, german = false, onChange }) {
    const root = document.createElement('div'); root.className = 'member-music-controls';
    let value = { ...config };
    const fields = new Map();
    function add(key, label, tag = 'input', options = null) {
        const wrap = document.createElement('label'), caption = document.createElement('span'), input = document.createElement(tag);
        wrap.className = 'canvas-field generate-lab__field'; caption.textContent = label;
        input.className = tag === 'textarea' ? 'canvas-textarea generate-lab__textarea' : 'canvas-input generate-lab__input';
        input.dataset.musicOption = key;
        if (options) for (const [v, text] of options) { const option = document.createElement('option'); option.value = v; option.textContent = text; input.append(option); }
        input.value = value[key] ?? '';
        wrap.append(caption, input); root.append(wrap); fields.set(key, { wrap, input });
        input.addEventListener('input', () => {
            const next = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.value === '' ? undefined : Number(input.value) : input.value;
            value = { ...value, [key]: next }; sync();
            const saved = { ...value };
            if (Object.hasOwn(saved, 'compositionPlanText')) {
                try { saved.compositionPlan = JSON.parse(saved.compositionPlanText); delete saved.compositionPlanText; }
                catch { delete saved.compositionPlan; }
            }
            onChange(saved);
        });
        return input;
    }
    value.inputMode ||= 'prompt'; value.outputFormat ||= 'auto';
    add('inputMode', german ? 'Musik-Eingabe' : 'Music input', 'select', [['prompt', 'Prompt'], ['composition_plan', german ? 'Kompositionsplan' : 'Composition plan']]);
    const plan = add('compositionPlanText', german ? 'Kompositionsplan (JSON)' : 'Composition plan (JSON)', 'textarea');
    plan.rows = 8; plan.spellcheck = false; plan.value = value.compositionPlanText ?? (value.compositionPlan ? JSON.stringify(value.compositionPlan, null, 2) : '');
    plan.placeholder = '{"chunks":[{"text":"Soft piano","duration_ms":30000,"positive_styles":["ambient"]}]}';
    const duration = add('musicLengthMs', german ? 'Dauer in ms (leer = 30000)' : 'Duration in ms (empty = 30000)');
    duration.type = 'number'; duration.min = '3000'; duration.max = '600000'; duration.step = '1';
    add('outputFormat', german ? 'Audioformat' : 'Audio format', 'select', ELEVENLABS_MUSIC_V2_OUTPUT_FORMATS.map(id => [id, id === 'auto' ? (german ? 'Automatisch' : 'Automatic') : getElevenLabsMusicV2OutputFormatInfo(id).label]));
    const seed = add('seed', german ? 'Seed (optional)' : 'Seed (optional)'); seed.type = 'number'; seed.min = '0'; seed.max = '4294967295'; seed.step = '1';
    for (const [key, label] of [['forceInstrumental', german ? 'Instrumental erzwingen' : 'Force instrumental'], ['storeForInpainting', german ? 'Beim Anbieter für Inpainting speichern' : 'Store at provider for inpainting'], ['signWithC2pa', german ? 'Mit C2PA signieren (MP3)' : 'Sign with C2PA (MP3)']]) {
        const input = add(key, label); input.type = 'checkbox'; input.checked = value[key] === true;
        input.className = 'canvas-input'; input.style.inlineSize = '20px'; input.style.blockSize = '20px';
    }
    const help = document.createElement('p'); help.className = 'canvas-muted';
    help.textContent = german ? 'Plan: 3–600 Sekunden, maximal 30 Abschnitte und 256 KiB. Anbieter-Inpainting ist nicht das Speichern in BITBI Assets. Ohne gemeldete Ausgabedauer gilt der bestätigte Preis; dies ist keine tatsächliche Nutzungsmessung.' : 'Plan: 3–600 seconds, up to 30 chunks and 256 KiB. Provider inpainting storage is not BITBI Assets saving. If output duration is not reported, the accepted quote is final; it is not measured usage.';
    root.append(help);
    function sync() {
        const planned = value.inputMode === 'composition_plan';
        fields.get('compositionPlanText').wrap.hidden = !planned;
        for (const key of ['musicLengthMs', 'forceInstrumental']) fields.get(key).wrap.hidden = planned;
        const c2pa = fields.get('signWithC2pa').input;
        c2pa.disabled = value.outputFormat?.startsWith('opus_') === true;
        if (c2pa.disabled) { c2pa.checked = false; value.signWithC2pa = false; }
    }
    sync(); return root;
}
