import { canvasAssembly } from '../../shared/canvas-assembly.mjs?v=__ASSET_VERSION__';
import { canvasClipIdentity } from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';
import { TRANSITIONS, transitionSettings, sequenceTransitions } from '../../shared/canvas-transitions.mjs?v=__ASSET_VERSION__';
import { canvasApi } from './api.js?v=__ASSET_VERSION__';

// This edits ordinary project data. It never calls the assistant or generation.
export function assemblySequence({ legacy, parent, projectId, german, signal, getGraph, onChange, onSaved=()=>{}, settings=()=>({}) }) {
    const box = document.createElement('fieldset'), legend = document.createElement('legend');
    box.className = 'canvas-assembly'; legend.textContent = german ? 'Gespeicherter Filmschnitt' : 'Saved film assembly'; box.append(legend);
    const status = document.createElement('p'); status.className = 'canvas-muted'; status.setAttribute('role', 'status');
    const list = document.createElement('ol'), options = document.createElement('div'), target = document.createElement('input');
    target.type = 'number'; target.className = 'canvas-input'; target.min = '1'; target.max = '600'; target.step = '.1';
    const targetLabel = document.createElement('label'); targetLabel.className = 'canvas-field'; targetLabel.append(document.createTextNode(german ? 'Zieldauer (Sekunden, optional)' : 'Target duration (seconds, optional)'), target);
    const help = document.createElement('p'); help.className = 'canvas-muted';
    help.textContent = german ? 'Reihenfolge und Übergänge sind unabhängig von Referenzverbindungen. Zieldauer: ±0,5 Sekunden nach Messung. Ein geänderter Prompt benötigt eine neue Generierung; der letzte Export bleibt unverändert.' : 'Order and transitions are independent of reference connections. Target tolerance: ±0.5 seconds after measurement. Changed prompts need a new generation; the last export stays unchanged.';
    const use = document.createElement('button'), add = document.createElement('button'), legacyButton = document.createElement('button');
    for (const button of [use, add, legacyButton]) { button.type = 'button'; button.className = 'canvas-button'; }
    use.textContent = german ? 'Auswahl als Filmschnitt speichern' : 'Save selection as film assembly';
    add.textContent = german ? 'Clip zum Filmschnitt hinzufügen' : 'Add clip to film assembly';
    legacyButton.textContent = german ? 'Andere Auswahl exportieren' : 'Export another selection';
    options.append(targetLabel, help, list, add, legacyButton); box.append(use, options, status); parent.append(box);
    let assembly = null, persisted = null, active = false, initialized = false, available = [], revision = null, saving = Promise.resolve(true), settingsTimer=null, settingsPending=false, failed = false, writes = 0;
    const label = (text, input, row) => { const wrap = document.createElement('label'); wrap.className = 'canvas-field'; wrap.append(document.createTextNode(text), input); row.append(wrap); };
    const candidates = () => available.filter(clip => {
        const node = getGraph().nodes.find(node => node.id === clip.nodeId);
        return node && (node.type === 'asset_reference' ? node.asset_id === clip.assetId : node.output?.runId === clip.runId);
    });
    function saveSettings(){clearTimeout(settingsTimer);settingsTimer=null;if(settingsPending){settingsPending=false;changed();}}
    function changed() {
        let next; try { next = canvasAssembly(assembly); } catch { failed = true; status.textContent = german ? 'Ungültiger Filmschnitt. Werte prüfen.' : 'Invalid assembly. Check the values.'; onChange(); return; }
        writes++; failed = false; status.textContent = german ? 'Filmschnitt wird gespeichert…' : 'Saving assembly…';
        saving = saving.then(async () => {
            const latest = await canvasApi.assembly(projectId);
            if (!latest.ok || JSON.stringify(latest.data.assembly) !== JSON.stringify(persisted)) throw new Error('canvas_project_changed');
            const saved = await canvasApi.saveAssembly(projectId, { revision: latest.data.revision, assembly: next });
            if (!saved.ok) throw new Error(saved.code);
            persisted = saved.data.assembly; revision = saved.data.revision; onSaved(persisted,revision); return true;
        }).catch(() => { failed = true; return false; }).finally(() => {
            writes--; if (signal.aborted) return;
            status.textContent = failed ? (german ? 'Nicht gespeichert: Projekt wurde geändert oder Verbindung unterbrochen. Status aktualisieren, bevor du weiter exportierst.' : 'Not saved: the project changed or the connection was interrupted. Refresh status before exporting.') : writes ? (german ? 'Filmschnitt wird gespeichert…' : 'Saving assembly…') : (german ? 'Filmschnitt gespeichert. Für Änderungen eine neue Version exportieren.' : 'Assembly saved. Export a new version to apply changes.'); onChange();
        });
        onChange();
    }
    function render() {
        legacy.element.hidden = active; options.hidden = !active; use.hidden = active; list.replaceChildren();
        if (!active || !assembly) return;
        target.value = assembly.target ? String(assembly.target.seconds) : '';
        assembly.clips.forEach((clip, index) => {
            const row = document.createElement('li'), select = document.createElement('select'); select.className = 'canvas-select';
            const choices = candidates();
            if (!choices.some(c => c.nodeId === clip.nodeId)) { const missing = document.createElement('option'); missing.value = clip.nodeId; missing.textContent = german ? 'Clip fehlt – ersetzen oder entfernen' : 'Clip missing — replace or remove'; select.append(missing); }
            for (const choice of choices) { const option = document.createElement('option'); option.value = choice.nodeId; option.textContent = getGraph().nodes.find(n => n.id === choice.nodeId)?.title || choice.nodeId.slice(0, 8); option.disabled = assembly.clips.some(c => c.nodeId === choice.nodeId && c !== clip); select.append(option); }
            select.value = clip.nodeId; label(`Clip ${index + 1}`, select, row);
            select.addEventListener('change', () => { clip.nodeId = select.value; changed(); render(); }, { signal });
            for (const [key, text] of [['start', german ? 'Start im Quellclip (s)' : 'Start in source clip (s)'], ['duration', german ? 'Ausschnittdauer (s, leer = bis Ende)' : 'Trim duration (s, blank = to end)']]) {
                const input = document.createElement('input'); input.type = 'number'; input.className = 'canvas-input'; input.min = key === 'start' ? '0' : '.1'; input.max = '600'; input.step = '.01'; input.value = clip.trim[key] ?? ''; label(text, input, row);
                input.addEventListener('change', () => { if (key === 'duration' && input.value === '') delete clip.trim.duration; else clip.trim[key] = Number(input.value); changed(); }, { signal });
            }
            if (index < assembly.clips.length - 1) {
                const effect = document.createElement('select'); effect.className = 'canvas-select';
                for (const preset of TRANSITIONS) { const option = document.createElement('option'); option.value = preset.id; option.textContent = german ? preset.de : preset.en; effect.append(option); }
                effect.value = clip.transition.preset; label(german ? 'Übergang zum nächsten Clip' : 'Transition to next clip', effect, row);
                effect.addEventListener('change', () => { clip.transition = transitionSettings({ preset: effect.value, ...(effect.value === 'none' ? {} : { duration: .5 }) }); changed(); render(); }, { signal });
                if (clip.transition.preset !== 'none') {
                    const overlap = document.createElement('input'); overlap.type = 'number'; overlap.className = 'canvas-input'; overlap.min = '.1'; overlap.max = '2'; overlap.step = '.05'; overlap.value = String(clip.transition.duration); label(german ? 'Überlappung (s)' : 'Overlap (s)', overlap, row);
                    overlap.addEventListener('change', () => { clip.transition.duration = Number(overlap.value); changed(); }, { signal });
                    const preset = TRANSITIONS.find(p => p.id === clip.transition.preset);
                    if (preset.parameter) { const strength = document.createElement('input'); strength.type = 'number'; strength.className = 'canvas-input'; strength.min = String(preset.min); strength.max = String(preset.max); strength.step = preset.min < 1 ? '.01' : '1'; strength.value = String(clip.transition[preset.parameter]); label(german ? 'Intensität' : 'Intensity', strength, row); strength.addEventListener('change', () => { clip.transition[preset.parameter] = Number(strength.value); changed(); }, { signal }); }
                }
            }
            for (const [text, delta] of [[german ? 'Nach oben' : 'Move up', -1], [german ? 'Nach unten' : 'Move down', 1], [german ? 'Entfernen' : 'Remove', 0]]) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-button'; button.textContent = text; button.setAttribute('aria-label', `${text}: Clip ${index + 1}`); button.disabled = delta < 0 && index === 0 || delta > 0 && index === assembly.clips.length - 1;
                button.addEventListener('click', () => { if (delta) [assembly.clips[index], assembly.clips[index + delta]] = [assembly.clips[index + delta], assembly.clips[index]]; else assembly.clips.splice(index, 1); changed(); render(); list.children[Math.max(0, index + delta)]?.querySelector('select')?.focus(); }, { signal }); row.append(button);
            }
            list.append(row);
        });
        add.disabled = !candidates().some(c => !assembly.clips.some(s => s.nodeId === c.nodeId));
    }
    use.addEventListener('click', () => {
        if (persisted) { assembly = structuredClone(persisted); active = true; render(); onChange(); return; }
        if (!legacy.valid) return;
        const clips = legacy.value.map(clip => available.find(c => c.assetId === clip.assetId && c.version === clip.version));
        const transitions = sequenceTransitions(clips, getGraph().edges);
        assembly = canvasAssembly({ version: 1, anchorNodeId:clips.at(-1).nodeId, clips: clips.map((clip, i) => ({ nodeId: clip.nodeId, transition: transitions[i] })), target: null,...settings() }); active = true; changed(); render();
    }, { signal });
    legacyButton.addEventListener('click', () => { active = false; use.textContent = german ? 'Gespeicherten Filmschnitt verwenden' : 'Use saved film assembly'; render(); onChange(); }, { signal });
    add.addEventListener('click', () => { const next = candidates().find(c => !assembly.clips.some(s => s.nodeId === c.nodeId)); if (next) { assembly.clips.push({ nodeId: next.nodeId, trim: { start: 0 }, transition: { preset: 'none' } }); changed(); render(); } }, { signal });
    target.addEventListener('change', () => { assembly.target = target.value === '' ? null : { seconds: Number(target.value) }; changed(); }, { signal });
    document.addEventListener('canvas:merge-state', () => { if (active) { render(); onChange(); } }, { signal }); render();
    return {
        update(data) { legacy.update(data); available = data.availableClips || available; if (Object.hasOwn(data, 'assembly') && !writes && !settingsPending) { persisted = data.assembly; revision = data.revision; assembly = persisted && structuredClone(persisted); if (!initialized) active = Boolean(assembly); else if (!assembly) active = false; initialized = true; failed = false; onSaved(persisted,revision); render(); } },
        invalidate() { legacy.invalidate(); failed = true; },
        get available() { return legacy.available; },
        get valid() { return active ? Boolean(assembly && !failed && assembly.clips.length >= 1 && assembly.clips.every(c => candidates().some(s => s.nodeId === c.nodeId))) : legacy.valid; },
        get value() { return active ? (assembly?.clips || []).map(c => candidates().find(s => s.nodeId === c.nodeId)).filter(Boolean).map(canvasClipIdentity) : legacy.value; },
        get mode() { return active ? 'assembly' : legacy.mode; },
        get assembly() { if(!active||!assembly)return null;try{return canvasAssembly(assembly);}catch{return assembly;} },
        get revision() { return revision; },
        setSettings(values) { if(!assembly)return;const next={...assembly,...values};if(JSON.stringify(next)===JSON.stringify(assembly))return;assembly=next;settingsPending=true;clearTimeout(settingsTimer);settingsTimer=setTimeout(saveSettings,250);onSaved(canvasAssembly(assembly),revision);onChange(); },
        async flush() { saveSettings(); await saving; if (failed || writes) return false; if (!active) return true; const latest = await canvasApi.assembly(projectId); if (!latest.ok || JSON.stringify(latest.data.assembly) !== JSON.stringify(persisted)) return false; revision = latest.data.revision; return true; },
        lock(value) { legacy.lock(value); box.disabled = value; },
    };
}
