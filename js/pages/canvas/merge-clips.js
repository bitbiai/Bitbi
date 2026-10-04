import { canvasClipIdentity, sameCanvasClip, canvasMergeStrand, canvasMergeSequence, canvasExportSubject } from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';

// Inspector drafts are scoped to a project AND displayed output. No account or
// label based selection; reopening a saved export revalidates its source versions.
const drafts = new Map();
export function clipSequence(controls, runId, german, signal, onChange, getGraph) {
    const initial = getGraph(), subject=canvasExportSubject(runId),key = `${initial.projectId}:${subject.key}`;
    const choiceId=clip=>clip?.runId || (clip?.nodeId?`node:${clip.nodeId}`:'');
    const isEndpoint=clip=>subject.nodeId?clip?.nodeId===subject.nodeId:clip?.runId===subject.runId;
    const box = document.createElement('fieldset'); box.className = 'canvas-clip-sequence';
    const legend = document.createElement('legend'); legend.textContent = german ? 'Clips zusammenfügen' : 'Merge clips'; box.append(legend);
    const modes = new Map();
    for (const [value, text] of [['manual', german ? 'Clips und Reihenfolge auswählen' : 'Choose clips and order'], ['chain', german ? 'Diese Kette zusammenfügen' : 'Merge this chain']]) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'radio'; input.name = `merge-mode-${subject.key}`; input.value = value;
        label.append(input, document.createTextNode(text)); box.append(label); modes.set(value, input);
        input.addEventListener('change', () => { mode = value; render(); }, { signal });
    }
    const help = document.createElement('p'), notice = document.createElement('p'), list = document.createElement('ol'), add = document.createElement('button');
    help.className = notice.className = 'canvas-muted'; notice.setAttribute('role', 'status');
    help.textContent = german ? 'Aktuelle Videoausgaben dieses Projekts. Die Auswahl ändert keine Verbindungen. Größere Clips werden mittig auf das kleinste gemeinsame Format zugeschnitten.' : 'Current video outputs in this project. Selection changes no connections. Larger clips are center-cropped to the smallest common size.';
    add.type = 'button'; add.className = 'canvas-button'; add.textContent = german ? 'Clip hinzufügen' : 'Add clip';
    box.append(help, notice, list, add); controls.append(box);
    let choices = [], available = [], selected = [], mode = 'manual', initialized = false, chain = { clips: [], error: 'canvas_chain_unavailable' }, invalidated = false;
    const problem = error => ({
        canvas_chain_endpoint_missing: german ? 'Der ausgewählte Endpunkt fehlt oder zeigt inzwischen eine andere Ausgabe. Aktuelle Ausgabe auswählen oder Status aktualisieren.' : 'The selected endpoint is missing or now shows another output. Select the current output or refresh status.',
        canvas_chain_endpoint_unavailable: german ? 'Die Videoausgabe des Endpunkts ist noch nicht fertig, fehlt oder wurde ersetzt. Status aktualisieren und die aktuelle Ausgabe prüfen.' : 'The endpoint video output is unfinished, missing or replaced. Refresh status and check the current output.',
        canvas_chain_limit: german ? 'Die Kette überschreitet die Grenze von 120 Nodes. Eine kürzere Kette oder manuelle Auswahl verwenden.' : 'This chain exceeds the 120-node limit. Use a shorter chain or manual selection.',
        canvas_chain_ambiguous: german ? 'Mehrere Videostränge führen hier zusammen. Bitte Clips manuell auswählen.' : 'Several video strands meet here. Choose clips manually.',
        canvas_chain_cycle: german ? 'Die Kette enthält einen Kreis. Verbindung korrigieren oder manuell auswählen.' : 'This chain contains a cycle. Correct the connection or choose manually.',
        canvas_chain_broken: german ? 'Eine Verbindung fehlt oder die angezeigte Ausgabe ist nicht mehr aktuell. Projekt erneut öffnen oder manuell auswählen.' : 'A connection is missing or the displayed output is no longer current. Reopen the project or choose manually.',
        canvas_chain_too_short: german ? 'Mindestens zwei eigenständige fertige Videoclips werden benötigt.' : 'At least two separate completed video clips are required.',
    }[error] || (german ? 'Eine benötigte Videoausgabe fehlt oder wurde ersetzt. Auswahl aktualisieren oder manuell auswählen.' : 'A required video output is missing or replaced. Refresh the selection or choose manually.'));
    const labelFor = clip => {
        const graph = getGraph(), node = graph.nodes.find(node => node.id === clip.nodeId);
        let title = node?.title || clip.title;
        if (!title || ['Video generation', 'Videogenerierung','Asset reference','Asset-Referenz'].includes(title)) title = node?.type==='asset_reference'?(german?'Video-Asset':'Video asset'):(german ? 'Videogenerierung' : 'Video generation');
        const model = graph.models.find(model => model.id === clip.modelId)?.label || clip.modelId || (german?'Video-Asset':'Video asset');
        const duplicate = choices.filter(other => (graph.nodes.find(node => node.id === other.nodeId)?.title || other.title || '') === (node?.title || clip.title || '')).length > 1;
        return `${title} · ${model} · ${new Date(clip.createdAt).toLocaleString(german ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })}${duplicate ? ' · ' + (clip.runId||clip.nodeId).slice(0, 8) : ''}`;
    };
    function reconcile() {
        const graph = getGraph();
        choices = graph.projectId === initial.projectId ? available.filter(clip => {
            const node = graph.nodes.find(node => node.id === clip.nodeId), output = node?.output;
            if(node?.type==='asset_reference')return node.content?.asset?.asset_type==='video' && sameCanvasClip(clip,{nodeId:node.id,assetId:node.asset_id,version:node.content.asset.sourceVersion});
            return output?.kind === 'video' && sameCanvasClip(clip, { runId: output.runId, assetId: output.assetId || output.asset?.id, version: output.sourceVersion });
        }) : [];
        selected = selected.map(clip => choices.find(current => sameCanvasClip(current, clip)) || null);
        const endpoint = graph.nodes.find(node => subject.nodeId?node.id===subject.nodeId:node.output?.runId === runId);
        chain = canvasMergeSequence(canvasMergeStrand(graph.nodes, graph.edges, endpoint?.id), choices);
    }
    const valid = () => !invalidated && (mode === 'chain' ? !chain.error : selected.length >= 2
        && selected.every(Boolean) && selected.some(isEndpoint)
        && new Set(selected.map(choiceId)).size === selected.length);
    function render(focusIndex = null) {
        reconcile(); modes.forEach((input, value) => { input.checked = mode === value; }); list.replaceChildren();
        const clips = mode === 'chain' ? chain.clips : selected;
        notice.textContent = invalidated ? problem('canvas_selection_changed') : mode === 'chain' && chain.error ? problem(chain.error)
            : `${clips.filter(Boolean).length} ${german ? 'Clips in dieser Reihenfolge' : 'clips in this order'}${chain.includedCount && mode === 'chain' ? (german ? ' · Bereits enthaltene Abschnitte werden nicht wiederholt.' : ' · Included footage is not repeated.') : ''}`;
        clips.forEach((clip, index) => {
            const row = document.createElement('li');
            if (mode === 'chain') { row.textContent = labelFor(clip); list.append(row); return; }
            const field = document.createElement('label'), select = document.createElement('select'); select.className = 'canvas-select'; select.setAttribute('aria-label', `Clip ${index + 1}`);
            field.className = 'canvas-field'; field.append(document.createTextNode(`Clip ${index + 1}`), select);
            const empty = document.createElement('option'); empty.value = ''; empty.textContent = german ? 'Clip auswählen' : 'Choose clip'; select.append(empty);
            for (const current of choices) {
                const option = document.createElement('option'); option.value = choiceId(current); option.textContent = labelFor(current);
                option.disabled = selected.some(other => sameCanvasClip(other, current)) && !sameCanvasClip(current, clip); select.append(option);
            }
            select.value = choiceId(clip);
            select.addEventListener('change', () => { selected[index] = choices.find(clip => choiceId(clip) === select.value) || null; invalidated = false; render(index); }, { signal }); row.append(field);
            for (const [text, delta] of [[german ? 'Nach oben' : 'Move up', -1], [german ? 'Nach unten' : 'Move down', 1], [german ? 'Entfernen' : 'Remove', 0]]) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'canvas-button'; button.textContent = text; button.setAttribute('aria-label', `${text}: Clip ${index + 1}`);
                button.disabled = delta < 0 && index === 0 || delta > 0 && index === selected.length - 1;
                button.addEventListener('click', () => { if (delta) [selected[index], selected[index + delta]] = [selected[index + delta], selected[index]]; else selected.splice(index, 1); render(Math.max(0, Math.min(selected.length - 1, index + delta))); }, { signal }); row.append(button);
            }
            list.append(row);
        });
        add.hidden = mode !== 'manual'; add.disabled = selected.length >= Math.min(120, choices.length);
        if (initialized) { drafts.set(key, { mode, selected: selected.map(clip => clip && canvasClipIdentity(clip)) }); if (drafts.size > 200) drafts.delete(drafts.keys().next().value); }
        if (focusIndex !== null) list.children[focusIndex]?.querySelector('select')?.focus(); onChange();
    }
    add.addEventListener('click', () => { selected.push(null); render(selected.length - 1); }, { signal });
    document.addEventListener('canvas:merge-state', () => { if (initialized) render(); }, { signal });
    return {
        update(data) {
            if (!Array.isArray(data.availableClips)) return;
            // Canonical candidates have already passed current-node, owner and
            // R2-version validation. Heal incomplete completion responses only;
            // a different run/asset/version or a switched project stays rejected.
            const graph = getGraph();
            if (graph.projectId === initial.projectId) for (const clip of data.availableClips) {
                const node = graph.nodes.find(node => node.id === clip.nodeId), output = node?.output;
                if(node?.type==='asset_reference' && node.asset_id===clip.assetId && node.content?.asset?.id===clip.assetId && !node.content.asset.sourceVersion && /^[a-f0-9]{64}$/.test(clip.version||''))node.content.asset.sourceVersion=clip.version;
                if (output?.kind === 'video' && output.runId === clip.runId
                    && (output.assetId || output.asset?.id) === clip.assetId
                    && (!node.asset_id || node.asset_id === clip.assetId)
                    && (output.sourceVersion == null || output.sourceVersion === '')
                    && /^[a-f0-9]{64}$/.test(clip.version || '')) output.sourceVersion = clip.version;
            }
            available = data.availableClips; invalidated = false; reconcile();
            if (!initialized) {
                const draft = drafts.get(key), recipe = data.export?.recipe;
                mode = draft?.mode || (recipe?.sequence === 'explicit' && recipe.mergeMode !== 'chain' || chain.error ? 'manual' : 'chain');
                selected = draft?.selected || (recipe?.sequence === 'explicit' ? recipe.videos : [null, choices.find(isEndpoint) || null]);
                initialized = true;
            }
            render();
        },
        invalidate() { invalidated = true; selected = selected.map(() => null); render(); },
        get available() { return initialized; },
        get valid() { reconcile(); return initialized && valid(); },
        get value() { return (mode === 'chain' ? chain.clips : selected).map(canvasClipIdentity); },
        get mode() { return mode; },
        lock(value) { box.disabled = value; },
    };
}
