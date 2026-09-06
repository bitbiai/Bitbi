export function createCanvasState() {
    const state = {
        projects: [],
        project: null,
        nodes: [],
        edges: [],
        runs: [],
        models: [],
        organizations: [],
        selectedOrganizationId: null,
        access: null,
        selected: null,
        connectionSourceId: null,
        connecting: false,
    };

    const listeners = new Set();
    const emit = () => listeners.forEach((listener) => listener(state));

    return {
        state,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        emit,
        setProjectGraph(data) {
            state.project = data.project;
            state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
            state.edges = Array.isArray(data.edges) ? data.edges : [];
            state.runs = Array.isArray(data.runs) ? data.runs : [];
            state.selected = null;
            state.connectionSourceId = null;
            emit();
        },
        select(kind, id) { state.selected = id ? { kind, id } : null; emit(); },
        upsertNode(node) {
            const index = state.nodes.findIndex((item) => item.id === node.id);
            if (index >= 0) state.nodes[index] = node; else state.nodes.push(node);
            emit();
        },
        removeNode(nodeId) {
            state.nodes = state.nodes.filter((item) => item.id !== nodeId);
            state.edges = state.edges.filter((edge) => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId);
            if (state.selected?.id === nodeId) state.selected = null;
            emit();
        },
        upsertEdge(edge) {
            const index = state.edges.findIndex((item) => item.id === edge.id);
            if (index >= 0) state.edges[index] = edge; else state.edges.push(edge);
            emit();
        },
        removeEdge(edgeId) {
            state.edges = state.edges.filter((item) => item.id !== edgeId);
            if (state.selected?.id === edgeId) state.selected = null;
            emit();
        },
        addRun(run) {
            state.runs = [run, ...state.runs.filter((item) => item.id !== run.id)].slice(0, 40);
            emit();
        },
    };
}

// Canvas PATCH replaces each supplied top-level field. In particular, config
// and content are complete values: merging their children would change the API
// contract. Copy payloads so subsequent local edits cannot change a sent request.
export function createCanvasSaveQueue({ save, delay = 550, onConfirm = () => {}, onError = () => {}, onChange = () => {} }) {
    const entries = new Map();
    const copyPatch = (patch) => JSON.parse(JSON.stringify(patch));
    const matches = (entry, prefix) => prefix.every((value, index) => entry.identity[index] === value);
    const clearTimer = (entry) => { clearTimeout(entry.timer); entry.timer = null; };
    const arm = (entry) => {
        clearTimer(entry);
        entry.timer = setTimeout(() => { entry.timer = null; void start(entry); }, delay);
    };

    function start(entry) {
        if (entry.inflight) return entry.inflight;
        if (!entry.pending && !entry.failed) return Promise.resolve(true);
        clearTimer(entry);
        const patch = { ...entry.failed?.patch, ...entry.pending };
        entry.pending = null;
        // Assign the promise before invoking callbacks or the asynchronous save.
        entry.inflight = Promise.resolve().then(async () => {
            let result;
            try {
                result = await save(...entry.identity, copyPatch(patch));
                if (result?.ok) onConfirm(result, { identity: entry.identity, patch, pending: entry.pending || {} });
            }
            catch (error) { result = { ok: false, error: error?.message || 'Save failed' }; }
            if (result?.ok) {
                entry.failed = null;
                entry.confirmed = copyPatch(patch);
            } else {
                entry.failed = { patch, result };
                onError(result, entry.identity);
            }
            return Boolean(result?.ok);
        }).finally(() => {
            entry.inflight = null;
            // A timer may have fired during the request. Retain newer edits and
            // send them after it settles; never loop-retry a failed patch alone.
            if (entry.pending && entry.timer === null) arm(entry);
            onChange();
        });
        onChange();
        return entry.inflight;
    }

    return {
        schedule(...args) {
            const patch = copyPatch(args.pop());
            const key = JSON.stringify(args);
            if (!entries.has(key)) entries.set(key, { identity: args, pending: null, inflight: null, failed: null, confirmed: null, timer: null });
            const entry = entries.get(key);
            entry.pending = { ...entry.pending, ...patch };
            arm(entry);
            onChange();
        },
        async flush(...prefix) {
            // Also wait for requests already sent, and for edits arriving while
            // waiting. A failure returns false with its identity/payload intact.
            for (;;) {
                const dirty = [...entries.values()].filter((entry) => matches(entry, prefix) && (entry.pending || entry.inflight || entry.failed));
                if (!dirty.length) return true;
                dirty.forEach(clearTimer);
                const results = await Promise.all(dirty.map(start));
                if (results.some((ok) => !ok)) return false;
            }
        },
        get status() {
            const all = [...entries.values()];
            return {
                pending: all.filter((entry) => entry.pending).length,
                inflight: all.filter((entry) => entry.inflight).length,
                failed: all.filter((entry) => entry.failed).length,
                confirmed: all.filter((entry) => entry.confirmed).length,
            };
        },
        get dirty() { return [...entries.values()].some((entry) => entry.pending || entry.inflight || entry.failed); },
    };
}
