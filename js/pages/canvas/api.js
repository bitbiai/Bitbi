import { modelPricingRequestHeaders, refreshModelPricing } from '../../shared/model-pricing-client.js';
import { TARIFF_HEADER } from '../../shared/model-tariff.mjs';
const BASE = '/api/account/canvas';
let sessionRevision=0,sessionSuspended=false;
const requests=new Set();
export function suspendCanvasSession(value){sessionSuspended=Boolean(value);}
export function invalidateCanvasSession(){sessionSuspended=true;sessionRevision++;for(const controller of requests)controller.abort();requests.clear();}

async function requestUrl(url, { method = 'GET', body, idempotencyKey, signal, responseKey = 'data', timeoutMs = 0, tariffRevision } = {}) {
    if(sessionSuspended)return {ok:false,status:0,code:'canvas_session_unconfirmed',error:'Canvas session is not confirmed.',data:null};
    const revision=sessionRevision;
    const headers = { Accept: 'application/json', ...modelPricingRequestHeaders() };
    if(tariffRevision!==undefined){
        if(!Number.isSafeInteger(tariffRevision)||tariffRevision<0)return {ok:false,status:400,code:'model_pricing_stale',data:null};
        headers[TARIFF_HEADER]=String(tariffRevision);
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const controller=new AbortController(),abort=()=>controller.abort();let timedOut=false;
    requests.add(controller);
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
        if(revision!==sessionRevision||controller.signal.aborted)return {ok:false,status:0,code:revision===sessionRevision&&timedOut?'request_timeout':'request_aborted',data:null};
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
            diagnosticRef: /^[A-Za-z0-9:_-]{1,160}$/.test(response.headers.get('X-Correlation-ID') || '') ? response.headers.get('X-Correlation-ID') : null,
            error: payload?.error || 'Canvas request failed.',
            data: payload?.data || null,
        };
    } catch (error) {
        return { ok: false, status: 0, code: revision!==sessionRevision?'request_aborted':timedOut?'request_timeout':controller.signal.aborted?'request_aborted':'network_error', error: 'Canvas request could not be confirmed.', data: null };
    } finally {requests.delete(controller);clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function request(path, options) {
    return requestUrl(`${BASE}${path}`, options);
}

export { request as canvasRequest };

function id(value) { return encodeURIComponent(String(value || '')); }

export const canvasApi = Object.freeze({
    notifications: (cursor,signal) => request(`/notifications?limit=40${cursor?'&cursor='+id(cursor):''}`,{signal,timeoutMs:15000}),
    notificationRead: selection => request('/notifications/read',{method:'POST',body:Array.isArray(selection)?{ids:selection}:selection,timeoutMs:15000}),
    notificationDelete: body => request('/notifications/delete',{method:'POST',body,timeoutMs:15000,idempotencyKey:body.requestId}),
    notificationClient: body => request('/notifications/client',{method:'POST',body,timeoutMs:15000,idempotencyKey:body.requestId}),
    listProjects: () => request('/projects'),
    createProject: (body) => request('/projects', { method: 'POST', body }),
    getProject: (projectId, signal, timeoutMs) => request(`/projects/${id(projectId)}`, { signal, timeoutMs }),
    contributors: (projectId, runId, signal) => request(`/projects/${id(projectId)}/runs/${id(runId)}/contributors`, { signal }),
    updateProject: (projectId, body) => request(`/projects/${id(projectId)}`, { method: 'PATCH', body }),
    assembly: (projectId) => request(`/projects/${id(projectId)}/assembly`),
    saveAssembly: (projectId, body) => request(`/projects/${id(projectId)}/assembly`, { method: 'PATCH', body }),
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
