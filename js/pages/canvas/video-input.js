import { canvasApi } from './api.js?v=__ASSET_VERSION__';
import { extractCanvasLastFrame } from './video-frame.js?v=__ASSET_VERSION__';

export const videoInputCopy = de => de ? {
    statuses: { queued: 'Angenommen', running: 'In Verarbeitung', processing: 'Generierung', ingesting: 'Speicherung', outcome_unknown: 'Prüfung erforderlich', failed: 'Fehlgeschlagen', completed: 'Gespeichert', succeeded: 'Gespeichert', preview_pending: 'Vorschau ausstehend' },
    queued: 'Video angenommen – wartet auf Verarbeitung.', processing: 'Video wird erzeugt.', ingesting: 'Video wird gespeichert und zugeordnet.', succeeded: 'Video gespeichert.', jobFailed: 'Videoverarbeitung fehlgeschlagen. Keine automatische Neugenerierung; Betreiberprüfung erforderlich.',
    observation: 'Statusabruf beendet. Der angenommene Auftrag bleibt erhalten; Projekt erneut öffnen, um den Status abzurufen.',
    edit:'Original bearbeiten', extend:'Original verlängern', method: 'Video weiterverwenden', last_frame: 'Letztes Frame als Startbild',
    unavailable: 'Dieser gespeicherte Vorgang ist beim aktuellen Modell nicht verfügbar. Wähle bei Bedarf das Schlussbild.',
    required: 'Bereite das Schlussbild des verbundenen Videos vor.', ambiguous: 'Verbinde genau eine Videoquelle ohne konkurrierendes Bild.',
    review: 'Das Anbieterergebnis ist ungeklärt. Keine weitere Generierung starten; Betreiberprüfung erforderlich.',
    preparing: 'Schlussbild wird dekodiert und gespeichert…',
    failed: 'Videoeingabe konnte nicht vorbereitet werden. Keine Generierung gestartet.', pending: 'Video wird im Hintergrund verarbeitet. Das Ergebnis bleibt nach erneutem Öffnen verfügbar.',
    note: 'Das Schlussbild startet einen neuen Clip; eine nahtlose Bewegungs- oder Tonfortsetzung ist nicht garantiert.',
} : {
    statuses: { queued: 'Accepted', running: 'Processing', processing: 'Generating', ingesting: 'Saving', outcome_unknown: 'Review required', failed: 'Failed', completed: 'Saved', succeeded: 'Saved', preview_pending: 'Preview pending' },
    queued: 'Video accepted – waiting for processing.', processing: 'Generating video.', ingesting: 'Saving and attaching video.', succeeded: 'Video saved.', jobFailed: 'Video processing failed. No automatic regeneration; operator review is required.',
    observation: 'Status observation ended. The accepted job is retained; reopen this project to check its status.',
    edit:'Edit original', extend:'Extend original', method: 'Reuse video', last_frame: 'Last frame as start image',
    unavailable: 'This saved operation is unavailable for the current model. You can choose Last frame instead.',
    required: 'Prepare the connected video’s last frame first.', ambiguous: 'Connect exactly one video source without a competing image.',
    review: 'The provider outcome is unresolved. Do not generate again; operator review is required.',
    preparing: 'Decoding and saving the last frame…',
    failed: 'Video input could not be prepared. No generation started.', pending: 'Video processing continues in the background. Reopen this project to restore the result.',
    note: 'The last frame starts a new clip; seamless motion or audio continuation is not guaranteed.',
};

export function renderVideoInput({ source, section, projectId, edge, beforePrepare, signal, copy, update, report }) {
    const selected = source.videoInput;
    if (!selected?.methods.length) return;
    if (selected.methods.length > 1 || selected.invalidMethod) {
        const label=document.createElement('label'); label.textContent=copy.method;
        const select=document.createElement('select'); select.className='canvas-select';
        const empty=document.createElement('option');empty.value='';empty.textContent='—';select.append(empty);
        for (const method of selected.methods) {const option=document.createElement('option');option.value=method;option.textContent=copy[method];select.append(option);}
        select.value=selected.method || '';select.addEventListener('change',()=>void prepare(select.value,true),{signal});label.append(select);section.append(label);
    } else {const name=document.createElement('strong');name.textContent=copy.last_frame;section.append(name);}
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'canvas-btn';
    retry.textContent = copy.last_frame; retry.dataset.videoMethod = edge.id; retry.hidden = true; section.append(retry);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); section.append(status);
    if (selected.invalidMethod) status.textContent = copy.unavailable;
    if (selected.method === 'last_frame') {
        const note = document.createElement('p'); note.textContent = copy.note; section.append(note);
        if (selected.frame?.previewUrl) {
            const image = document.createElement('img'); image.src = selected.frame.previewUrl; image.alt = copy.last_frame; section.append(image);
        }
    }
    async function prepare(method, restoreFocus = false) {
        if (!method || signal.aborted) return;
        retry.disabled = true; retry.hidden = true;
        try {
            if (!await beforePrepare() || signal.aborted) return;
            const config = { ...edge.config, videoInput: { ...selected.context, method } };
            // Save selection first; decoded bytes never enter graph JSON.
            const chosen = await canvasApi.updateEdge(projectId, edge.id, { config });
            if (!chosen.ok) throw new Error(chosen.code);
            let result = chosen;
            if (method === 'last_frame' && !chosen.data.edge.config.videoInput.frame) {
                status.textContent = copy.preparing;
                const frame = await extractCanvasLastFrame(source.fileUrl, { signal });
                if (signal.aborted) return;
                result = await canvasApi.updateEdge(projectId, edge.id, { config, frame_image: frame.imageData });
                if (!result.ok) throw new Error(result.code);
            }
            if (!signal.aborted) update(result.data.edge, restoreFocus);
        } catch { if (!signal.aborted) { status.textContent = copy.failed; retry.hidden = false; report(copy.failed); } }
        finally { if (!signal.aborted) retry.disabled = false; }
    }
    retry.addEventListener('click', () => void prepare('last_frame', true), { signal });
    // The only permitted method is prepared automatically; reload reuses its
    // saved input. No paid operation is made here.
    if (selected.methods.length === 1 && selected.method === 'last_frame' && !selected.frame) void prepare('last_frame');
}

// Durable run identity, not a transient HTTP spinner, controls the Run button.
export function canvasVideoRunState(runs, nodeId, copy) {
    const own = runs.filter(run => run.node_id === nodeId);
    const blocked = run => run.error_code === 'canvas_video_review_required' || Boolean(run.video_job_id && ['queued', 'running'].includes(run.status));
    const run = own.find(blocked) || own[0];
    if (!run) return { blocked: false, message: '' };
    const state = run.video_job_status || (run.error_code === 'canvas_video_review_required' ? 'outcome_unknown' : run.status);
    const message = state === 'outcome_unknown' ? copy.review : run.error_code === 'canvas_video_review_required' ? (state === 'failed' ? copy.jobFailed : copy.review) : run.error_code === 'canvas_video_pending' ? (copy[state] || copy.pending)
        : run.status === 'failed' ? (run.error_message || copy.jobFailed) : run.video_job_id ? copy.succeeded : '';
    return { blocked: blocked(run), message: run.observation_error ? `${message} ${copy.observation}` : message, run };
}

export async function awaitCanvasVideo({ projectId, nodeId, key, jobId, organizationId, signal, onJob = () => {} }) {
    if (!jobId) return { ok: false, status: 409, code: 'canvas_video_unavailable' };
    // Bounded read-only observation is NOT a deadline for the durable job.
    try {
        for (let read = 0; read < 120 && !signal.aborted; read++) {
            await new Promise(resolve => {
                const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
                const timer = setTimeout(done, 5000); signal.addEventListener('abort', done, { once: true });
            });
            if (signal.aborted) break;
            const job = await canvasApi.getGenerationJob(jobId, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
            if (!job.ok) return job;
            if (signal.aborted) break;
            onJob(job.data.job);
            if (['queued', 'processing', 'ingesting'].includes(job.data.job.status)) continue;
            return await canvasApi.runNode(projectId, nodeId, key, organizationId);
        }
        return { ok: false, status: 202, code: 'canvas_video_pending' };
    } catch { return { ok: false, status: 0, code: 'canvas_video_unavailable' }; }
}
