import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initAuthEntryActions } from '../../shared/auth-entry-actions.js?v=__ASSET_VERSION__';
import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { createCanvasState, createDebouncedTask } from './state.js?v=__ASSET_VERSION__';
import { createCanvasGraph } from './graph.js?v=__ASSET_VERSION__';
import { analyzeWorkflow, validationForNode, upstreamDisplayNode } from './workflow.js?v=__ASSET_VERSION__';

const isGerman = document.documentElement.lang === 'de';
const copy = isGerman ? {
    saved: 'Gespeichert', saving: 'Wird gespeichert', unsaved: 'Ungespeicherte Änderungen', saveFailed: 'Speichern fehlgeschlagen',
    newProject: 'Neue Canvas', projectPrompt: 'Name der Canvas', renamePrompt: 'Canvas umbenennen', deleteProject: 'Diese Canvas löschen? Assets bleiben im Assets Manager erhalten.',
    deleteNode: 'Diesen Node löschen? Das zugrunde liegende Asset bleibt erhalten.', deleteEdge: 'Diese Verbindung löschen?',
    selectedNode: 'Node ausgewählt', selectedEdge: 'Verbindung ausgewählt', selectNode: 'Wähle einen Node zum Bearbeiten',
    nodeTypes: { text_prompt: 'Text-Prompt', text_generation: 'Textgenerierung', image_generation: 'Bildgenerierung', video_generation: 'Videogenerierung', music_generation: 'Musikgenerierung', asset_reference: 'Asset-Referenz', output_result: 'Ausgabe', note: 'Notiz' },
    emptyNode: 'Öffne den Inspector und konfiguriere diesen Schritt.', noModel: 'Kein Modell', untitled: 'Ohne Titel', ready: 'Bereit', completed: 'Abgeschlossen',
    assetSelected: 'Asset aus deinem Assets Manager ausgewählt', connection: 'Verbindung', startConnection: 'Verbindung von diesem Node starten', finishConnection: 'Verbindung mit diesem Node abschließen',
    connectStart: 'Wähle am Quell-Node den rechten Anschluss.', connectTarget: 'Wähle am Ziel-Node den linken Anschluss.', connected: 'Nodes verbunden.', duplicateEdge: 'Diese Verbindung existiert bereits.', selfEdge: 'Ein Node kann nicht mit sich selbst verbunden werden.',
    title: 'Titel', text: 'Text', prompt: 'Prompt', systemPrompt: 'System-Prompt', model: 'Modell', maxTokens: 'Max. Tokens', temperature: 'Temperatur', duration: 'Dauer (Sek.)', aspectRatio: 'Seitenverhältnis', lyrics: 'Songtext', instrumental: 'Instrumental', generateLyrics: 'Songtext generieren',
    run: 'Ausführen', running: 'Wird ausgeführt', failed: 'Fehlgeschlagen', output: 'Ausgabe', outputEmpty: 'Deine Ausgabe erscheint hier', estimated: 'Geschätzte Credits', disabled: 'Nicht ausführbar', selectAsset: 'Asset auswählen', loadingAssets: 'Assets werden geladen…', noAssets: 'Keine Assets gefunden.',
    projectCreated: 'Canvas erstellt.', projectDeleted: 'Canvas gelöscht.', nodeAdded: 'Node hinzugefügt.', runComplete: 'Ausführung abgeschlossen.', projectsEmpty: 'Noch keine Canvas. Erstelle dein erstes Projekt.',
    credits: 'Credits', recentRunsEmpty: 'Dein Verlauf erscheint hier.', networkError: 'Canvas konnte nicht geladen werden.', runInProgress: 'Diese Ausführung läuft bereits.',
    noInput: 'Kein Input', inputConnected: 'Input verbunden', needsUpstream: 'Upstream ausführen', runUpstream: 'Führe zuerst den Upstream-Node aus.', edgeCompatible: 'Kompatibler Input.',
    inputHandle: 'Input-Anschluss', outputHandle: 'Output-Anschluss', inputFrom: 'Input von', connectedInput: 'Verbundener Input', effectivePrompt: 'Effektiver Prompt', directOverride: 'Der direkte Prompt überschreibt verbundenen Text.',
    moveNode: 'Node ziehen oder mit den Pfeiltasten verschieben; Umschalt für größere Schritte.',
    promptRequired: 'Füge einen direkten Prompt hinzu oder verbinde einen Text-Node.', selectedModel: 'Das ausgewählte Modell', imageInputUnsupported: '{model} unterstützt in Canvas keinen Bild-Input.', videoInputUnsupported: '{model} unterstützt in Canvas keinen Video-Input, keine Fortsetzung und keine Erweiterung.', audioInputUnsupported: 'Das ausgewählte Modell akzeptiert keinen Audio-Asset-Input.', jsonInputUnsupported: 'Das ausgewählte Modell akzeptiert keinen JSON-Workflow-Input.', noUsableOutput: 'Die verbundene Quelle hat noch keine nutzbare Ausgabe.',
    quickCreated: 'Text → Bild → Video wurde erstellt. Führe die Nodes von links nach rechts aus.', quickFailed: 'Der schnelle Workflow konnte nicht vollständig erstellt werden.', organizationSelect: 'Organisation auswählen', organizationRequired: 'Wähle eine aktive Organisation für dieses Modell.',
} : {
    saved: 'Saved', saving: 'Saving', unsaved: 'Unsaved changes', saveFailed: 'Save failed',
    newProject: 'New Canvas', projectPrompt: 'Canvas name', renamePrompt: 'Rename Canvas', deleteProject: 'Delete this Canvas? Assets will remain in Assets Manager.',
    deleteNode: 'Delete this node? Its underlying asset will remain available.', deleteEdge: 'Delete this connection?',
    selectedNode: 'Node selected', selectedEdge: 'Connection selected', selectNode: 'Select a node to edit it',
    nodeTypes: { text_prompt: 'Text prompt', text_generation: 'Text generation', image_generation: 'Image generation', video_generation: 'Video generation', music_generation: 'Music generation', asset_reference: 'Asset reference', output_result: 'Output', note: 'Note' },
    emptyNode: 'Open the inspector to configure this step.', noModel: 'No model', untitled: 'Untitled', ready: 'Ready', completed: 'Completed',
    assetSelected: 'Asset selected from your Assets Manager', connection: 'Connection', startConnection: 'Start a connection from this node', finishConnection: 'Finish a connection at this node',
    connectStart: 'Choose the right port on the source node.', connectTarget: 'Choose the left port on the target node.', connected: 'Nodes connected.', duplicateEdge: 'That connection already exists.', selfEdge: 'A node cannot connect to itself.',
    title: 'Title', text: 'Text', prompt: 'Prompt', systemPrompt: 'System prompt', model: 'Model', maxTokens: 'Max tokens', temperature: 'Temperature', duration: 'Duration (seconds)', aspectRatio: 'Aspect ratio', lyrics: 'Lyrics', instrumental: 'Instrumental', generateLyrics: 'Generate lyrics',
    run: 'Run', running: 'Running', failed: 'Failed', output: 'Output', outputEmpty: 'Your output will appear here', estimated: 'Estimated credits', disabled: 'Not runnable', selectAsset: 'Select asset', loadingAssets: 'Loading assets…', noAssets: 'No assets found.',
    projectCreated: 'Canvas created.', projectDeleted: 'Canvas deleted.', nodeAdded: 'Node added.', runComplete: 'Run completed.', projectsEmpty: 'No Canvas projects yet. Create your first project.',
    credits: 'Credits', recentRunsEmpty: 'Your run history will appear here.', networkError: 'Canvas could not be loaded.', runInProgress: 'This run is already in progress.',
    noInput: 'No input', inputConnected: 'Input connected', needsUpstream: 'Needs upstream', runUpstream: 'Run the upstream node first.', edgeCompatible: 'Compatible input.',
    inputHandle: 'Input handle', outputHandle: 'Output handle', inputFrom: 'Input from', connectedInput: 'Connected input', effectivePrompt: 'Effective prompt', directOverride: 'The direct prompt overrides connected text.',
    moveNode: 'Drag the node or use arrow keys to move it; hold Shift for larger steps.',
    promptRequired: 'Add a direct prompt or connect a text node.', selectedModel: 'The selected model', imageInputUnsupported: '{model} does not support image input in Canvas.', videoInputUnsupported: '{model} does not support video input, continuation, or extension in Canvas.', audioInputUnsupported: 'The selected model does not accept an audio asset input.', jsonInputUnsupported: 'The selected model does not accept JSON workflow input.', noUsableOutput: 'The connected source has no usable output yet.',
    quickCreated: 'Text → Image → Video was created. Run the nodes from left to right.', quickFailed: 'The quick workflow could not be fully created.', organizationSelect: 'Select organization', organizationRequired: 'Select an active organization for this model.',
};

const dom = Object.freeze({
    loading: document.getElementById('canvasLoading'), denied: document.getElementById('canvasDenied'), app: document.getElementById('canvasApp'),
    title: document.getElementById('canvasProjectTitle'), save: document.getElementById('canvasSaveState'), projects: document.getElementById('canvasProjectList'),
    newProject: document.getElementById('canvasNewProject'), nodeType: document.getElementById('canvasNodeType'), addNode: document.getElementById('canvasAddNode'),
    connect: document.getElementById('canvasConnect'), deleteSelection: document.getElementById('canvasDeleteSelection'), hint: document.getElementById('canvasSelectionHint'),
    nodes: document.getElementById('canvasNodes'), edges: document.getElementById('canvasEdges'), empty: document.getElementById('canvasEmpty'), viewport: document.getElementById('canvasViewport'),
    inspectorTitle: document.getElementById('canvasInspectorTitle'), inspector: document.getElementById('canvasInspectorBody'), history: document.getElementById('canvasRunHistory'),
    credits: document.getElementById('canvasCredits'), toast: document.getElementById('canvasToast'),
    organizationField: document.getElementById('canvasOrganizationField'), organization: document.getElementById('canvasOrganization'),
    quickTextImageVideo: document.getElementById('canvasQuickTextImageVideo'),
});

const store = createCanvasState();
let assetsCache = null;
let runningNodeId = null;
let toastTimer = 0;
const pendingRunKeys = new Map();
let workflowAnalysis = { byNode: new Map(), edgeStates: new Map() };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, 3600);
}

function errorMessage(result) {
    if (result?.code === 'canvas_run_in_progress') return copy.runInProgress;
    return result?.error || copy.networkError;
}

function renderSaveState() {
    const { saving, saveError } = store.state;
    const pending = nodeSave.pending || projectSave.pending;
    const value = saveError ? copy.saveFailed : saving > 0 ? copy.saving : pending ? copy.unsaved : copy.saved;
    dom.save.textContent = value;
    dom.save.dataset.state = saveError ? 'error' : saving > 0 ? 'saving' : pending ? 'unsaved' : 'saved';
}

const projectSave = createDebouncedTask(async (projectId, body) => {
    store.beginSave();
    const result = await canvasApi.updateProject(projectId, body);
    store.endSave(result.ok);
    if (result.ok && store.state.project?.id === projectId) {
        store.state.project = result.data.project;
        const index = store.state.projects.findIndex((project) => project.id === projectId);
        if (index >= 0) store.state.projects[index] = result.data.project;
        renderProjects();
    } else if (!result.ok) showToast(errorMessage(result));
}, 650);

const nodeSave = createDebouncedTask(async (projectId, nodeId, body) => {
    store.beginSave();
    const result = await canvasApi.updateNode(projectId, nodeId, body);
    store.endSave(result.ok);
    if (result.ok) {
        const index = store.state.nodes.findIndex((node) => node.id === nodeId);
        if (index >= 0) store.state.nodes[index] = result.data.node;
        renderGraph();
    } else showToast(errorMessage(result));
}, 550);

store.subscribe(renderSaveState);

function selectedNode() {
    return store.state.selected?.kind === 'node' ? store.state.nodes.find((node) => node.id === store.state.selected.id) || null : null;
}

function renderProjects() {
    dom.projects.replaceChildren();
    if (!store.state.projects.length) {
        dom.projects.append(el('p', 'canvas-muted', copy.projectsEmpty));
        return;
    }
    for (const project of store.state.projects) {
        const item = el('div', 'canvas-project-item');
        if (project.id === store.state.project?.id) item.classList.add('is-active');
        const open = el('button', 'canvas-project-item__open');
        open.type = 'button';
        open.append(el('strong', '', project.title), el('small', '', new Date(project.updated_at).toLocaleString(isGerman ? 'de-DE' : 'en-US', { dateStyle: 'medium' })));
        open.addEventListener('click', () => void openProject(project.id));
        const actions = el('span', 'canvas-project-item__actions');
        const rename = el('button', 'canvas-project-item__menu', 'R');
        rename.type = 'button';
        rename.setAttribute('aria-label', `${copy.renamePrompt}: ${project.title}`);
        rename.addEventListener('click', () => void renameProject(project));
        const remove = el('button', 'canvas-project-item__menu canvas-project-item__menu--danger', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${isGerman ? 'Canvas löschen' : 'Delete Canvas'}: ${project.title}`);
        remove.addEventListener('click', () => void deleteProject(project));
        actions.append(rename, remove);
        item.append(open, actions);
        dom.projects.append(item);
    }
}

function renderGraph() {
    workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
    graph.render({ ...store.state, copy, nodeAnalysis: workflowAnalysis.byNode, edgeStates: workflowAnalysis.edgeStates });
    dom.deleteSelection.disabled = !store.state.selected;
    dom.hint.textContent = store.state.selected?.kind === 'node' ? copy.selectedNode : store.state.selected?.kind === 'edge' ? copy.selectedEdge : copy.selectNode;
    dom.connect.classList.toggle('is-active', store.state.connecting);
    dom.connect.setAttribute('aria-pressed', String(store.state.connecting));
}

function renderHistory() {
    dom.history.replaceChildren();
    if (!store.state.runs.length) { dom.history.append(el('p', 'canvas-muted', copy.recentRunsEmpty)); return; }
    for (const run of store.state.runs) {
        const node = store.state.nodes.find((candidate) => candidate.id === run.node_id);
        const item = el('button', 'canvas-run-item');
        item.type = 'button';
        item.dataset.status = run.status;
        const top = el('div', 'canvas-run-item__top');
        top.append(el('span', '', node?.title || run.model_id), el('strong', '', run.status));
        const kind = run.output?.kind ? ` · ${run.output.kind}` : '';
        item.append(top, el('small', '', `${run.model_id}${kind} · ${new Date(run.updated_at).toLocaleString(isGerman ? 'de-DE' : 'en-US')}`));
        item.addEventListener('click', () => {
            if (!node) return;
            node.output = run.output || node.output;
            store.state.selected = { kind: 'node', id: node.id };
            renderGraph(); renderInspector();
        });
        dom.history.append(item);
    }
}

function field(label, control) {
    const wrapper = el('label', 'canvas-field');
    wrapper.append(el('span', '', label), control);
    return wrapper;
}

function inputControl(value = '', type = 'text') {
    const input = el('input', 'canvas-input');
    input.type = type;
    input.value = value ?? '';
    return input;
}

function textareaControl(value = '') {
    const textarea = el('textarea', 'canvas-textarea');
    textarea.value = value ?? '';
    return textarea;
}

function selectControl(options, value) {
    const select = el('select', 'canvas-select');
    for (const optionData of options) {
        const option = el('option', '', optionData.label);
        option.value = optionData.value;
        option.disabled = optionData.disabled === true;
        if (option.value === String(value ?? '')) option.selected = true;
        select.append(option);
    }
    return select;
}

function scheduleNode(node, patch) {
    Object.assign(node, patch);
    nodeSave.schedule(store.state.project.id, node.id, patch);
    renderSaveState();
}

function bindConfig(node, control, key, parser = (value) => value) {
    control.addEventListener('input', () => {
        const config = { ...(node.config || {}), [key]: parser(control.type === 'checkbox' ? control.checked : control.value) };
        node.config = config;
        nodeSave.schedule(store.state.project.id, node.id, { config });
        renderSaveState();
    });
}

function renderOutput(node) {
    const section = el('section', 'canvas-output');
    section.append(el('strong', '', copy.output));
    const output = node.output;
    if (!output) { section.append(el('p', 'canvas-muted', copy.outputEmpty)); return section; }
    if (output.kind === 'text') section.append(el('pre', '', output.text || ''));
    else if (output.kind === 'image' && output.asset?.preview_url) {
        const image = el('img'); image.src = output.asset.preview_url; image.alt = node.title || copy.output; image.loading = 'lazy'; section.append(image);
    } else if (output.kind === 'video' && output.asset?.file_url) {
        const video = el('video'); video.src = output.asset.file_url; video.controls = true; video.preload = 'metadata'; section.append(video);
    } else if (output.kind === 'audio' && output.asset?.file_url) {
        const audio = el('audio'); audio.src = output.asset.file_url; audio.controls = true; audio.preload = 'metadata'; section.append(audio);
    } else section.append(el('p', 'canvas-muted', copy.outputEmpty));
    return section;
}

function displayNodeOutput(node, visited = new Set()) {
    const resolved = upstreamDisplayNode(node, store.state.nodes, store.state.edges, visited);
    if (!resolved) return node;
    if (resolved.type === 'asset_reference' && resolved.content?.asset && !resolved.output) {
        const asset = resolved.content.asset;
        const mime = String(asset.mime_type || '');
        const kind = asset.asset_type === 'image' || mime.startsWith('image/')
            ? 'image'
            : (asset.asset_type === 'music' || asset.asset_type === 'audio' || mime.startsWith('audio/'))
                ? 'audio'
                : 'video';
        return { ...resolved, output: { kind, asset } };
    }
    return resolved;
}

async function loadAssetOptions(node, select) {
    select.disabled = true;
    const loading = el('option', '', copy.loadingAssets); loading.value = ''; select.replaceChildren(loading);
    try {
        assetsCache ||= await canvasApi.listAssets();
        select.replaceChildren();
        const empty = el('option', '', assetsCache.assets.length ? copy.selectAsset : copy.noAssets); empty.value = ''; select.append(empty);
        for (const asset of assetsCache.assets) {
            const option = el('option', '', asset.title || asset.prompt || asset.file_name || asset.id);
            option.value = asset.id;
            if (asset.id === node.asset_id) option.selected = true;
            select.append(option);
        }
        select.disabled = assetsCache.assets.length === 0;
    } catch {
        select.replaceChildren(el('option', '', copy.noAssets));
    }
}

function renderInputContext(node, analysis) {
    const section = el('section', 'canvas-input-context');
    const sourceNames = analysis.sources.map((source) => source.sourceTitle).join(', ');
    section.append(el('strong', '', sourceNames ? `${copy.inputFrom}: ${sourceNames}` : copy.noInput));
    if (analysis.sources.length) {
        for (const source of analysis.sources) {
            const message = source.status === 'compatible'
                ? `${source.sourceTitle}: ${source.inputKind}`
                : `${source.sourceTitle}: ${source.reason}`;
            section.append(el('p', '', message));
            if (source.previewUrl && source.kind === 'image_asset') {
                const image = el('img'); image.src = source.previewUrl; image.alt = source.sourceTitle; image.loading = 'lazy'; section.append(image);
            }
        }
    }
    if (analysis.connectedPrompt) {
        section.append(el('strong', '', copy.connectedInput), el('pre', '', analysis.connectedPrompt));
        if (analysis.directPrompt) section.append(el('p', '', copy.directOverride));
    }
    if (analysis.effectivePrompt) section.append(el('strong', '', copy.effectivePrompt), el('pre', '', analysis.effectivePrompt));
    const validation = validationForNode(node, analysis, copy);
    if (validation) { section.dataset.state = 'error'; section.append(el('p', '', validation)); }
    return { section, validation };
}

function renderInspector() {
    dom.inspector.replaceChildren();
    const node = selectedNode();
    if (!node) {
        const edge = store.state.selected?.kind === 'edge' ? store.state.edges.find((item) => item.id === store.state.selected.id) : null;
        dom.inspectorTitle.textContent = edge ? copy.selectedEdge : (isGerman ? 'Kein Node ausgewählt' : 'No node selected');
        if (edge) {
            dom.inspector.append(el('p', 'canvas-muted', `${edge.source_node_id.slice(0, 8)} → ${edge.target_node_id.slice(0, 8)}`));
            const remove = el('button', 'canvas-button canvas-button--danger', isGerman ? 'Verbindung löschen' : 'Delete connection');
            remove.type = 'button'; remove.addEventListener('click', () => void deleteSelection()); dom.inspector.append(remove);
        } else dom.inspector.append(el('p', 'canvas-muted', isGerman ? 'Wähle einen Node, um Prompt, Modell, Einstellungen und Ausgabe zu bearbeiten.' : 'Select a node to edit its prompt, model, settings, and output.'));
        return;
    }
    dom.inspectorTitle.textContent = node.title || copy.nodeTypes[node.type];
    const title = inputControl(node.title || copy.nodeTypes[node.type]);
    title.maxLength = 120;
    title.addEventListener('input', () => scheduleNode(node, { title: title.value }));
    dom.inspector.append(field(copy.title, title));

    if (node.type === 'text_prompt' || node.type === 'note') {
        const text = textareaControl(node.content?.text || node.content?.prompt || '');
        text.maxLength = 12000;
        text.addEventListener('input', () => {
            const content = { ...(node.content || {}), [node.type === 'text_prompt' ? 'prompt' : 'text']: text.value };
            node.content = content; nodeSave.schedule(store.state.project.id, node.id, { content }); renderSaveState();
        });
        dom.inspector.append(field(copy.text, text));
    }

    const capability = ({ text_generation: 'text', image_generation: 'image', video_generation: 'video', music_generation: 'music' })[node.type];
    if (capability) {
        workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
        const models = store.state.models.filter((model) => model.capability === capability);
        const model = models.find((item) => item.id === node.model_id) || models.find((item) => item.runnable) || null;
        const modelSelect = selectControl(models.map((item) => ({ value: item.id, label: `${item.label}${item.runnable ? '' : ` — ${copy.disabled}`}` })), model?.id);
        modelSelect.addEventListener('change', () => { node.model_id = modelSelect.value; nodeSave.schedule(store.state.project.id, node.id, { model_id: node.model_id }); renderSaveState(); window.setTimeout(renderInspector); });
        dom.inspector.append(field(copy.model, modelSelect));
        if (model) {
            dom.inspector.append(el('p', 'canvas-model-note', model.runnable ? model.description : model.disabledReason));
            const cost = el('p', 'canvas-cost-note');
            cost.append(el('strong', '', `${copy.estimated}: ${model.estimatedCredits ?? '—'}`), document.createTextNode(` · ${model.pricingStatus}`));
            dom.inspector.append(cost);
        }
        const prompt = textareaControl(node.config?.prompt || '');
        prompt.maxLength = Number(model?.controls?.maxPromptLength || 12000);
        bindConfig(node, prompt, 'prompt');
        dom.inspector.append(field(copy.prompt, prompt));

        const inputContext = renderInputContext(node, workflowAnalysis.byNode.get(node.id));
        dom.inspector.append(inputContext.section);

        if (capability === 'text') {
            const system = textareaControl(node.config?.systemPrompt || ''); system.maxLength = 4000; bindConfig(node, system, 'systemPrompt'); dom.inspector.append(field(copy.systemPrompt, system));
            const grid = el('div', 'canvas-field-grid');
            const maxTokens = inputControl(node.config?.maxTokens ?? model?.controls?.maxTokens?.default ?? 500, 'number'); maxTokens.min = '1'; maxTokens.max = String(model?.controls?.maxTokens?.max || 4096); bindConfig(node, maxTokens, 'maxTokens', (value) => Number(value));
            const temperature = inputControl(node.config?.temperature ?? .7, 'number'); temperature.min = '0'; temperature.max = '1.5'; temperature.step = '.1'; bindConfig(node, temperature, 'temperature', (value) => Number(value));
            grid.append(field(copy.maxTokens, maxTokens), field(copy.temperature, temperature)); dom.inspector.append(grid);
        }
        if (capability === 'video') {
            const grid = el('div', 'canvas-field-grid');
            const duration = inputControl(node.config?.duration ?? model?.controls?.duration?.default ?? 5, 'number'); duration.min = String(model?.controls?.duration?.min || 1); duration.max = String(model?.controls?.duration?.max || 15); bindConfig(node, duration, 'duration', Number);
            const ratios = model?.controls?.aspectRatioOptions?.length ? model.controls.aspectRatioOptions : ['16:9', '9:16', '1:1'];
            const ratio = selectControl(ratios.map((value) => ({ value, label: value })), node.config?.aspectRatio || model?.controls?.defaultAspectRatio || '16:9'); bindConfig(node, ratio, 'aspectRatio');
            grid.append(field(copy.duration, duration), field(copy.aspectRatio, ratio)); dom.inspector.append(grid);
        }
        if (capability === 'music') {
            const lyrics = textareaControl(node.config?.lyrics || ''); lyrics.maxLength = 3500; bindConfig(node, lyrics, 'lyrics'); dom.inspector.append(field(copy.lyrics, lyrics));
            for (const [key, label] of [['instrumental', copy.instrumental], ['generateLyrics', copy.generateLyrics]]) {
                const checkbox = inputControl('', 'checkbox'); checkbox.checked = node.config?.[key] === true; bindConfig(node, checkbox, key, Boolean); dom.inspector.append(field(label, checkbox));
            }
        }
        const status = el('div', 'canvas-run-status', runningNodeId === node.id ? copy.running : ''); status.id = 'canvasNodeRunStatus'; dom.inspector.append(status);
        const run = el('button', 'canvas-button canvas-button--primary', runningNodeId === node.id ? copy.running : copy.run);
        run.type = 'button'; run.disabled = runningNodeId === node.id || !model?.runnable || Boolean(inputContext.validation); run.addEventListener('click', () => void runSelectedNode(node)); dom.inspector.append(run);
        prompt.addEventListener('input', () => {
            const current = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy).byNode.get(node.id);
            run.disabled = runningNodeId === node.id || !model?.runnable || Boolean(validationForNode(node, current, copy));
        });
    }

    if (node.type === 'asset_reference') {
        const select = el('select', 'canvas-select');
        select.addEventListener('change', () => { if (select.value) void assignAsset(node, select.value); });
        dom.inspector.append(field(copy.selectAsset, select));
        void loadAssetOptions(node, select);
    }
    dom.inspector.append(renderOutput(displayNodeOutput(node)));
}

function renderAll() { renderProjects(); renderGraph(); renderInspector(); renderHistory(); }

const graph = createCanvasGraph({
    nodesRoot: dom.nodes, edgesRoot: dom.edges, emptyState: dom.empty, copy,
    onSelect(kind, id, options = {}) {
        if (store.state.connecting && kind === 'node' && store.state.connectionSourceId && id !== store.state.connectionSourceId) void connectNodes(store.state.connectionSourceId, id);
        else {
            store.state.selected = { kind, id };
            if (!options.preserveGraph) renderGraph();
            else {
                dom.deleteSelection.disabled = false;
                dom.hint.textContent = copy.selectedNode;
            }
            renderInspector();
        }
    },
    onMoveEnd(node) { nodeSave.schedule(store.state.project.id, node.id, { x: node.x, y: node.y }); renderSaveState(); },
    onPort(nodeId, direction) {
        if (direction === 'out') {
            store.state.connecting = true; store.state.connectionSourceId = nodeId; dom.hint.textContent = copy.connectTarget; renderGraph();
        } else if (store.state.connectionSourceId) void connectNodes(store.state.connectionSourceId, nodeId);
        else { store.state.connecting = true; dom.hint.textContent = copy.connectStart; renderGraph(); }
    },
});

async function createProject() {
    const suggested = copy.newProject;
    const title = window.prompt(copy.projectPrompt, suggested);
    if (title === null || !title.trim()) return;
    const result = await canvasApi.createProject({ title: title.trim(), locale: isGerman ? 'de' : 'en' });
    if (!result.ok) return showToast(errorMessage(result));
    store.state.projects.unshift(result.data.project);
    await openProject(result.data.project.id);
    showToast(copy.projectCreated);
}

async function renameProject(project) {
    const next = window.prompt(copy.renamePrompt, project.title);
    if (next === null) return;
    if (next.trim() && next.trim() !== project.title) {
        const renamed = await canvasApi.updateProject(project.id, { title: next.trim() });
        if (!renamed.ok) return showToast(errorMessage(renamed));
        const index = store.state.projects.findIndex((item) => item.id === project.id);
        store.state.projects[index] = renamed.data.project;
        if (store.state.project?.id === project.id) { store.state.project = renamed.data.project; dom.title.value = renamed.data.project.title; }
        renderProjects();
    }
}

async function deleteProject(project) {
    if (!window.confirm(copy.deleteProject)) return;
    const deleted = await canvasApi.deleteProject(project.id);
    if (!deleted.ok) return showToast(errorMessage(deleted));
    store.state.projects = store.state.projects.filter((item) => item.id !== project.id);
    if (store.state.project?.id === project.id) {
        store.state.project = null; store.state.nodes = []; store.state.edges = []; store.state.runs = [];
        if (store.state.projects[0]) await openProject(store.state.projects[0].id); else { dom.title.value = copy.newProject; renderAll(); }
    } else renderProjects();
    showToast(copy.projectDeleted);
}

async function openProject(projectId) {
    await Promise.all([nodeSave.flush(), projectSave.flush()]);
    const result = await canvasApi.getProject(projectId);
    if (!result.ok) return showToast(errorMessage(result));
    store.state.project = result.data.project;
    store.state.nodes = result.data.nodes || [];
    store.state.edges = result.data.edges || [];
    store.state.runs = result.data.runs || [];
    store.state.selected = null; store.state.connecting = false; store.state.connectionSourceId = null;
    dom.title.value = result.data.project.title;
    renderAll();
    dom.viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
}

async function addNode() {
    if (!store.state.project) { await createProject(); if (!store.state.project) return; }
    const type = dom.nodeType.value;
    const capability = ({ text_generation: 'text', image_generation: 'image', video_generation: 'video', music_generation: 'music' })[type];
    const model = store.state.models.find((item) => item.capability === capability && item.runnable);
    const count = store.state.nodes.length;
    const visibleX = Math.min(2140, Math.max(30, dom.viewport.scrollLeft + 70 + (count % 3) * 270));
    const visibleY = Math.min(1420, Math.max(30, dom.viewport.scrollTop + 70 + Math.floor(count / 3) * 180));
    const body = {
        type, title: copy.nodeTypes[type], x: visibleX, y: visibleY,
        model_id: model?.id || null,
        config: capability ? { prompt: '', ...(capability === 'text' ? { maxTokens: model?.controls?.maxTokens?.default || 500, temperature: .7 } : {}) } : {},
        content: {},
    };
    const result = await canvasApi.createNode(store.state.project.id, body);
    if (!result.ok) return showToast(errorMessage(result));
    store.state.nodes.push(result.data.node); store.state.selected = { kind: 'node', id: result.data.node.id }; renderAll(); showToast(copy.nodeAdded);
}

async function createQuickTextImageVideo() {
    if (!store.state.project) { await createProject(); if (!store.state.project) return; }
    const textModel = store.state.models.find((model) => model.capability === 'text' && model.runnable);
    const imageModel = store.state.models.find((model) => model.capability === 'image' && model.runnable);
    const videoModel = store.state.models.find((model) => model.capability === 'video' && model.runnable && model.controls?.supportsImageInput);
    if (!textModel || !imageModel || !videoModel) return showToast(copy.quickFailed);
    dom.quickTextImageVideo.disabled = true;
    const startX = Math.min(1450, Math.max(50, dom.viewport.scrollLeft + 70));
    const startY = Math.min(1350, Math.max(50, dom.viewport.scrollTop + 100));
    const definitions = [
        { type: 'text_generation', title: copy.nodeTypes.text_generation, x: startX, y: startY, model_id: textModel.id, config: { prompt: isGerman ? 'Erstelle einen präzisen, filmischen Bildgenerierungs-Prompt für eine leuchtende futuristische Stadt zur blauen Stunde.' : 'Create one precise cinematic image-generation prompt for a luminous futuristic city at blue hour.', maxTokens: textModel.controls?.maxTokens?.default || 500, temperature: .7 }, content: {} },
        { type: 'image_generation', title: copy.nodeTypes.image_generation, x: startX + 330, y: startY, model_id: imageModel.id, config: { prompt: '' }, content: {} },
        { type: 'video_generation', title: copy.nodeTypes.video_generation, x: startX + 660, y: startY, model_id: videoModel.id, config: { prompt: isGerman ? 'Animiere das verbundene Bild mit subtiler filmischer Kamerabewegung.' : 'Animate the connected image with subtle cinematic camera movement.', duration: videoModel.controls?.duration?.default || 5, aspectRatio: videoModel.controls?.defaultAspectRatio || '16:9' }, content: {} },
    ];
    const created = [];
    try {
        for (const definition of definitions) {
            const result = await canvasApi.createNode(store.state.project.id, definition);
            if (!result.ok) throw new Error(errorMessage(result));
            created.push(result.data.node); store.state.nodes.push(result.data.node);
        }
        for (let index = 0; index < created.length - 1; index += 1) {
            const result = await canvasApi.createEdge(store.state.project.id, { source_node_id: created[index].id, target_node_id: created[index + 1].id });
            if (!result.ok) throw new Error(errorMessage(result));
            store.state.edges.push(result.data.edge);
        }
        store.state.selected = { kind: 'node', id: created[0].id };
        renderAll(); showToast(copy.quickCreated);
    } catch (error) {
        renderAll(); showToast(error?.message || copy.quickFailed);
    } finally {
        dom.quickTextImageVideo.disabled = false;
    }
}

async function connectNodes(sourceId, targetId) {
    if (sourceId === targetId) return showToast(copy.selfEdge);
    if (store.state.edges.some((edge) => edge.source_node_id === sourceId && edge.target_node_id === targetId)) return showToast(copy.duplicateEdge);
    const result = await canvasApi.createEdge(store.state.project.id, { source_node_id: sourceId, target_node_id: targetId });
    if (!result.ok) return showToast(errorMessage(result));
    store.state.edges.push(result.data.edge); store.state.selected = { kind: 'edge', id: result.data.edge.id }; store.state.connecting = false; store.state.connectionSourceId = null; renderGraph(); renderInspector(); showToast(copy.connected);
}

async function deleteSelection() {
    const selected = store.state.selected;
    if (!selected || !store.state.project) return;
    const confirmed = window.confirm(selected.kind === 'node' ? copy.deleteNode : copy.deleteEdge);
    if (!confirmed) return;
    const result = selected.kind === 'node' ? await canvasApi.deleteNode(store.state.project.id, selected.id) : await canvasApi.deleteEdge(store.state.project.id, selected.id);
    if (!result.ok) return showToast(errorMessage(result));
    if (selected.kind === 'node') {
        store.state.nodes = store.state.nodes.filter((node) => node.id !== selected.id);
        store.state.edges = store.state.edges.filter((edge) => edge.source_node_id !== selected.id && edge.target_node_id !== selected.id);
    } else store.state.edges = store.state.edges.filter((edge) => edge.id !== selected.id);
    store.state.selected = null; renderAll();
}

async function assignAsset(node, assetId) {
    const result = await canvasApi.setAssetReference(store.state.project.id, node.id, assetId);
    if (!result.ok) return showToast(errorMessage(result));
    node.asset_id = result.data.asset.id; node.content = { asset: result.data.asset }; renderGraph(); renderInspector();
}

async function runSelectedNode(node) {
    await Promise.all([nodeSave.flush(), projectSave.flush()]);
    workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
    const validation = validationForNode(node, workflowAnalysis.byNode.get(node.id), copy);
    if (validation) return showToast(validation);
    const model = store.state.models.find((item) => item.id === node.model_id);
    const organizationId = model?.requiresOrganization ? store.state.selectedOrganizationId : null;
    if (model?.requiresOrganization && !organizationId) return showToast(copy.organizationRequired);
    runningNodeId = node.id; renderInspector();
    const status = document.getElementById('canvasNodeRunStatus');
    if (status) status.textContent = copy.running;
    const idempotencyKey = pendingRunKeys.get(node.id) || `canvas-${crypto.randomUUID()}`;
    pendingRunKeys.set(node.id, idempotencyKey);
    const result = await canvasApi.runNode(store.state.project.id, node.id, idempotencyKey, organizationId);
    runningNodeId = null;
    if (!result.ok) {
        if (result.status !== 0 && result.code !== 'canvas_run_in_progress') pendingRunKeys.delete(node.id);
        if (status) { status.textContent = errorMessage(result); status.dataset.kind = 'error'; }
        if (result.data?.run) store.state.runs = [result.data.run, ...store.state.runs.filter((run) => run.id !== result.data.run.id)].slice(0, 40);
        renderInspector(); renderHistory(); showToast(errorMessage(result)); return;
    }
    pendingRunKeys.delete(node.id);
    const run = result.data.run;
    node.output = run.output; node.asset_id = run.asset_id || node.asset_id;
    store.state.runs = [run, ...store.state.runs.filter((item) => item.id !== run.id)].slice(0, 40);
    renderAll(); showToast(copy.runComplete);
}

function renderOrganizations() {
    const organizations = store.state.organizations || [];
    dom.organizationField.hidden = organizations.length === 0;
    dom.organization.replaceChildren();
    if (organizations.length > 1) {
        const placeholder = el('option', '', copy.organizationSelect); placeholder.value = ''; dom.organization.append(placeholder);
    }
    for (const organization of organizations) {
        const option = el('option', '', `${organization.name} · ${organization.role}`);
        option.value = organization.id;
        option.selected = organization.id === store.state.selectedOrganizationId;
        dom.organization.append(option);
    }
}

function resolveCredits(dashboard) {
    const balance = dashboard?.balance || dashboard || {};
    for (const value of [balance.totalCredits, balance.current, balance.available, dashboard?.availableCredits]) {
        if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
    }
    return null;
}

async function loadCredits() {
    try {
        const result = await canvasApi.getCredits();
        const payload = result.data?.dashboard || result.data;
        const credits = result.ok ? resolveCredits(payload) : null;
        dom.credits.textContent = credits === null ? copy.credits : `${credits} ${copy.credits}`;
    } catch { dom.credits.textContent = copy.credits; }
}

function bindEvents() {
    dom.newProject.addEventListener('click', () => void createProject());
    dom.addNode.addEventListener('click', () => void addNode());
    dom.quickTextImageVideo.addEventListener('click', () => void createQuickTextImageVideo());
    dom.organization.addEventListener('change', () => { store.state.selectedOrganizationId = dom.organization.value || null; renderInspector(); });
    dom.connect.addEventListener('click', () => {
        store.state.connecting = !store.state.connecting; store.state.connectionSourceId = null; dom.hint.textContent = store.state.connecting ? copy.connectStart : copy.selectNode; renderGraph();
    });
    dom.deleteSelection.addEventListener('click', () => void deleteSelection());
    dom.title.addEventListener('input', () => {
        if (!store.state.project) return;
        store.state.project.title = dom.title.value;
        projectSave.schedule(store.state.project.id, { title: dom.title.value });
        renderSaveState();
    });
    dom.title.addEventListener('blur', () => void projectSave.flush());
    dom.viewport.addEventListener('click', (event) => {
        if (event.target === dom.viewport || event.target.closest?.('.canvas-surface') === event.target) { store.state.selected = null; renderGraph(); renderInspector(); }
    });
    document.addEventListener('keydown', (event) => {
        if (!['Delete', 'Backspace'].includes(event.key) || !store.state.selected) return;
        if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault(); void deleteSelection();
    });
    window.addEventListener('beforeunload', (event) => {
        if (!nodeSave.pending && !projectSave.pending && store.state.saving === 0) return;
        event.preventDefault(); event.returnValue = '';
    });
}

async function init() {
    try { initSiteHeader({ showCategoryLinks: false, contextLabel: 'Canvas' }); } catch (error) { console.warn(error); }
    initAuthEntryActions();
    bindEvents();

    const projectsResult = await canvasApi.listProjects();
    dom.loading.hidden = true;
    if (!projectsResult.ok) {
        dom.denied.hidden = false;
        dom.app.hidden = true;
        return;
    }

    dom.denied.hidden = true;
    dom.app.hidden = false;
    store.state.projects = projectsResult.data.projects || [];
    const modelsResult = await canvasApi.listModels();
    if (!modelsResult.ok) showToast(errorMessage(modelsResult));
    else {
        store.state.models = modelsResult.data.models || [];
        store.state.organizations = modelsResult.data.organizations || [];
        store.state.selectedOrganizationId = modelsResult.data.selected_organization_id || null;
        store.state.access = modelsResult.data.access || null;
        renderOrganizations();
    }
    renderProjects();
    if (store.state.projects[0]) await openProject(store.state.projects[0].id);
    else { dom.title.value = copy.newProject; renderAll(); }
    void loadCredits();
}

void init();
