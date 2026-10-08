import { modelPricingRequestHeaders, refreshModelPricing } from '../../shared/model-pricing-client.js';
const BASE = '/api/account/canvas';

async function requestUrl(url, { method = 'GET', body, idempotencyKey, signal, responseKey = 'data', timeoutMs = 0 } = {}) {
    const headers = { Accept: 'application/json', ...modelPricingRequestHeaders() };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const controller=new AbortController(),abort=()=>controller.abort();let timedOut=false;
    if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=timeoutMs?setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs):null;
    try {
        const response = await fetch(url, {
            method,
            credentials: 'include',
            signal:controller.signal,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (payload?.code === 'model_pricing_stale') {
            await refreshModelPricing();
            payload.error = document.documentElement.lang === 'de'
                ? 'Preise wurden geändert. Prüfen Sie die aktualisierte Schätzung und bestätigen Sie erneut.'
                : 'Prices changed. Review the updated estimate and confirm again.';
        }
        if (response.ok && payload?.ok) return { ok: true, status: response.status, data: payload[responseKey] };
        return {
            ok: false,
            status: response.status,
            code: payload?.code || 'request_failed',
            error: payload?.error || 'Canvas request failed.',
            data: payload?.data || null,
        };
    } catch (error) {
        return { ok: false, status: 0, code: timedOut?'request_timeout':signal?.aborted?'request_aborted':'network_error', error: 'Canvas request could not be confirmed.', data: null };
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function request(path, options) {
    return requestUrl(`${BASE}${path}`, options);
}

function id(value) { return encodeURIComponent(String(value || '')); }

export const canvasApi = Object.freeze({
    listProjects: () => request('/projects'),
    createProject: (body) => request('/projects', { method: 'POST', body }),
    getProject: (projectId, signal, timeoutMs) => request(`/projects/${id(projectId)}`, { signal, timeoutMs }),
    contributors: (projectId, runId, signal) => request(`/projects/${id(projectId)}/runs/${id(runId)}/contributors`, { signal }),
    updateProject: (projectId, body) => request(`/projects/${id(projectId)}`, { method: 'PATCH', body }),
    deleteProject: (projectId) => request(`/projects/${id(projectId)}`, { method: 'DELETE' }),
    listModels: () => request('/models'),
    createNode: (projectId, body) => request(`/projects/${id(projectId)}/nodes`, { method: 'POST', body }),
    updateNode: (projectId, nodeId, body) => request(`/projects/${id(projectId)}/nodes/${id(nodeId)}`, { method: 'PATCH', body }),
    deleteNode: (projectId, nodeId) => request(`/projects/${id(projectId)}/nodes/${id(nodeId)}`, { method: 'DELETE' }),
    createEdge: (projectId, body) => request(`/projects/${id(projectId)}/edges`, { method: 'POST', body }),
    updateEdge: (projectId, edgeId, body) => request(`/projects/${id(projectId)}/edges/${id(edgeId)}`, { method: 'PATCH', body }),
    deleteEdge: (projectId, edgeId) => request(`/projects/${id(projectId)}/edges/${id(edgeId)}`, { method: 'DELETE' }),
    runNode: (projectId, nodeId, idempotencyKey, organizationId = null) => request(`/projects/${id(projectId)}/nodes/${id(nodeId)}/run`, {
        method: 'POST',
        body: organizationId ? { organization_id: organizationId } : {},
        idempotencyKey,
    }),
    setAssetReference: (projectId, nodeId, assetId) => request(`/projects/${id(projectId)}/nodes/${id(nodeId)}/asset-reference`, { method: 'POST', body: { asset_id: assetId } }),
    listAssets: async () => {
        const result = await requestUrl('/api/ai/assets?limit=60');
        if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code, status: result.status });
        return {
            assets: Array.isArray(result.data?.assets) ? result.data.assets : [],
            storageUsage: result.data?.storageUsage || null,
        };
    },
    saveOutput: (projectId,runId) => request(`/projects/${id(projectId)}/runs/${id(runId)}/save-asset`, {method:'POST',body:{}}),
    fullVideo: (projectId, runId, create, signal, body = {}, idempotencyKey) => request(`/projects/${id(projectId)}/${runId?.nodeId?'nodes/'+id(runId.nodeId):'runs/'+id(runId)}/full-video${!create&&body.lookupRequestKey?'?requestKey='+id(body.lookupRequestKey):''}`, { method: create ? 'POST' : 'GET', ...(create ? {body,idempotencyKey} : {}), signal, timeoutMs:30000 }),
    seamPreview: (projectId, runId, previewId, signal) => request(`/projects/${id(projectId)}/${runId?.nodeId?'nodes/'+id(runId.nodeId):'runs/'+id(runId)}/full-video?seamPreview=${id(previewId)}`, {signal,timeoutMs:30000}),
    retryPoster: (assetId, signal) => requestUrl(`/api/ai/generation-jobs/${id(assetId)}/retry-preview`, {method:'POST',body:{},signal}),
    getGenerationJob: (jobId, signal) => requestUrl(`/api/ai/generation-jobs/${id(jobId)}`, { signal }),
    getCredits: () => requestUrl('/api/account/credits-dashboard?limit=1', { responseKey: 'dashboard' }),
});
