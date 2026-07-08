export function createCanvasState() {
    const state = {
        projects: [],
        project: null,
        nodes: [],
        edges: [],
        runs: [],
        models: [],
        selected: null,
        connectionSourceId: null,
        connecting: false,
        saving: 0,
        saveError: false,
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
        beginSave() { state.saving += 1; state.saveError = false; emit(); },
        endSave(ok = true) { state.saving = Math.max(0, state.saving - 1); state.saveError = state.saveError || !ok; emit(); },
    };
}

export function createDebouncedTask(task, delay = 550) {
    let timer = 0;
    let pendingArgs = null;
    const run = async () => {
        timer = 0;
        const args = pendingArgs;
        pendingArgs = null;
        await task(...args);
    };
    return {
        schedule(...args) {
            pendingArgs = args;
            window.clearTimeout(timer);
            timer = window.setTimeout(run, delay);
        },
        async flush() {
            if (!timer) return;
            window.clearTimeout(timer);
            await run();
        },
        get pending() { return Boolean(timer); },
    };
}
