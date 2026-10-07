import { transitionControls } from './transition-controls.js?v=__ASSET_VERSION__';
import { createWorkspaceView } from './workspace-view.js?v=__ASSET_VERSION__';
import { canvasMergeStrand } from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';
import { SEEDANCE_25_MODEL, SEEDANCE_25_ROLES } from '../../shared/seedance-25-contract.mjs';
import { createSeedance25Controls } from '../../shared/seedance-25-controls.js';
import { modelAreaState } from '../../shared/model-availability.js';
import { refreshModelPricing } from '../../shared/model-pricing-client.js';
import { uploadOmniReference } from '../../shared/omni-reference-upload.js';
import { OMNI_MODEL, OMNI_ROLES } from '../../shared/gemini-omni-contract.mjs';
import { omniMemberAvailable } from '../../shared/gemini-omni-pricing.mjs';
import { isGptImage25Model } from '../../shared/gpt-image-25-contract.mjs?v=__ASSET_VERSION__';
import { sortGenerationModels } from '../../shared/generation-model-order.mjs?v=__ASSET_VERSION__';
import { imageDimensionChoices } from '../../shared/image-dimensions.mjs?v=__ASSET_VERSION__';
import { renderCanvasImageReferences } from './image-references.js?v=__ASSET_VERSION__';
import { h3ReferenceError } from '../../shared/minimax-h3.mjs?v=__ASSET_VERSION__';
import { H3_MODEL, H3_ROLES, h3MediaType } from '../../shared/minimax-h3.mjs?v=__ASSET_VERSION__';
import { h3RoleLabel } from '../../shared/h3-reference-controls.js?v=__ASSET_VERSION__';
import { renderCanvasFullVideo } from './full-video.js?v=__ASSET_VERSION__';
import { canvasAudioControls } from './audio-controls.js?v=__ASSET_VERSION__';
import { canvasDisclosure, rememberCanvasDisclosures, hasCompletedMedia, inspectorRunError } from './inspector-disclosure.js?v=__ASSET_VERSION__';
import { canvasNodeMediaKind } from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';
import { EXPORT_MUSIC_PURPOSE, isExportMusic } from '../../shared/canvas-export.mjs?v=__ASSET_VERSION__';
import { createMemberMusicControls } from '../../shared/member-music-controls.js?v=__ASSET_VERSION__';
import { elevenLabsMemberBody } from '../../shared/member-music-contract.mjs?v=__ASSET_VERSION__';
import { videoInputCopy, renderVideoInput, awaitCanvasVideo, canvasVideoRunState } from './video-input.js?v=__ASSET_VERSION__';
import { calculateAiImageCreditCost, calculateAiVideoCreditCost, calculateAiModelCreditCost } from '../../shared/ai-model-pricing.mjs?v=__ASSET_VERSION__';
import { estimateCanvasTextCredits, CANVAS_TEXT_PURPOSES, CANVAS_TEXT_DEFAULT_PURPOSE, getCanvasTextInstructions } from '../../shared/canvas-model-contract.mjs?v=__ASSET_VERSION__';
import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initAuthEntryActions } from '../../shared/auth-entry-actions.js?v=__ASSET_VERSION__';
import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { createCanvasAssetPicker } from './asset-picker.js?v=__ASSET_VERSION__';
import { createCanvasState, createCanvasSaveQueue } from './state.js?v=__ASSET_VERSION__';
import { createCanvasGraph } from './graph.js?v=__ASSET_VERSION__';
import { analyzeWorkflow, validationForNode, upstreamDisplayNode, nodeOutputValue } from './workflow.js?v=__ASSET_VERSION__';

const isGerman = document.documentElement.lang === 'de';
const copy = isGerman ? {
    saved: 'Gespeichert', saving: 'Wird gespeichert', unsaved: 'Ungespeicherte Änderungen', saveFailed: 'Speichern fehlgeschlagen', retrySave: 'Speichern wiederholen',
    newProject: 'Neue Canvas', projectPrompt: 'Name der Canvas', renamePrompt: 'Canvas umbenennen', deleteProject: 'Diese Canvas löschen? Gespeicherte Assets bleiben erhalten. Ungespeicherte Canvas-Medien werden entfernt, sobald sie nicht mehr benötigt werden.',
    deleteNode: 'Diesen Node löschen? Gespeicherte Assets bleiben erhalten. Ungespeicherte Ausgaben werden entfernt, sobald sie nicht mehr benötigt werden.', deleteEdge: 'Diese Verbindung löschen?',
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
    mediaRoleChanged: 'Die gespeicherte Eingaberolle passt nicht zum Medientyp. Bitte eine passende Rolle auswählen.',
    modelDisabled: 'Dieses Modell wurde vorübergehend deaktiviert.', promptRequired: 'Füge einen direkten Prompt hinzu oder verbinde einen Text-Node.', selectedModel: 'Das ausgewählte Modell', imageInputUnsupported: '{model} unterstützt in Canvas keinen Bild-Input.', videoInputUnsupported: '{model} unterstützt in Canvas keinen Video-Input, keine Fortsetzung und keine Erweiterung.', audioInputUnsupported: 'Das ausgewählte Modell akzeptiert keinen Audio-Asset-Input.', jsonInputUnsupported: 'Das ausgewählte Modell akzeptiert keinen JSON-Workflow-Input.', noUsableOutput: 'Die verbundene Quelle hat noch keine nutzbare Ausgabe.',
    quickCreated: 'Text → Bild → Video wurde erstellt. Führe die Nodes von links nach rechts aus.', quickFailed: 'Der schnelle Workflow konnte nicht vollständig erstellt werden.', organizationSelect: 'Organisation auswählen', organizationRequired: 'Wähle eine aktive Organisation für dieses Modell.',
} : {
    saved: 'Saved', saving: 'Saving', unsaved: 'Unsaved changes', saveFailed: 'Save failed', retrySave: 'Retry saving',
    newProject: 'New Canvas', projectPrompt: 'Canvas name', renamePrompt: 'Rename Canvas', deleteProject: 'Delete this Canvas? Saved Assets are kept. Unsaved Canvas media will be removed when no longer in use.',
    deleteNode: 'Delete this node? Saved Assets are kept. Unsaved output will be removed when no longer in use.', deleteEdge: 'Delete this connection?',
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
    mediaRoleChanged: 'The saved input role does not match this media type. Choose a compatible role.',
    modelDisabled: 'This model has been temporarily disabled.', promptRequired: 'Add a direct prompt or connect a text node.', selectedModel: 'The selected model', imageInputUnsupported: '{model} does not support image input in Canvas.', videoInputUnsupported: '{model} does not support video input, continuation, or extension in Canvas.', audioInputUnsupported: 'The selected model does not accept an audio asset input.', jsonInputUnsupported: 'The selected model does not accept JSON workflow input.', noUsableOutput: 'The connected source has no usable output yet.',
    quickCreated: 'Text → Image → Video was created. Run the nodes from left to right.', quickFailed: 'The quick workflow could not be fully created.', organizationSelect: 'Select organization', organizationRequired: 'Select an active organization for this model.',
};

let workspaceView;
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
const assetPicker = createCanvasAssetPicker({ german: isGerman, onApply: assignAsset });
let legacyAssetLabels;
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
    const referenceError=h3ReferenceError(result?.code,isGerman);if(referenceError)return referenceError;
    if (result?.code === 'canvas_run_in_progress') return copy.runInProgress;
    const messages = {
      canvas_video_review_required: videoCopy.review,
      canvas_video_rejected: videoCopy.rejected,
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
    updateContributors();
    workspaceView?.refresh();
}

function updateContributors() {
    const node = selectedNode();
    graph.contributors(canvasNodeMediaKind(node)==='video'
        ? canvasMergeStrand(store.state.nodes, store.state.edges, node.id) : null);
    document.dispatchEvent(new Event('canvas:merge-state'));
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
            if (run.status === 'completed' && run.output) node.output = { ...run.output, runId: run.id };
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
    if (Object.hasOwn(patch, 'title')) document.dispatchEvent(new Event('canvas:merge-state'));
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
        // Keep the controls below this player stationary while metadata or a
        // differently shaped poster arrives. object-fit preserves the source.
        video.style.aspectRatio = '16 / 9';
        if (output.previewUrl || output.asset.preview_url) video.poster = output.previewUrl || output.asset.preview_url;
        const music=store.state.edges.filter(edge=>edge.target_node_id===node.id && isExportMusic(edge.config))
            .map(edge=>nodeOutputValue(store.state.nodes.find(source=>source.id===edge.source_node_id)));
        const settingsNode=store.state.nodes.find(item=>item.id===node.id)||node;
        const sound=canvasAudioControls({section,video,german:isGerman,signal:inspectorAbort.signal,original:node.config?.originalAudio,
            backgroundMusic:node.config?.backgroundMusic,tracks:music.filter(track=>track.kind==='audio_asset'&&track.assetId),
            onChange:values=>scheduleNode(settingsNode,{config:{...settingsNode.config,...values}})});
        renderCanvasFullVideo({ section, output, projectId: store.state.project.id, german: isGerman, signal: inspectorAbort.signal, video,
            music, sound,readSmooth:()=>settingsNode.config?.smoothJoins===true,
            writeSmooth:value=>scheduleNode(settingsNode,{config:{...settingsNode.config,smoothJoins:value}}),
            flush:()=>nodeSave.flush(),
            getGraph:()=>({projectId:store.state.project?.id,nodes:store.state.nodes,edges:store.state.edges,models:store.state.models}) });
    } else if (output.kind === 'audio' && output.asset?.file_url) {
        const audio = el('audio'); audio.src = output.asset.file_url; audio.controls = true; audio.preload = 'metadata'; section.append(audio);
    } else if (output.kind === 'file' && output.asset?.file_url) {
        const label = node.config?.assetReferenceLabel;
        if (label?.id === output.asset.id && label.preview) section.append(el('pre', '', label.preview));
        const link = el('a', 'canvas-button', isGerman ? 'Datei öffnen' : 'Open file');
        link.href = output.asset.file_url; link.target = '_blank'; link.rel = 'noopener'; section.append(link);
    } else section.append(el('p', 'canvas-muted', copy.outputEmpty));
    if (output.storage === 'canvas' && output.runId) {
        const projectId=store.state.project.id, signal=inspectorAbort.signal;
        const save = el('button','canvas-button',isGerman ? 'In Assets speichern' : 'Save to Assets'); save.type='button';
        save.addEventListener('click',async()=>{
            save.disabled=true;
            const result=await canvasApi.saveOutput(projectId,output.runId);
            if(signal.aborted)return;
            if (!result.ok) {showToast(result.error);save.disabled=false;return;}
            output.storage='assets';save.textContent=isGerman?'In Assets gespeichert':'Saved to Assets';
        }); section.append(save);
    }
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
                : asset.asset_type === 'video' || mime.startsWith('video/') ? 'video' : 'file';
        return { ...resolved, output: { kind, asset, nodeId:resolved.id, sourceVersion:asset.sourceVersion } };
    }
    return resolved;
}

function omniCanvasInput(node) {
    const analysis = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy).byNode.get(node.id);
    return { resolution: node.config?.resolution || '720p', aspect_ratio: node.config?.aspectRatio || '16:9',
        references: (analysis?.compatible || []).filter(source => source.assetId).map(source => ({ role: source.h3Role, source: { source_type: 'saved_asset', asset_id: source.assetId } })) };
}
function omniCanvasBlocked(node) {
    return node.model_id === OMNI_MODEL && !omniMemberAvailable(omniCanvasInput(node));
}

function renderInputContext(node, analysis) {
    const section = el('section', 'canvas-input-context');
    section.append(el('strong', '', copy.connectedInput));
    if (!analysis.sources.length) section.append(el('p', 'canvas-muted', copy.noInput));
    if (analysis.sources.length) {
        for (const source of analysis.sources) {
            const message = source.status === 'compatible'
                ? `${source.sourceTitle}: ${source.inputKind}`
                : `${source.sourceTitle}: ${source.reason}`;
            section.append(el('p', '', message));
            if([H3_MODEL,OMNI_MODEL,SEEDANCE_25_MODEL].includes(analysis.model?.id) && source.assetId && ([OMNI_MODEL,SEEDANCE_25_MODEL].includes(analysis.model?.id) || source.kind !== 'video_asset')) {
                const select=el('select','canvas-select');select.dataset.h3Role=source.edgeId;
                const media=source.kind==='video_asset'?'video':source.kind==='audio_asset'?'audio':'image';
                for(const role of (analysis.model?.id===SEEDANCE_25_MODEL?SEEDANCE_25_ROLES:analysis.model?.id===OMNI_MODEL?OMNI_ROLES:H3_ROLES).filter(role=>h3MediaType(role)===media)){const option=el('option');option.value=role;option.textContent=h3RoleLabel(role,isGerman);select.append(option);}
                select.value=source.h3Role;section.append(field(isGerman?'Eingaberolle':'Input role',select));
                if([OMNI_MODEL,SEEDANCE_25_MODEL].includes(analysis.model.id)){
                    const order=analysis.sources.filter(item=>item.assetId).map(item=>item.edgeId),index=order.indexOf(source.edgeId);
                    const up=el('button','canvas-button',isGerman?'Nach oben':'Move up');up.type='button';up.disabled=index<=0;
                    up.addEventListener('click',()=>{[order[index-1],order[index]]=[order[index],order[index-1]];scheduleNode(node,{config:{...node.config,[analysis.model.id===SEEDANCE_25_MODEL?'seedance25Order':'omniOrder']:order}});renderGraph();renderInspector();});section.append(up);
                }

                select.addEventListener('change',()=>{
                    const roleKey=analysis.model.id===SEEDANCE_25_MODEL?'seedance25Roles':analysis.model.id===OMNI_MODEL?'omniRoles':'h3Roles';
                    const config={...node.config,[roleKey]:{...node.config[roleKey],[source.edgeId]:select.value}};
                    if(analysis.model.id===H3_MODEL&&['first_frame','last_frame'].includes(select.value))config.aspectRatio='adaptive';
                    if(analysis.model.id===SEEDANCE_25_MODEL&&['first_frame','last_frame'].includes(select.value))config.seedance25={...config.seedance25,aspect_ratio:'adaptive'};
                    scheduleNode(node,{config});renderGraph();renderInspector();
                    dom.inspector.querySelector(`[data-h3-role="${source.edgeId}"]`)?.focus({preventScroll:true});
                });
            }
            if (source.videoInput) renderVideoInput({ source, model: analysis.model, section, projectId: store.state.project.id,
                edge: store.state.edges.find(edge => edge.id === source.edgeId), beforePrepare: async method => {
                    if (analysis.model?.id === H3_MODEL && method === 'last_frame') scheduleNode(node, { config: { ...node.config, aspectRatio: 'adaptive' } });
                    return flushSaves();
                }, signal: inspectorAbort.signal, copy: videoCopy,
                update(edge, focus) { store.upsertEdge(edge); renderGraph(); renderInspector(); if (focus) dom.inspector.querySelector(`[data-video-method="${edge.id}"]`)?.focus({ preventScroll: true }); }, report: showToast });
            if (source.previewUrl && source.kind === 'image_asset') {
                const image = el('img'); image.src = source.previewUrl; image.alt = source.sourceTitle; image.loading = 'lazy'; section.append(image);
            }
        }
    }
    if (analysis.connectedPrompt) {
        section.append(el('pre', '', analysis.connectedPrompt));
    }
    const validation = validationForNode(node, analysis, copy);
    if (validation) { section.dataset.state = 'error'; section.append(el('p', '', validation)); }
    return { section, validation };
}

let inspectorAbort = new AbortController();
function renderInspector() {
    rememberCanvasDisclosures(dom.inspector);
    assetPicker.invalidate();
    inspectorAbort.abort(); inspectorAbort = new AbortController();
    dom.inspector.replaceChildren();
    const node = selectedNode();
    if (!node) {
        const edge = store.state.selected?.kind === 'edge' ? store.state.edges.find((item) => item.id === store.state.selected.id) : null;
        dom.inspectorTitle.textContent = edge ? copy.selectedEdge : (isGerman ? 'Kein Node ausgewählt' : 'No node selected');
        if (edge) {
            transitionControls({parent:dom.inspector,edge,nodes:store.state.nodes,projectId:store.state.project.id,german:isGerman,signal:inspectorAbort.signal,onSaved:()=>{renderGraph();},flush:flushSaves});
            dom.inspector.append(el('p', 'canvas-muted', `${edge.source_node_id.slice(0, 8)} → ${edge.target_node_id.slice(0, 8)}`));
            const source=nodeOutputValue(store.state.nodes.find(item=>item.id===edge.source_node_id));
            const target=store.state.nodes.find(item=>item.id===edge.target_node_id);
            if((source.kind==='audio_asset' || source.expectedKind==='audio_asset') && canvasNodeMediaKind(target)==='video') {
                const purpose=el('select');purpose.dataset.exportPurpose=edge.id;
                for(const [value,label] of [['',isGerman?'Audio-Referenz für Generierung':'Audio reference for generation'],[EXPORT_MUSIC_PURPOSE,isGerman?'Hintergrundmusik nur für Export':'Background music for export only']]) {
                    const option=el('option','',label);option.value=value;purpose.append(option);
                }
                purpose.value=isExportMusic(edge.config)?EXPORT_MUSIC_PURPOSE:'';
                const edgeSignal=inspectorAbort.signal;
                purpose.addEventListener('change',async()=>{
                    purpose.disabled=true;const config={...edge.config,purpose:purpose.value};
                    const result=await canvasApi.updateEdge(store.state.project.id,edge.id,{config});
                    if(edgeSignal.aborted)return;
                    if(result.ok){Object.assign(edge,result.data.edge);renderGraph();renderInspector();dom.inspector.querySelector('[data-export-purpose]')?.focus({preventScroll:true});}
                    else {purpose.disabled=false;purpose.value=edge.config?.purpose||'';showToast(errorMessage(result));}
                });
                dom.inspector.append(field(isGerman?'Verbindungszweck':'Connection purpose',purpose));
            }
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
        if (capability === 'image' && model && model.areaEnabled!==false) {
            const c = model.controls || {}, config = { ...node.config };
            for (const key of ['width', 'height']) {
                if (!c.supportsDimensions) continue;
                const choices = imageDimensionChoices(model.id, config[key]);
                if (!choices.includes(Number(config[key]))) config[key] = c.defaultSize?.[key] || 1024;
            }
            for (const [key, options, fallback] of [
                ['resolution', c.resolutionOptions, c.defaultResolution], ['aspectRatio', c.aspectRatioOptions, c.defaultAspectRatio],
                ['quality', c.qualityOptions, c.defaultQuality], ['size', c.sizeOptions, c.defaultSize],
                ['outputFormat', c.outputFormatOptions, c.defaultOutputFormat], ['background', c.backgroundOptions, c.defaultBackground],
            ]) {
                if (options?.length && !options.includes(config[key])) config[key] = options.includes(fallback) ? fallback : options[0];
            }
            if (JSON.stringify(config) !== JSON.stringify(node.config || {})) scheduleNode(node, { config });
        }
        if (capability === 'video' && model && model.areaEnabled!==false) {
            const c = model.controls || {}, config = { ...node.config };
            for (const [key, options, fallback] of [
                ['resolution', c.resolutionOptions, c.defaultResolution], ['quality', c.qualityOptions, c.defaultQuality],
                ['aspectRatio', c.aspectRatioOptions, c.defaultAspectRatio], ['size', c.sizeOptions, ''],
            ]) {
                if (options?.length && config[key] && !options.includes(config[key])) config[key] = fallback || options[0];
            }
            if (c.duration && config.duration != null && (!Number.isInteger(Number(config.duration)) || Number(config.duration) < c.duration.min || Number(config.duration) > c.duration.max)) config.duration = c.duration.default;
            if (JSON.stringify(config) !== JSON.stringify(node.config || {})) scheduleNode(node, { config });
        }
        const available=models.filter(item=>item.runnable && item.areaEnabled!==false);
        const modelSelect = selectControl([...(!available.some(item=>item.id===model?.id)?[{value:'',label:isGerman?'Modell wählen':'Choose a model'}]:[]),...sortGenerationModels(available).map(item=>({value:item.id,label:item.label}))], model?.areaEnabled===false?'':model?.id);
        if(model?.areaEnabled===false)dom.inspector.append(el('p','canvas-model-disabled',isGerman?'Dieses Modell wurde vorübergehend deaktiviert.':'This model has been temporarily disabled.'));
        modelSelect.addEventListener('change', () => {
            // Only replace an unchanged model default. Explicit values survive
            // a switch and the selected model's validator checks their limits.
            const next = available.find(item => item.id === modelSelect.value);
            if(!next)return;
            const config = { ...(node.config || {}) };
            if (next?.controls?.reasoningEffort && !config.reasoningEffort) config.reasoningEffort = next.controls.reasoningEffort.default;
            if (capability === 'text' && !config.maxTokensEdited && (config.maxTokens == null || config.maxTokens === model?.controls?.maxTokens?.default)) config.maxTokens = next?.controls?.maxTokens?.default;
            scheduleNode(node, { model_id: modelSelect.value, config }); window.setTimeout(renderInspector);
        });
        dom.inspector.append(field(copy.model, modelSelect));
        if (model) {
            if (!model.runnable) dom.inspector.append(el('p', 'canvas-muted', model.disabledReason));
            const cost = el('p', 'canvas-cost-note');
            const updateCost = () => {
                let estimate = model.estimatedCredits;
                try {
                    if (capability === 'video' && model.runnable && model.areaEnabled!==false) estimate = calculateAiVideoCreditCost(model.id, model.id === SEEDANCE_25_MODEL ? {...node.config?.seedance25,references:omniCanvasInput(node).references} : model.id === OMNI_MODEL ? omniCanvasInput(node) : { ...node.config, duration: Number(node.config?.duration || model.controls.duration.default), quality: node.config?.quality || model.controls.defaultQuality, resolution: node.config?.resolution || model.controls.defaultResolution, aspect_ratio: node.config?.aspectRatio || model.controls.defaultAspectRatio, generateAudio: node.config?.generateAudio !== false })?.credits;
                    if (capability === 'image' && model.runnable && model.areaEnabled!==false) estimate = calculateAiImageCreditCost(model.id, { ...node.config, ...(isGptImage25Model(model.id) ? { prompt: workflowAnalysis.byNode.get(node.id)?.effectivePrompt || undefined } : {}), source_images: undefined, referenceImageCount: (node.config?.source_images?.length || 0) + (workflowAnalysis.byNode.get(node.id)?.compatible?.filter(item => item.inputKind === 'image_reference').length || 0) })?.credits;
                    if (capability === 'music' && model.runnable && model.areaEnabled!==false) estimate = calculateAiModelCreditCost({ mediaType:'music', modelId:model.id, params:model.id === 'elevenlabs/music-v2' ? elevenLabsMemberBody(node.config || {}) : node.config || {} })?.credits;
                    if (capability === 'text' && model.runnable && model.areaEnabled!==false) estimate = estimateCanvasTextCredits(model.id, { ...node.config, systemPrompt: getCanvasTextInstructions(node.config), prompt: analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy).byNode.get(node.id)?.effectivePrompt || "" });
                } catch { estimate = null; }
                cost.textContent = `${copy.estimated}: ${estimate ?? '—'}`;
            };
            updateCost();
            dom.inspector.addEventListener('input', updateCost, { signal: inspectorAbort.signal });
            window.addEventListener('bitbi:model-pricing', updateCost, { signal: inspectorAbort.signal });
            dom.inspector.append(cost);
        }
        const prompt = textareaControl(node.config?.prompt || '');
        prompt.maxLength = Number(model?.controls?.maxPromptLength || 12000);
        bindConfig(node, prompt, 'prompt');
        if (capability === 'image') {
            const label = isGerman ? 'Zusätzlicher Prompt' : 'Additional prompt';
            const editor = canvasDisclosure([store.state.project.id, node.id, 'prompt'], label, 'canvas-additional-prompt');
            editor.className = 'canvas-additional-prompt';
            editor.append(field(label, prompt));
            dom.inspector.append(editor);
        } else dom.inspector.append(field(copy.prompt, prompt));

        const inputContext = renderInputContext(node, workflowAnalysis.byNode.get(node.id));
        dom.inspector.append(inputContext.section);

        if (capability === 'text') {
            const purposeLabels = isGerman ? ['Bildprompt', 'Videoprompt', 'Songtext'] : ['Image prompt', 'Video prompt', 'Song lyrics'];
            const purpose = selectControl(CANVAS_TEXT_PURPOSES.map((value, index) => ({ value, label: purposeLabels[index] })), node.config?.textPurpose ?? CANVAS_TEXT_DEFAULT_PURPOSE);
            bindConfig(node, purpose, 'textPurpose'); dom.inspector.append(field(isGerman ? 'Verwendungszweck' : 'Purpose', purpose));
            const grid = el('div', 'canvas-field-grid');
            const maxTokens = inputControl(node.config?.maxTokens ?? model?.controls?.maxTokens?.default ?? 500, 'number'); maxTokens.min = '1'; maxTokens.max = String(model?.controls?.maxTokens?.max || 4096); maxTokens.addEventListener('input', () => scheduleNode(node, { config: { ...node.config, maxTokens: Number(maxTokens.value), maxTokensEdited: true } }));
            const temperature = inputControl(node.config?.temperature ?? .7, 'number'); temperature.min = '0'; temperature.max = '1.5'; temperature.step = '.1'; bindConfig(node, temperature, 'temperature', (value) => Number(value));
            if (model?.controls?.reasoningEffort) {
                const reasoning = selectControl(model.controls.reasoningEffort.options.map(value => ({ value, label: ({ low: isGerman ? 'Niedrig' : 'Low', medium: isGerman ? 'Mittel' : 'Medium', high: isGerman ? 'Hoch' : 'High' })[value] })), node.config?.reasoningEffort || model.controls.reasoningEffort.default);
                bindConfig(node, reasoning, 'reasoningEffort');
                grid.append(field(isGerman ? 'Denkaufwand' : 'Reasoning effort', reasoning));
            } else grid.append(field(copy.maxTokens, maxTokens));
            grid.append(field(copy.temperature, temperature)); dom.inspector.append(grid);
        }
        if (capability === 'image' && model && model.areaEnabled!==false) {
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
                for (const [key, label] of [['width', isGerman ? 'Breite' : 'Width'], ['height', isGerman ? 'Höhe' : 'Height']]) {
                    const choices = imageDimensionChoices(model.id, node.config?.[key]);
                    const value = choices.includes(Number(node.config?.[key])) ? Number(node.config[key]) : c.defaultSize?.[key] || 1024;
                    const control = selectControl(choices.map(value => ({ value, label: String(value) })), value);
                    bindConfig(node, control, key, Number);
                    grid.append(field(model.id === 'black-forest-labs/flux-2-max' ? `${label} (${isGerman ? 'Vorgabe' : 'preset'})` : label, control));
                }
            }
            for (const [key, options, value, label] of [
                ['resolution', c.resolutionOptions, c.defaultResolution, isGerman ? 'Auflösung' : 'Resolution'],
                ['aspectRatio', c.aspectRatioOptions, c.defaultAspectRatio, copy.aspectRatio],
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
            if (isGptImage25Model(model.id)) {
                const referenceProject = store.state.project;
                const referenceModelId = node.model_id;
                dom.inspector.append(renderCanvasImageReferences({ node, sources: workflowAnalysis.byNode.get(node.id)?.compatible || [], german: isGerman,
                isCurrent: () => store.state.project === referenceProject && selectedNode() === node && node.model_id === referenceModelId,
                error: showToast, update: values => { const focusLabel = document.activeElement?.getAttribute('aria-label'); scheduleNode(node, { config: { ...node.config, ...values } }); renderInspector(); if (focusLabel) [...dom.inspector.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === focusLabel)?.focus(); },
                choose: max => { const project = store.state.project; void assetPicker.open({ node, references: true, max, isCurrent: () => store.state.project === project && selectedNode() === node }); },
                }));
            }
        }
        if (capability === 'video' && model?.id===SEEDANCE_25_MODEL) {
            const controls=createSeedance25Controls({anchor:prompt.closest('label')||prompt,de:isGerman,classes:{root:'canvas-settings-grid',select:'canvas-select'},
                read:()=>node.config?.seedance25 || {},write:settings=>scheduleNode(node,{config:{...node.config,seedance25:settings}}),
                connectedReferences:()=>omniCanvasInput(node).references,changed:()=>prompt.dispatchEvent(new Event('input',{bubbles:true}))});
            controls.sync(true,runningNodeId===node.id);
        } else if (capability === 'video') {
            const grid = el('div', 'canvas-field-grid');
            const duration = inputControl(node.config?.duration ?? model?.controls?.duration?.default ?? 5, 'number'); duration.min = String(model?.controls?.duration?.min || 1); duration.max = String(model?.controls?.duration?.max || 15); bindConfig(node, duration, 'duration', Number);
            const ratios = model?.controls?.aspectRatioOptions?.length ? model.controls.aspectRatioOptions : ['16:9', '9:16', '1:1'];
            const ratio = selectControl(ratios.map((value) => ({ value, label: value })), node.config?.aspectRatio || model?.controls?.defaultAspectRatio || '16:9'); bindConfig(node, ratio, 'aspectRatio');
            if(model.id!==OMNI_MODEL)grid.append(field(copy.duration, duration));
            grid.append(field(copy.aspectRatio, ratio));
            const c = model?.controls || {}, key = c.resolutionField === 'quality' ? 'quality' : 'resolution';
            const options = key === 'quality' ? c.qualityOptions : c.resolutionOptions;
            const fallback = key === 'quality' ? c.defaultQuality : c.defaultResolution;
            if (options?.length) {
                const resolution = selectControl(options.map(value => ({ value, label: value })), node.config?.[key] || fallback);
                bindConfig(node, resolution, key); grid.append(field(isGerman ? 'Auflösung' : 'Resolution', resolution));
            } else if (fallback) grid.append(field(isGerman ? 'Auflösung' : 'Resolution', el('output', '', fallback)));
            if (c.sizeOptions?.length) {
                const size=selectControl([{value:'',label:isGerman?'Automatisch':'Automatic'},...c.sizeOptions.map(value=>({value,label:value}))],node.config?.size || '');
                bindConfig(node,size,'size');grid.append(field(isGerman?'Größe':'Size',size));
            }
            dom.inspector.append(grid);
        }
        if (model?.id === 'elevenlabs/music-v2') {
            dom.inspector.append(createMemberMusicControls({ config: node.config, german: isGerman,
                onChange(config) { scheduleNode(node, { config }); prompt.dispatchEvent(new Event('input', { bubbles: true })); } }));
        } else if (capability === 'music') {
            const lyrics = textareaControl(node.config?.lyrics || ''); lyrics.maxLength = 3500; bindConfig(node, lyrics, 'lyrics'); dom.inspector.append(field(copy.lyrics, lyrics));
            for (const [key, label] of [['instrumental', copy.instrumental], ['generateLyrics', copy.generateLyrics]]) {
                const checkbox = inputControl('', 'checkbox'); checkbox.checked = node.config?.[key] === true; bindConfig(node, checkbox, key, Boolean); dom.inspector.append(field(label, checkbox));
            }
        }
        const videoState = canvasVideoRunState(store.state.runs, node.id, videoCopy);
        const status = el('div', 'canvas-run-status', runningNodeId === node.id ? copy.running : inspectorRunError(node) || videoState.message); status.id = 'canvasNodeRunStatus'; status.setAttribute('role', 'status'); dom.inspector.append(status);
        const run = el('button', 'canvas-button canvas-button--primary', runningNodeId === node.id ? copy.running : copy.run);
        run.type = 'button'; run.disabled = runningNodeId === node.id || canvasVideoRunState(store.state.runs, node.id, videoCopy).blocked || !model?.runnable || model.areaEnabled===false || omniCanvasBlocked(node) || Boolean(inputContext.validation); run.addEventListener('click', () => void runSelectedNode(node)); dom.inspector.append(run);
        const updateRun = () => {
            const current = analyzeWorkflow(store.state.nodes, store.state.edges, store.state.models, copy).byNode.get(node.id);
            run.disabled = runningNodeId === node.id || canvasVideoRunState(store.state.runs, node.id, videoCopy).blocked || !model?.runnable || model.areaEnabled===false || omniCanvasBlocked(node) || Boolean(validationForNode(node, current, copy));
            if (node.model_id === OMNI_MODEL) {
                run.textContent = omniCanvasBlocked(node) ? (isGerman ? 'Tarif oder Freigabe fehlt' : 'Tariff or acceptance required') : copy.run;
                run.title = isGerman ? 'Verbundene Referenzen und Auflösung benötigen Freigabe und einen Admin-Tarif.' : 'Connected references and resolution require acceptance and an Admin tariff.';
            }
        };
        updateRun();
        dom.inspector.addEventListener('input', updateRun, { signal: inspectorAbort.signal });
        window.addEventListener('bitbi:model-pricing', updateRun, { signal: inspectorAbort.signal });
        if (hasCompletedMedia(node)) {
            const settings = canvasDisclosure([store.state.project.id, node.id, 'generation'], isGerman ? 'Generierungseinstellungen' : 'Generation settings', 'canvas-generation-settings');
            const content = el('div', 'canvas-generation-settings__body');
            content.append(...[...dom.inspector.children].filter(child => child !== status));
            settings.append(content); dom.inspector.prepend(settings);
        }
    }

    if (node.type === 'asset_reference') {
        const choose = el('button', 'canvas-button', copy.selectAsset);
        const upload=inputControl('','file');upload.accept='image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav';
        upload.addEventListener('change',async()=>{const file=upload.files[0],project=store.state.project;upload.value='';if(!file)return;upload.disabled=true;try{const asset=await uploadOmniReference(file);if(store.state.project===project&&selectedNode()===node)await assignAsset({node,isCurrent:()=>store.state.project===project&&selectedNode()===node},asset);}catch(error){showToast(isGerman?'Referenz konnte nicht gespeichert werden.':error.message);}finally{upload.disabled=false;}});
        dom.inspector.append(field(isGerman?'Privates Medium hochladen':'Upload private media',upload));
        choose.id = 'canvasAssetChoose'; choose.type = 'button'; choose.setAttribute('aria-haspopup', 'dialog');
        choose.addEventListener('click', () => {
            const project = store.state.project;
            void assetPicker.open({ node, isCurrent: () => store.state.project === project && selectedNode() === node });
        });
        dom.inspector.append(choose);
        if (node.asset_id) {
            const media=canvasNodeMediaKind(node);
            dom.inspector.append(el('p','canvas-asset-type',media?({video:'Video',image:isGerman?'Bild':'Image',audio:isGerman?'Musik':'Music'}[media]):node.content?.asset?.availability==='unavailable'?(isGerman?'Asset nicht verfügbar. Bitte erneut auswählen.':'Asset unavailable. Choose it again.'):(isGerman?'Dieser Dateityp ist keine Video-, Bild- oder Musikquelle.':'This file is not a video, image or music source.')));
            const issues=store.state.edges.filter(edge=>edge.source_node_id===node.id||edge.target_node_id===node.id)
                .map(edge=>workflowAnalysis.edgeStates.get(edge.id)).filter(state=>state?.status==='incompatible');
            if(issues.length)dom.inspector.append(el('p','canvas-muted',isGerman?'Der neue Medientyp passt nicht zu allen Verbindungen. Markierte Verbindungen prüfen.':'The media type is incompatible with some connections. Review the marked connections.'));
            const label = node.config?.assetReferenceLabel;
            const name = el('p', 'canvas-asset-name', label?.id === node.asset_id ? label.name : (node.content?.asset?.title || node.asset_id));
            dom.inspector.append(name);
            // Older references contain only the server identity. Reuse the
            // previous catalog read for their names without rewriting nodes.
            if (label?.id !== node.asset_id && !node.content?.asset?.title) {
                legacyAssetLabels ||= canvasApi.listAssets();
                const assetId = node.asset_id;
                void legacyAssetLabels.then(({ assets }) => {
                    const asset = assets.find(item => item.id === assetId);
                    if (asset && name.isConnected && node.asset_id === assetId) name.textContent = asset.title || asset.file_name || asset.prompt || asset.id;
                }).catch(() => { legacyAssetLabels = null; });
            }
        }
    }
    dom.inspector.append(renderOutput(displayNodeOutput(node)));
}

function renderNewNodeChoices() {
    const current=dom.nodeType.value;
    const supported=capability=>store.state.models.some(model=>model.capability===capability&&model.runnable&&model.areaEnabled!==false);
    dom.nodeType.replaceChildren(...Object.entries(copy.nodeTypes).filter(([type])=>!type.endsWith('_generation')||supported(type.replace('_generation',''))).map(([value,label])=>{const option=el('option');option.value=value;option.textContent=label;return option;}));
    if([...dom.nodeType.options].some(option=>option.value===current))dom.nodeType.value=current;
    dom.quickTextImageVideo.hidden=!['text','image','video'].every(supported);
}
function renderAll() { renderNewNodeChoices(); renderProjects(); renderGraph(); renderInspector(); renderHistory(); }

const graph = createCanvasGraph({
    nodesRoot: dom.nodes, edgesRoot: dom.edges, emptyState: dom.empty, copy,
    view: () => workspaceView,
    onSelect(kind, id, options = {}) {
        if (store.state.connecting && kind === 'node' && store.state.connectionSourceId && id !== store.state.connectionSourceId) void connectNodes(store.state.connectionSourceId, id);
        else {
            store.state.selected = { kind, id };
            if (!options.preserveGraph) renderGraph();
            else {
                dom.deleteSelection.disabled = false;
                dom.hint.textContent = copy.selectedNode;
                updateContributors();
            }
            renderInspector();
        }
    },
    onMoveEnd(node) { const card=[...dom.nodes.children].find(c=>c.dataset.nodeId===node.id);scheduleNode(node, { x: node.x, y: node.y, width:card.offsetWidth,height:card.offsetHeight });workspaceView.refresh(); },
    onPort(nodeId, direction) {
        if (direction === 'out') {
            store.state.connecting = true; store.state.connectionSourceId = nodeId; dom.hint.textContent = copy.connectTarget; renderGraph();
        } else if (store.state.connectionSourceId) void connectNodes(store.state.connectionSourceId, nodeId);
        else { store.state.connecting = true; dom.hint.textContent = copy.connectStart; renderGraph(); }
    },
});

workspaceView=createWorkspaceView({viewport:dom.viewport,surface:document.getElementById('canvasSurface'),nodesRoot:dom.nodes,edgesRoot:dom.edges,
    toolbar:document.querySelector('.canvas-workspace__toolbar'),getState:()=>store.state,german:isGerman,
    measureSave:async nodes=>{for(const measured of nodes){const node=store.state.nodes.find(n=>n.id===measured.id);if(node.width!==measured.width||node.height!==measured.height)scheduleNode(node,{width:measured.width,height:measured.height});}if(!await flushSaves())throw Error('Save failed');},
    save:async(project,patch)=>{const result=await canvasApi.updateProject(project.id,patch);if(result.ok){Object.assign(project,patch);Object.assign(store.state.projects.find(p=>p.id===project.id)||{},patch);}return result;},
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
    workspaceView.refresh();
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
    const model = store.state.models.find((item) => item.capability === capability && item.runnable && item.areaEnabled!==false);
    if(capability&&!model)return;
    const count = store.state.nodes.length;
    const position=workspaceView.placement(),bounds=workspaceView.limits();
    const visibleX = Math.min(bounds.maxX, Math.max(bounds.minX,position.x+(count%3)*270));
    const visibleY = Math.min(bounds.maxY, Math.max(bounds.minY,position.y+Math.floor(count/3)*180));
    const body = {
        type, title: copy.nodeTypes[type], x: visibleX, y: visibleY,
        model_id: model?.id || null,
        config: capability ? { prompt: '', ...(capability === 'text' ? { textPurpose: CANVAS_TEXT_DEFAULT_PURPOSE, maxTokens: model?.controls?.maxTokens?.default || 500, temperature: .7 } : {}) } : {},
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
    const textModel = store.state.models.find((model) => model.capability === 'text' && model.runnable && model.areaEnabled!==false);
    const imageModel = store.state.models.find((model) => model.capability === 'image' && model.runnable && model.areaEnabled!==false);
    const videoModel = store.state.models.find((model) => model.capability === 'video' && model.runnable && model.areaEnabled!==false && model.controls?.supportsImageInput);
    if (!textModel || !imageModel || !videoModel) return showToast(copy.quickFailed);
    dom.quickTextImageVideo.disabled = true;
    const position=workspaceView.placement(),bounds=workspaceView.limits();
    const startX=Math.max(bounds.minX,Math.min(bounds.maxX-660,position.x)),startY=Math.max(bounds.minY,Math.min(bounds.maxY,position.y));
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
    const source=store.state.nodes.find(node=>node.id===sourceId),target=store.state.nodes.find(node=>node.id===targetId);
    const config=canvasNodeMediaKind(source)==='audio'&&canvasNodeMediaKind(target)==='video'?{purpose:EXPORT_MUSIC_PURPOSE}:{};
    const result = await canvasApi.createEdge(projectId, { source_node_id: sourceId, target_node_id: targetId,config });
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

async function assignAsset(context, asset) {
    const { node, isCurrent } = context;
    if (!isCurrent()) return false;
    if (context.references) {
        const references = Array.isArray(asset) ? asset : [asset];
        if (references.some(item => item.asset_type !== 'image')) return false;
        const existing = node.config?.source_images || [];
        const connected = workflowAnalysis.byNode.get(node.id)?.compatible?.filter(item => item.inputKind === 'image_reference').length || 0;
        if (existing.length + references.length + connected > 16) return false;
        scheduleNode(node, { config: { ...node.config, source_images: [...existing, ...references.map(item => ({ source_type: 'saved_asset', asset_id: item.id, title: item.title || item.file_name || item.id, preview_url: item.thumb_url || item.file_url || '' }))] } });
        const saved = await flushSaves(); if (isCurrent()) renderInspector(); return saved;
    }
    return withProjectTransition(async () => {
        if (!isCurrent()) return false;
        const result = await canvasApi.setAssetReference(node.project_id, node.id, asset.id);
        if (!isCurrent() || !result.ok || result.data?.node_id !== node.id || result.data?.asset?.id !== asset.id) return false;
        node.asset_id = result.data.asset.id; node.content = { asset: result.data.asset };node.output=null;
        for(const edge of result.data.edges||[])store.upsertEdge(edge);
        // Display-only snapshot uses existing node persistence; authorization,
        // source URLs and downstream media identity come solely from the API.
        scheduleNode(node, { config: { ...node.config, assetReferenceLabel: { id: asset.id,
            name: String(asset.title || asset.file_name || asset.prompt || asset.id).slice(0, 1000),
            preview: String(asset.preview_text || '').slice(0, 1000),
        } } });
        const saved = await flushSaves();
        if (!isCurrent()) return false;
        renderGraph(); renderInspector();
        return saved;
    });
}

async function runSelectedNode(node) {
    await refreshModelPricing();
    if(store.state.models.find(m=>m.id===node.model_id)?.areaEnabled===false){ refreshCanvasAvailability(); return; }
    if (omniCanvasBlocked(node)) return showToast(isGerman ? 'Tarif oder Freigabe fehlt.' : 'Tariff or acceptance required.');
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
    inspectorRunError(node, '');
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
        inspectorRunError(node, errorMessage(result));
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
        if (assetPicker.isOpen()) return;
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
        store.state.models = (modelsResult.data.models || []).map(model => isGerman && isGptImage25Model(model.id) ? { ...model, description: 'Bildgenerierung mit transparentem PNG/WebP und automatischen Einstellungen. Bearbeitung mit bis zu 16 Referenzen wartet auf verifizierte Referenzpreise.', disabledReason: model.runnable ? null : 'Verifizierte Cloudflare-Preise und Kontozugriff stehen noch aus.' } : model);
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

function refreshCanvasAvailability() {
    if(!store.state.models.length)return;
    let changed=false;
    store.state.models=store.state.models.map(model=>{const enabled=modelAreaState(model.id,'canvas') ?? model.areaEnabled;if(model.areaEnabled!==enabled)changed=true;return {...model,areaEnabled:enabled};});
    if(changed){renderNewNodeChoices();renderGraph();renderInspector();}
}
window.addEventListener('bitbi:model-pricing',refreshCanvasAvailability);
void init();
