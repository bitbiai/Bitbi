import { SEEDANCE_25_RATIOS, SEEDANCE_25_RESOLUTIONS, seedance25Settings } from './seedance-25-contract.mjs?v=__ASSET_VERSION__';
import { createH3ReferenceControls } from './h3-reference-controls.js?v=__ASSET_VERSION__';

// One control implementation, embedded in each existing workspace. State is
// owned by its existing form/project; no parallel draft or persistence service.
export function createSeedance25Controls({ anchor, read, write, changed, pick, de = false, classes = {}, connectedReferences = null }) {
    const root = document.createElement('fieldset'); root.dataset.seedance25Controls = ''; root.className = classes.root || 'generate-lab__settings-group'; anchor.after(root);
    const text = (en, german) => de ? german : en;
    const legend = document.createElement('legend'); legend.textContent = 'Seedance 2.5'; root.append(legend);
    const controls = {};
    function select(key, labelText, options) {
        const label = document.createElement('label'); label.textContent = labelText;
        const control = document.createElement('select'); control.className = classes.select || 'generate-lab__select'; control.dataset.seedance25Setting = key;
        for (const [value, title] of options) { const option = document.createElement('option'); option.value = value; option.textContent = title; control.append(option); }
        label.append(control); root.append(label); controls[key] = control;
        control.addEventListener('change', save);
    }
    select('workflow', text('Workflow', 'Arbeitsweise'), [['generate', text('Generate / reference guidance', 'Generieren / Referenzvorgaben')], ['edit', text('Edit reference video', 'Referenzvideo bearbeiten')], ['extend', text('Extend reference video', 'Referenzvideo verlängern')]]);
    select('duration', text('Duration', 'Dauer'), [[-1, 'Auto'], ...Array.from({ length: 27 }, (_, i) => [i + 4, `${i + 4} s`])]);
    select('resolution', text('Resolution', 'Auflösung'), SEEDANCE_25_RESOLUTIONS.map(v => [v, v]));
    select('aspect_ratio', text('Aspect ratio', 'Seitenverhältnis'), SEEDANCE_25_RATIOS.map(v => [v, v]));
    select('generate_audio', text('Generated audio', 'Erzeugter Ton'), [['default', text('Provider default (unspecified)', 'Anbieterstandard (nicht festgelegt)')], ['true', text('On', 'Ein')], ['false', text('Off', 'Aus')]]);
    select('watermark', text('Watermark', 'Wasserzeichen'), [['false', text('Off', 'Aus')], ['true', text('On', 'Ein')]]);
    select('output_format', text('Original format', 'Originalformat'), [['mp4', 'MP4'], ['mov', 'MOV']]);
    select('use_virtual_avatar', text('Virtual-character image routing', 'Bildverarbeitung für virtuelle Figuren'), [['false', text('Off', 'Aus')], ['true', text('On', 'Ein')]]);
    const seedLabel = document.createElement('label'); seedLabel.textContent = 'Seed';
    const seed = document.createElement('input'); seed.type = 'number'; seed.step = '1'; seed.min = String(-Number.MAX_SAFE_INTEGER); seed.max = String(Number.MAX_SAFE_INTEGER); seed.className = classes.select || 'generate-lab__select'; seed.dataset.seedance25Setting = 'seed';
    seedLabel.append(seed); root.append(seedLabel); controls.seed = seed; seed.addEventListener('change', save);
    const hint = document.createElement('p'); hint.textContent = text('24 fps. Seed reproducibility is not guaranteed. Camera lock has no effect and is not offered. Up to 30 reference images, 10 videos (30 s total) and 10 audio clips (30 s total). Audio-only input is supported. Upload MP4/MOV, WAV/MP3 or images through your private assets.', '24 fps. Wiederholbarkeit mit Seed ist nicht garantiert. Kamerafixierung ist wirkungslos und wird nicht angeboten. Bis zu 30 Bildreferenzen, 10 Videos (zusammen 30 s) und 10 Audioclips (zusammen 30 s). Audio-only wird unterstützt. MP4/MOV, WAV/MP3 oder Bilder werden in Ihren privaten Assets gespeichert.'); root.append(hint);
    const notice = document.createElement('p'); notice.setAttribute('role', 'status'); root.append(notice);
    const billing = document.createElement('p'); billing.textContent = text('Custom pricing: up to 30 seconds are reserved. The saved output duration determines the final charge; unused credits are released. The displayed credits are the reservation ceiling.', 'Individuelle Preisregel: Bis zu 30 Sekunden werden reserviert. Die Dauer der gespeicherten Ausgabe bestimmt die endgültige Abbuchung; ungenutzte Credits werden freigegeben. Angezeigte Credits sind die Reservierungsobergrenze.'); root.append(billing);
    const references = connectedReferences ? null : createH3ReferenceControls({ anchor: hint, de, pick, seedance25: true, classes,
        read: () => read().references || [], write: refs => write({ ...read(), references: refs }), changed: () => { normalizeFrameRatio(); sync(true, busy); changed(); } });
    let busy = false;
    const refs = () => connectedReferences ? connectedReferences() : (read().references || []).map(({ role, source }) => ({ role, source }));
    function normalizeFrameRatio() {
        if (refs().some(ref => ['first_frame', 'last_frame'].includes(ref.role)) && read().aspect_ratio !== 'adaptive') write({ ...read(), aspect_ratio: 'adaptive' });
    }
    function save() {
        try {
            if(!seed.validity.valid)throw new TypeError('Invalid seed');
            const next = { ...read(), workflow: controls.workflow.value, duration: controls.workflow.value === 'edit' ? -1 : Number(controls.duration.value), resolution: controls.resolution.value, aspect_ratio: controls.aspect_ratio.value,
                watermark: controls.watermark.value === 'true', output_format: controls.output_format.value, use_virtual_avatar: controls.use_virtual_avatar.value === 'true' };
            if (controls.generate_audio.value === 'default') delete next.generate_audio; else next.generate_audio = controls.generate_audio.value === 'true';
            if (seed.value === '') delete next.seed; else next.seed = Number(seed.value);
            const settings = seedance25Settings(next, refs());
            write({ ...next, ...settings }); notice.textContent = ''; sync(true, busy); changed();
        } catch { seed.value=String(read().seed ?? ''); notice.textContent = text('Invalid seed. Your previous saved settings are retained.', 'Ungültiger Seed. Ihre zuvor gespeicherten Einstellungen bleiben erhalten.'); }
    }
    function sync(visible, disabled = false) {
        root.hidden = !visible; busy = disabled; references?.sync(visible, disabled);
        if (!visible) return;
        normalizeFrameRatio();
        const state = read(), settings = seedance25Settings(state, refs());
        for (const [key, control] of Object.entries(controls)) { control.value = String(key === 'workflow' ? state.workflow || 'generate' : settings[key] ?? (key === 'generate_audio' ? 'default' : '')); control.disabled = disabled; }
        controls.duration.disabled ||= controls.workflow.value === 'edit';
        controls.aspect_ratio.disabled ||= refs().some(ref => ['first_frame', 'last_frame'].includes(ref.role));
    }
    return { root, sync, values: () => ({ ...seedance25Settings(read(), refs()), workflow: read().workflow || 'generate', references: refs() }) };
}
