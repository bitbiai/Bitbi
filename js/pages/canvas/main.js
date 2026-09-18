import { renderCanvasFullVideo } from './full-video.js?v=__ASSET_VERSION__';
import { videoInputCopy, renderVideoInput, awaitCanvasVideo, canvasVideoRunState } from './video-input.js?v=__ASSET_VERSION__';
import { calculateAiImageCreditCost, calculateAiVideoCreditCost } from '../../shared/ai-model-pricing.mjs?v=__ASSET_VERSION__';
import { estimateCanvasTextCredits } from '../../shared/canvas-model-contract.mjs?v=__ASSET_VERSION__';
import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initAuthEntryActions } from '../../shared/auth-entry-actions.js?v=__ASSET_VERSION__';
import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { createCanvasState, createCanvasSaveQueue } from './state.js?v=__ASSET_VERSION__';
import { createCanvasGraph } from './graph.js?v=__ASSET_VERSION__';
import { analyzeWorkflow, validationForNode, upstreamDisplayNode } from './workflow.js?v=__ASSET_VERSION__';

const isGerman = document.documentElement.lang === 'de';
const copy = isGerman ? {
    saved: 'Gespeichert', saving: 'Wird gespeichert', unsaved: 'Ungespeicherte Änderungen', saveFailed: 'Speichern fehlgeschlagen', retrySave: 'Speichern wiederholen',
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
    saved: 'Saved', saving: 'Saving', unsaved: 'Unsaved changes', saveFailed: 'Save failed', retrySave: 'Retry saving',
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

const videoCopy = videoInputCopy(isGerman);
Object.assign(copy, { videoAmbiguous: videoCopy.ambiguous, videoMethodRequired: videoCopy.required, videoPreparing: videoCopy.preparing });
let videoObservation = new AbortController();
window.addEventListener('pagehide', () => { videoObservation.abort(); inspectorAbort.abort(); });

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
let projectTransition = false;
let toastTimer = 0;
const pendingRunKeys = new Map();
let workflowAnalysis = { byNode: new Map(), edgeStates: new Map() };

// Panel state is presentation-only: retain mounted inputs, media and graph scroll.
const compactWorkspace = window.matchMedia('(max-width: 900px)');
const panelState = { projects: true, detail: 'inspector', mobile: 'graph' };
const panels = Object.fromEntries(['projects', 'graph', 'inspector', 'history'].map((name) => {
    const key = name[0].toUpperCase() + name.slice(1);
    return [name, { panel: document.getElementById(`canvas${key}Panel`), button: document.getElementById(`canvas${key}Toggle`) }];
}));

function syncPanels() {
    const compact = compactWorkspace.matches;
    const active = document.activeElement;
    dom.app.dataset.projects = panelState.projects ? 'open' : 'closed';
    dom.app.dataset.detail = panelState.detail || 'closed';
    for (const [name, { panel, button }] of Object.entries(panels)) {
        const visible = compact ? panelState.mobile === name : name === 'graph' || (name === 'projects' ? panelState.projects : panelState.detail === name);
        panel.hidden = !visible;
        button.setAttribute(name === 'graph' ? 'aria-pressed' : 'aria-expanded', String(visible));
        if (!visible && panel.contains(active)) (compact ? panels.graph.button : button).focus({ preventScroll: true });
    }
    if (!compact && active === panels.graph.button) dom.viewport.focus({ preventScroll: true });
}

function showPanel(name, toggle = false) {
    if (compactWorkspace.matches) panelState.mobile = toggle && panelState.mobile === name ? 'graph' : name;
    else if (name === 'projects') panelState.projects = toggle ? !panelState.projects : true;
    else if (name !== 'graph') panelState.detail = toggle && panelState.detail === name ? null : name;
    syncPanels();
}

function bindPanels() {
    for (const [name, { panel, button }] of Object.entries(panels)) {
        button.addEventListener('click', () => showPanel(name, true));
        panel.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || name === 'graph' || event.defaultPrevented) return;
            event.stopPropagation();
            showPanel(name, true);
            button.focus({ preventScroll: true });
        });
    }
    compactWorkspace.addEventListener('change', syncPanels);
    syncPanels();
}

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
    const messages = {
      canvas_video_review_required: videoCopy.review,
      canvas_video_pending: videoCopy.pending,
      pixverse_extension_unavailable: videoCopy.unavailable,
      text_output_token_limit: isGerman ? 'Das Tokenlimit wurde ohne sichtbare Antwort erreicht. Prüfe Max. Tokens; es wird nicht automatisch erneut generiert.' : 'The token limit was reached without a visible answer. Review Max tokens; generation is not retried automatically.',
      text_output_empty: isGerman ? 'Der Anbieter hat keinen sichtbaren Antworttext geliefert.' : 'The provider returned no visible answer text.',
      text_output_reasoning_only: isGerman ? 'Der Anbieter lieferte nur interne Verarbeitung, keinen sichtbaren Antworttext.' : 'The provider returned reasoning only, without a visible answer.',
      canvas_image_save_unavailable: isGerman ? 'Das generierte Bild ist über den temporären Speicherverweis nicht mehr verfügbar. Keine automatische Neugenerierung; bitte den Betreiber kontaktieren.' : 'The generated image is no longer available through its temporary storage reference. No automatic regeneration; contact the operator.',
      canvas_image_save_pending: isGerman ? 'Bild generiert, Speichern ausstehend. Erneut ausführen wiederholt nur das Speichern, nicht die Generierung.' : 'Image generated; saving is pending. Run again to retry only saving, not generation.',
      insufficient_credits: isGerman ? 'Die ausgewählte Organisation hat nicht genügend Credits.' : 'The selected organization has insufficient credits.',
    };
    return messages[result?.code] || result?.error || copy.networkError;
}

function renderSaveState() {
    const node = nodeSave.status;
    const project = projectSave.status;
    const saving = node.inflight + project.inflight;
    const saveError = node.failed + project.failed > 0;
    const pending = node.pending + project.pending > 0;
    const value = saveError ? copy.saveFailed : saving > 0 ? copy.saving : pending ? copy.unsaved : copy.saved;
    dom.save.textContent = value;
    dom.save.dataset.state = saveError ? 'error' : saving > 0 ? 'saving' : pending ? 'unsaved' : 'saved';
    retrySave.hidden = !saveError;
    retrySave.disabled = saving > 0;
}

// Keep object identities used by inspector and drag handlers. An old full-record
// reply may confirm only its own fields, never replace newer edits or outputs.
function applyConfirmedPatch(target, confirmed, patch, pending) {
    if (!target || !confirmed) return;
    for (const key of Object.keys(patch)) {
        if (Object.prototype.hasOwnProperty.call(pending, key)) continue;
        if (JSON.stringify(target[key]) === JSON.stringify(patch[key])) target[key] = confirmed[key];
    }
    target.updated_at = confirmed.updated_at;
}

function checkedSaveResult(result, record, id, patch, projectId = null) {
    if (!result.ok) return result;
    const valid = record && !Array.isArray(record) && record.id === id
        && (!projectId || record.project_id === projectId)
        && Object.keys(patch).every((key) => Object.prototype.hasOwnProperty.call(record, key));
    return valid ? result : { ok: false, code: 'invalid_save_response', error: copy.networkError };
}

const projectSave = createCanvasSaveQueue({
    save: async (projectId, patch) => {
        const result = await canvasApi.updateProject(projectId, patch);
        return checkedSaveResult(result, result.data?.project, projectId, patch);
    },
    delay: 650,
    onChange: renderSaveState,
    onError: (result) => showToast(errorMessage(result)),
    onConfirm(result, { identity: [projectId], patch, pending }) {
        const project = store.state.projects.find((item) => item.id === projectId);
        applyConfirmedPatch(project, result.data.project, patch, pending);
        if (store.state.project?.id === projectId) applyConfirmedPatch(store.state.project, result.data.project, patch, pending);
        renderProjects();
    },
});

const nodeSave = createCanvasSaveQueue({
    save: async (projectId, nodeId, patch) => {
        const result = await canvasApi.updateNode(projectId, nodeId, patch);
        return checkedSaveResult(result, result.data?.node, nodeId, patch, projectId);
    },
    onChange: renderSaveState,
    onError: (result) => showToast(errorMessage(result)),
    onConfirm(result, { identity: [projectId, nodeId], patch, pending }) {
        if (store.state.project?.id !== projectId) return;
        const node = store.state.nodes.find((item) => item.id === nodeId);
        applyConfirmedPatch(node, result.data.node, patch, pending);
        // Replacing graph DOM here would interrupt a drag whose pointer is
        // still captured. Local graph/inspector objects already contain edits.
        if (!dom.nodes.querySelector('.is-dragging') && !dom.nodes.contains(document.activeElement)) renderGraph();
    },
});

const retrySave = el('button', 'canvas-button', copy.retrySave);
retrySave.id = 'canvasRetrySave';
retrySave.type = 'button';
retrySave.hidden = true;
dom.save.after(retrySave);
retrySave.addEventListener('click', () => void flushSaves());

async function flushSaves() {
    do {
        const results = await Promise.all([nodeSave.flush(), projectSave.flush()]);
        if (!results.every(Boolean)) { showToast(copy.saveFailed); return false; }
    } while (nodeSave.dirty || projectSave.dirty);
    return true;
}

async function withProjectTransition(task) {
    if (projectTransition || runningNodeId) return false;
    projectTransition = true;
    dom.app.inert = true;
    try {
        if (!await flushSaves()) return false;
        return await task();
    } finally {
        projectTransition = false;
        dom.app.inert = false;
    }
}

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
        const rename = el('button', 'canvas-project-item__menu');
        const pencil = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'aria-hidden': 'true', focusable: 'false' })) pencil.setAttribute(name, value);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'm16 3 5 5-12 12-6 1 1-6z M14 5l5 5');
        pencil.append(path); rename.append(pencil);
        rename.type = 'button';
        rename.setAttribute('aria-label', `${copy.renamePrompt}: ${project.title}`);
        rename.title = copy.renamePrompt;
        rename.addEventListener('click', () => void renameProject(project));
        const remove = el('button', 'canvas-project-item__menu canvas-project-item__menu--danger', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${isGerman ? 'Canvas löschen' : 'Delete Canvas'}: ${project.title}`);
        remove.title = isGerman ? 'Canvas löschen' : 'Delete Canvas';
        remove.addEventListener('click', () => void deleteProject(project));
        actions.append(rename, remove);
        item.append(open, actions);
        dom.projects.append(item);
    }
}

function renderGraph() {
    workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
    graph.render({ ...store.state, copy, nodeAnalysis: workflowAnalysis.byNode, edgeStates: workflowAnalysis.edgeStates });
    store.state.nodes.forEach(renderVideoStatus);
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
        top.append(el('span', '', node?.title || run.model_id), el('strong', '', run.video_job_id ? videoCopy.statuses[run.video_job_status || run.status] || run.status : run.status));
        const kind = run.output?.kind ? ` · ${run.output.kind}` : '';
        item.append(top, el('small', '', `${run.model_id}${kind} · ${new Date(run.updated_at).toLocaleString(isGerman ? 'de-DE' : 'en-US')}`));
        item.addEventListener('click', () => {
            if (!node) return;
            node.output = run.output || node.output;
            store.state.selected = { kind: 'node', id: node.id };
            renderGraph(); renderInspector();
            showPanel('inspector');
            dom.inspectorTitle.focus({ preventScroll: true });
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
    nodeSave.schedule(node.project_id, node.id, patch);
    renderSaveState();
}

function scheduleProject(projectId, patch) {
    const project = store.state.projects.find((item) => item.id === projectId);
    if (project) Object.assign(project, patch);
    if (store.state.project?.id === projectId) Object.assign(store.state.project, patch);
    projectSave.schedule(projectId, patch);
}

function bindConfig(node, control, key, parser = (value) => value) {
    control.addEventListener('input', () => {
        const config = { ...(node.config || {}), [key]: parser(control.type === 'checkbox' ? control.checked : control.value) };
        scheduleNode(node, { config });
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
        if (output.previewUrl || output.asset.preview_url) video.poster = output.previewUrl || output.asset.preview_url;
        renderCanvasFullVideo({ section, output, projectId: store.state.project.id, german: isGerman, signal: inspectorAbort.signal, video });
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
            if (source.videoInput) renderVideoInput({ source, model: analysis.model, section, projectId: store.state.project.id,
                edge: store.state.edges.find(edge => edge.id === source.edgeId), beforePrepare: flushSaves, signal: inspectorAbort.signal, copy: videoCopy,
                update(edge, focus) { store.upsertEdge(edge); renderGraph(); renderInspector(); if (focus) dom.inspector.querySelector(`[data-video-method="${edge.id}"]`)?.focus({ preventScroll: true }); }, report: showToast });
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

let inspectorAbort = new AbortController();
function renderInspector() {
    inspectorAbort.abort(); inspectorAbort = new AbortController();
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
            scheduleNode(node, { content });
        });
        dom.inspector.append(field(copy.text, text));
    }

    const capability = ({ text_generation: 'text', image_generation: 'image', video_generation: 'video', music_generation: 'music' })[node.type];
    if (capability) {
        workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
        const models = store.state.models.filter((model) => model.capability === capability);
        const model = models.find((item) => item.id === node.model_id) || models.find((item) => item.runnable) || null;
        const modelSelect = selectControl(models.map((item) => ({ value: item.id, label: `${item.label}${item.runnable ? '' : ` — ${copy.disabled}`}` })), model?.id);
        modelSelect.addEventListener('change', () => {
            // Only replace an unchanged model default. Explicit values survive
            // a switch and the selected model's validator checks their limits.
            const next = models.find(item => item.id === modelSelect.value);
            const config = { ...(node.config || {}) };
            if (capability === 'text' && !config.maxTokensEdited && (config.maxTokens == null || config.maxTokens === model?.controls?.maxTokens?.default)) config.maxTokens = next?.controls?.maxTokens?.default;
            scheduleNode(node, { model_id: modelSelect.value, config }); window.setTimeout(renderInspector);
        });
        dom.inspector.append(field(copy.model, modelSelect));
        if (model) {
            dom.inspector.append(el('p', 'canvas-model-note', model.runnable ? model.description : model.disabledReason));
            const cost = el('p', 'canvas-cost-note');
            const updateCost = () => {
                const budget = model.requiresPlatformBudget && model.runnable ? (isGerman ? 'Plattformbudget' : 'Platform budget') : model.requiresOrganization ? (isGerman ? 'Credits der ausgewählten Organisation' : 'Selected organization credits') : (isGerman ? 'Persönliche Credits' : 'Personal credits');
                let estimate = model.estimatedCredits;
                try {
                    if (capability === 'video' && model.id === 'pixverse/v6' && model.runnable) estimate = calculateAiVideoCreditCost(model.id, { ...node.config, duration: Number(node.config?.duration || model.controls.duration.default), quality: node.config?.quality || model.controls.defaultQuality, generateAudio: node.config?.generateAudio !== false })?.credits;
                    if (capability === 'image' && model.runnable) estimate = calculateAiImageCreditCost(model.id, { ...node.config, referenceImageCount: workflowAnalysis.byNode.get(node.id)?.compatible?.filter(item => item.inputKind === 'image_reference').length || 0 })?.credits;
                    if (capability === 'text' && model.requiresPersonalCredits) estimate = estimateCanvasTextCredits(model.id, node.config || {});
                } catch { estimate = null; }
                cost.textContent = model.requiresPlatformBudget && model.runnable ? budget : `${budget} · ${copy.estimated}: ${estimate ?? '—'}`;
                if (model.controls?.supportsReferenceImages) cost.append(document.createTextNode(isGerman ? ' · Endgültige Kosten werden serverseitig einschließlich Referenzen geprüft.' : ' · Final cost is checked server-side including references.'));
            };
            updateCost();
            dom.inspector.addEventListener('input', updateCost, { signal: inspectorAbort.signal });
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
            const maxTokens = inputControl(node.config?.maxTokens ?? model?.controls?.maxTokens?.default ?? 500, 'number'); maxTokens.min = '1'; maxTokens.max = String(model?.controls?.maxTokens?.max || 4096); maxTokens.addEventListener('input', () => scheduleNode(node, { config: { ...node.config, maxTokens: Number(maxTokens.value), maxTokensEdited: true } }));
            const temperature = inputControl(node.config?.temperature ?? .7, 'number'); temperature.min = '0'; temperature.max = '1.5'; temperature.step = '.1'; bindConfig(node, temperature, 'temperature', (value) => Number(value));
            grid.append(field(copy.maxTokens, maxTokens), field(copy.temperature, temperature)); dom.inspector.append(grid);
        }
        if (capability === 'image' && model) {
            const c = model.controls || {}, grid = el('div', 'canvas-field-grid');
            const numberOption = (key, label, fallback, min, max, step = 1) => {
                const control = inputControl(node.config?.[key] ?? fallback ?? '', 'number');
                control.min = String(min); control.max = String(max); control.step = String(step);
                bindConfig(node, control, key, value => value === '' ? '' : Number(value)); grid.append(field(label, control));
            };
            if (c.supportsSafetyTolerance) numberOption('safetyTolerance', isGerman ? 'Sicherheitstoleranz' : 'Safety tolerance', c.defaultSafetyTolerance, c.minSafetyTolerance, c.maxSafetyTolerance);
            if (c.supportsSteps) numberOption('steps', isGerman ? 'Schritte' : 'Steps', c.defaultSteps, 1, c.maxSteps);
            if (c.supportsSeed) numberOption('seed', 'Seed', '', 0, 2147483647);
            if (c.supportsDimensions) {
                numberOption('width', isGerman ? 'Breite' : 'Width', c.defaultSize?.width, c.minDimension, c.maxDimension, 64);
                numberOption('height', isGerman ? 'Höhe' : 'Height', c.defaultSize?.height, c.minDimension, c.maxDimension, 64);
            }
            for (const [key, options, value, label] of [
                ['quality', c.qualityOptions, c.defaultQuality, isGerman ? 'Qualität' : 'Quality'],
                ['size', c.sizeOptions, typeof c.defaultSize === 'string' ? c.defaultSize : null, isGerman ? 'Größe' : 'Size'],
                ['outputFormat', c.outputFormatOptions, c.defaultOutputFormat, isGerman ? 'Dateiformat' : 'File format'],
                ['background', c.backgroundOptions, c.defaultBackground, isGerman ? 'Hintergrund' : 'Background'],
            ]) {
                if (!options?.length) continue;
                const control = selectControl(options.map(value => ({ value, label: value })), node.config?.[key] || value);
                bindConfig(node, control, key); grid.append(field(label, control));
            }
            dom.inspector.append(grid);
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
        const videoState = canvasVideoRunState(store.state.runs, node.id, videoCopy);
        const status = el('div', 'canvas-run-status', runningNodeId === node.id ? copy.running : videoState.message); status.id = 'canvasNodeRunStatus'; status.setAttribute('role', 'status'); dom.inspector.append(status);
        const run = el('button', 'canvas-button canvas-button--primary', runningNodeId === node.id ? copy.running : copy.run);
        run.type = 'button'; run.disabled = runningNodeId === node.id || canvasVideoRunState(store.state.runs, node.id, videoCopy).blocked || !model?.runnable || Boolean(inputContext.validation); run.addEventListener('click', () => void runSelectedNode(node)); dom.inspector.append(run);
        prompt.addEventListener('input', () => {
            const current = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy).byNode.get(node.id);
            run.disabled = runningNodeId === node.id || canvasVideoRunState(store.state.runs, node.id, videoCopy).blocked || !model?.runnable || Boolean(validationForNode(node, current, copy));
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
    onMoveEnd(node) { scheduleNode(node, { x: node.x, y: node.y }); },
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
    return withProjectTransition(async () => {
        const result = await canvasApi.createProject({ title: title.trim(), locale: isGerman ? 'de' : 'en' });
        if (!result.ok) return showToast(errorMessage(result));
        store.state.projects.unshift(result.data.project);
        if (await loadProject(result.data.project.id)) showToast(copy.projectCreated);
    });
}

async function renameProject(project) {
    const next = window.prompt(copy.renamePrompt, project.title);
    if (next === null) return;
    if (next.trim() && next.trim() !== project.title) {
        scheduleProject(project.id, { title: next.trim() });
        if (store.state.project?.id === project.id) dom.title.value = next.trim();
        renderProjects();
        await projectSave.flush(project.id);
    }
}

async function deleteProject(project) {
    if (!window.confirm(copy.deleteProject)) return;
    return withProjectTransition(async () => {
        const deleted = await canvasApi.deleteProject(project.id);
        if (!deleted.ok) return showToast(errorMessage(deleted));
        store.state.projects = store.state.projects.filter((item) => item.id !== project.id);
        if (store.state.project?.id === project.id) {
            store.state.project = null; store.state.nodes = []; store.state.edges = []; store.state.runs = [];
            if (store.state.projects[0]) await loadProject(store.state.projects[0].id); else { dom.title.value = copy.newProject; renderAll(); }
        } else renderProjects();
        showToast(copy.projectDeleted);
    });
}

function openProject(projectId) {
    return withProjectTransition(() => loadProject(projectId));
}

async function loadProject(projectId) {
    videoObservation.abort(); videoObservation = new AbortController();
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
    for (const run of store.state.runs.filter(run => run.error_code === 'canvas_video_pending' && run.retry_key)) {
        const node = store.state.nodes.find(node => node.id === run.node_id);
        if (node) void observeVideo(node, projectId, run.retry_key, run.video_job_id, null);
    }
    return true;
}

async function addNode() {
    if (!store.state.project) { await createProject(); if (!store.state.project) return; }
    const projectId = store.state.project.id;
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
    const result = await canvasApi.createNode(projectId, body);
    if (!result.ok) return showToast(errorMessage(result));
    if (store.state.project?.id !== projectId) return;
    if (!store.state.nodes.some((node) => node.id === result.data.node.id)) store.state.nodes.push(result.data.node);
    store.state.selected = { kind: 'node', id: result.data.node.id }; renderAll(); showToast(copy.nodeAdded);
}

async function createQuickTextImageVideo() {
    if (!store.state.project) { await createProject(); if (!store.state.project) return; }
    const projectId = store.state.project.id;
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
            const result = await canvasApi.createNode(projectId, definition);
            if (!result.ok) throw new Error(errorMessage(result));
            created.push(result.data.node);
            if (store.state.project?.id === projectId && !store.state.nodes.some((node) => node.id === result.data.node.id)) store.state.nodes.push(result.data.node);
        }
        for (let index = 0; index < created.length - 1; index += 1) {
            const result = await canvasApi.createEdge(projectId, { source_node_id: created[index].id, target_node_id: created[index + 1].id });
            if (!result.ok) throw new Error(errorMessage(result));
            if (store.state.project?.id === projectId && !store.state.edges.some((edge) => edge.id === result.data.edge.id)) store.state.edges.push(result.data.edge);
        }
        if (store.state.project?.id === projectId) {
            store.state.selected = { kind: 'node', id: created[0].id };
            renderAll(); showToast(copy.quickCreated);
        }
    } catch (error) {
        if (store.state.project?.id === projectId) renderAll();
        showToast(error?.message || copy.quickFailed);
    } finally {
        dom.quickTextImageVideo.disabled = false;
    }
}

async function connectNodes(sourceId, targetId) {
    if (sourceId === targetId) return showToast(copy.selfEdge);
    if (store.state.edges.some((edge) => edge.source_node_id === sourceId && edge.target_node_id === targetId)) return showToast(copy.duplicateEdge);
    const projectId = store.state.project.id;
    const result = await canvasApi.createEdge(projectId, { source_node_id: sourceId, target_node_id: targetId });
    if (!result.ok) return showToast(errorMessage(result));
    if (store.state.project?.id !== projectId) return;
    if (!store.state.edges.some((edge) => edge.id === result.data.edge.id)) store.state.edges.push(result.data.edge);
    store.state.selected = { kind: 'edge', id: result.data.edge.id }; store.state.connecting = false; store.state.connectionSourceId = null; renderGraph(); renderInspector(); showToast(copy.connected);
}

async function deleteSelection() {
    const selected = store.state.selected;
    if (!selected || !store.state.project) return;
    const confirmed = window.confirm(selected.kind === 'node' ? copy.deleteNode : copy.deleteEdge);
    if (!confirmed) return;
    return withProjectTransition(async () => {
        const result = selected.kind === 'node' ? await canvasApi.deleteNode(store.state.project.id, selected.id) : await canvasApi.deleteEdge(store.state.project.id, selected.id);
        if (!result.ok) return showToast(errorMessage(result));
        if (selected.kind === 'node') {
            store.state.nodes = store.state.nodes.filter((node) => node.id !== selected.id);
            store.state.edges = store.state.edges.filter((edge) => edge.source_node_id !== selected.id && edge.target_node_id !== selected.id);
        } else store.state.edges = store.state.edges.filter((edge) => edge.id !== selected.id);
        store.state.selected = null; renderAll();
    });
}

async function assignAsset(node, assetId) {
    return withProjectTransition(async () => {
        const result = await canvasApi.setAssetReference(node.project_id, node.id, assetId);
        if (!result.ok) return showToast(errorMessage(result));
        node.asset_id = result.data.asset.id; node.content = { asset: result.data.asset }; renderGraph(); renderInspector();
    });
}

async function runSelectedNode(node) {
    if (runningNodeId || projectTransition || canvasVideoRunState(store.state.runs, node.id, videoCopy).blocked) return;
    // Freeze editing only while the exact graph for this run is being saved.
    // The API request itself is not treated as cancelled by a browser close.
    let saved = false;
    await withProjectTransition(async () => {
        runningNodeId = node.id;
        saved = true;
    });
    if (!saved) return;
    workflowAnalysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy);
    const validation = validationForNode(node, workflowAnalysis.byNode.get(node.id), copy);
    if (validation) { runningNodeId = null; return showToast(validation); }
    const model = store.state.models.find((item) => item.id === node.model_id);
    const organizationId = model?.requiresOrganization ? store.state.selectedOrganizationId : null;
    if (model?.requiresOrganization && !organizationId) { runningNodeId = null; return showToast(copy.organizationRequired); }
    runningNodeId = node.id; renderInspector();
    const status = document.getElementById('canvasNodeRunStatus');
    if (status) status.textContent = copy.running;
    const pendingSave = store.state.runs.find(run => run.node_id === node.id && run.retry_key);
    const idempotencyKey = pendingRunKeys.get(node.id) || pendingSave?.retry_key || `canvas-${crypto.randomUUID()}`;
    pendingRunKeys.set(node.id, idempotencyKey);
    const projectId = store.state.project.id;
    const result = await canvasApi.runNode(projectId, node.id, idempotencyKey, organizationId);
    if (store.state.project?.id !== projectId || !store.state.nodes.includes(node)) { runningNodeId = null; return; }
    if (result.code === 'canvas_video_pending') {
        runningNodeId = null;
        store.addRun(result.data.run); renderAll(); showToast(videoCopy.pending);
        void observeVideo(node, projectId, idempotencyKey, result.data?.video_job_id, organizationId);
        return;
    }
    runningNodeId = null;
    if (!result.ok) {
        if (result.status !== 0 && !['canvas_run_in_progress', 'canvas_image_save_pending', 'canvas_image_save_unavailable', 'image_save_reference_missing', 'image_save_checkpoint_failed'].includes(result.code)) pendingRunKeys.delete(node.id);
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

// Update status text without rebuilding focused inputs or interrupting media.
function renderVideoStatus(node) {
    const state = canvasVideoRunState(store.state.runs, node.id, videoCopy);
    if (!state.run?.video_job_id) return;
    const status = store.state.selected?.id === node.id && document.getElementById('canvasNodeRunStatus');
    if (status) status.textContent = state.message;
    const badge = dom.nodes.querySelector(`[data-node-id="${node.id}"] .canvas-node__status`);
    if (badge) {
        badge.textContent = videoCopy.statuses[state.run.video_job_status || state.run.status] || videoCopy.statuses.running;
        badge.dataset.status = state.run.status;
    }
}

const observedVideos = new Map();
async function observeVideo(node, projectId, key, jobId, organizationId) {
    const signal = videoObservation.signal;
    if (observedVideos.get(key) === signal) return;
    observedVideos.set(key, signal);
    const result = await awaitCanvasVideo({ projectId, nodeId: node.id, key, jobId, organizationId, signal, onJob(job) {
        if (signal.aborted || store.state.project?.id !== projectId || !store.state.nodes.includes(node)) return;
        const run = store.state.runs.find(item => item.video_job_id === jobId);
        if (run) {
            run.video_job_status = job.status; run.observation_error = false;
            renderVideoStatus(node);
            renderHistory();
        }
    } });
    if (observedVideos.get(key) === signal) observedVideos.delete(key);
    if (signal.aborted || store.state.project?.id !== projectId || !store.state.nodes.includes(node)) return;
    if (!result.ok) {
        if (result.data?.run) store.addRun(result.data.run);
        else { const run = store.state.runs.find(item => item.video_job_id === jobId); if (run) run.observation_error = true; }
        renderVideoStatus(node); renderHistory(); showToast(canvasVideoRunState(store.state.runs, node.id, videoCopy).message); return;
    }
    const run = result.data.run;
    node.output = run.output; node.asset_id = run.asset_id; pendingRunKeys.delete(node.id);
    store.state.runs = [run, ...store.state.runs.filter(item => item.id !== run.id)].slice(0, 40);
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
        dom.credits.textContent = credits === null ? copy.credits : `${credits} ${isGerman ? 'persönliche Credits' : 'personal credits'}`;
    } catch { dom.credits.textContent = copy.credits; }
}

function bindEvents() {
    bindPanels();
    document.getElementById('canvasReload').addEventListener('click', () => window.location.reload());
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
        scheduleProject(store.state.project.id, { title: dom.title.value });
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
        if (!nodeSave.dirty && !projectSave.dirty && !runningNodeId) return;
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
        const denied = [401, 403].includes(projectsResult.status);
        dom.denied.hidden = !denied;
        document.getElementById('canvasUnavailable').hidden = denied;
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
