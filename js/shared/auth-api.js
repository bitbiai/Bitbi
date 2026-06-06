/* ============================================================
   BITBI — Auth API: pure fetch wrappers for auth endpoints
   ============================================================ */

import { BITBI_GENERATION_TIMEOUT_MS } from './generation-timeout.mjs?v=__ASSET_VERSION__';

const BASE = '/api';

function createTimeoutError(message = 'Request timed out.') {
    if (typeof DOMException === 'function') {
        return new DOMException(message, 'TimeoutError');
    }
    const error = new Error(message);
    error.name = 'TimeoutError';
    return error;
}

function buildRequestSignal(options = {}) {
    const sourceSignal = options.signal || null;
    const timeoutMs = Number(options.timeoutMs || 0);
    if (!timeoutMs) {
        return {
            signal: sourceSignal,
            timedOut: () => false,
            cleanup: () => {},
        };
    }

    if (sourceSignal?.aborted) {
        return {
            signal: sourceSignal,
            timedOut: () => false,
            cleanup: () => {},
        };
    }

    const controller = new AbortController();
    let timeoutId = 0;
    let timedOut = false;
    const abortFromSource = () => controller.abort(sourceSignal?.reason || createTimeoutError('Request cancelled.'));
    if (sourceSignal) {
        sourceSignal.addEventListener('abort', abortFromSource, { once: true });
    }
    timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort(createTimeoutError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        cleanup: () => {
            if (timeoutId) window.clearTimeout(timeoutId);
            if (sourceSignal) sourceSignal.removeEventListener('abort', abortFromSource);
        },
    };
}

function normalizeAssetStorageUsage(value) {
    if (!value || typeof value !== 'object') return null;
    const usedBytes = Number(value.usedBytes);
    const isUnlimited = value.isUnlimited === true;
    const limitBytes = Number(value.limitBytes);
    if (!Number.isFinite(usedBytes)) {
        return null;
    }
    if (!isUnlimited && (!Number.isFinite(limitBytes) || limitBytes <= 0)) {
        return null;
    }
    const remainingBytes = Number(value.remainingBytes);
    return {
        usedBytes: Math.max(0, Math.floor(usedBytes)),
        limitBytes: isUnlimited ? null : Math.max(1, Math.floor(limitBytes)),
        remainingBytes: isUnlimited
            ? null
            : (Number.isFinite(remainingBytes)
                ? Math.max(0, Math.floor(remainingBytes))
                : Math.max(0, Math.floor(limitBytes - usedBytes))),
        isUnlimited,
    };
}

async function request(method, path, body, options = {}) {
    const signalState = buildRequestSignal(options);
    try {
        const opts = {
            method,
            credentials: 'include',
            headers: {},
        };
        if (signalState.signal) {
            opts.signal = signalState.signal;
        }
        if (options.headers && typeof options.headers === 'object') {
            for (const [key, value] of Object.entries(options.headers)) {
                if (value !== undefined && value !== null) {
                    opts.headers[key] = String(value);
                }
            }
        }
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(BASE + path, opts);
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (res.ok) return { ok: true, data, status: res.status };
        const retryAfterHeader = Number(res.headers.get('retry-after'));
        const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? Math.ceil(retryAfterHeader)
            : (Number.isFinite(Number(data?.retryAfterSeconds)) && Number(data.retryAfterSeconds) > 0
                ? Math.ceil(Number(data.retryAfterSeconds))
                : null);
        return {
            ok: false,
            error: data?.error || `Error ${res.status}`,
            code: data?.code || null,
            data,
            status: res.status,
            retryAfterSeconds,
        };
    } catch (e) {
        if (e?.name === 'AbortError') {
            if (signalState.timedOut()) {
                return { ok: false, aborted: true, timeout: true, error: 'Request timed out.', code: 'request_timeout' };
            }
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        if (e?.name === 'TimeoutError' || signalState.timedOut()) {
            return { ok: false, aborted: true, timeout: true, error: 'Request timed out.', code: 'request_timeout' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    } finally {
        signalState.cleanup();
    }
}

function notifyAssetStorageChanged() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('bitbi:assets-storage-changed'));
}

export function apiRegister(email, password) {
    return request('POST', '/register', { email, password });
}

export function apiLogin(email, password) {
    return request('POST', '/login', { email, password });
}

export function apiGetMe() {
    return request('GET', '/me');
}

export function apiLogout() {
    return request('POST', '/logout');
}

/* ── Wallet / SIWE ── */

export function apiWalletStatus() {
    return request('GET', '/wallet/status');
}

export function apiWalletSiweNonce(intent) {
    return request('POST', '/wallet/siwe/nonce', { intent });
}

export function apiWalletSiweVerify(intent, message, signature) {
    return request('POST', '/wallet/siwe/verify', { intent, message, signature });
}

export function apiWalletUnlink() {
    return request('POST', '/wallet/unlink');
}

/* ── Profile ── */

export function apiGetProfile() {
    return request('GET', '/profile');
}

export function apiUpdateProfile(fields) {
    return request('PATCH', '/profile', fields);
}

export function apiGetProfileSocialSummary() {
    return request('GET', '/profile/social/summary');
}

export function apiGetProfileSocialList(kind, { limit } = {}) {
    const safeKind = ['followers', 'following', 'likes'].includes(kind) ? kind : 'followers';
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return request('GET', `/profile/social/${safeKind}${query ? `?${query}` : ''}`);
}

export function apiGetProfileMedia(kind, { limit } = {}) {
    const safeKind = kind === 'liked' ? 'liked' : 'published';
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return request('GET', `/profile/media/${safeKind}${query ? `?${query}` : ''}`);
}

export function apiGetPublicMediaInteractions(mediaType, mediaId) {
    return request('GET', `/gallery/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}/interactions`);
}

export function apiTogglePublicMediaLike(mediaType, mediaId, liked) {
    return request(liked ? 'POST' : 'DELETE', `/gallery/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}/like`);
}

export function apiTogglePublicMediaFollow(mediaType, mediaId, followed) {
    return request(followed ? 'POST' : 'DELETE', `/gallery/${encodeURIComponent(mediaType)}/${encodeURIComponent(mediaId)}/follow`);
}

/* ── Avatar ── */

export async function apiUploadAvatar(file) {
    try {
        const formData = new FormData();
        formData.append('avatar', file);
        const res = await fetch(BASE + '/profile/avatar', {
            method: 'POST',
            credentials: 'include',
            body: formData,
        });
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (res.ok) return { ok: true, data };
        return { ok: false, error: data?.error || `Error ${res.status}`, data };
    } catch (e) {
        return { ok: false, error: 'Network error. Please try again.' };
    }
}

export function apiSetAvatarFromSavedAsset(imageId) {
    return request('POST', '/profile/avatar', { source_image_id: imageId });
}

export function apiDeleteAvatar() {
    return request('DELETE', '/profile/avatar');
}

/* ── Admin API ── */

export function apiAdminMe() {
    return request('GET', '/admin/me');
}

export function apiAdminReadinessStatus() {
    return request('GET', '/admin/readiness/status');
}

export function apiAdminMfaStatus() {
    return request('GET', '/admin/mfa/status');
}

export function apiAdminMfaSetup() {
    return request('POST', '/admin/mfa/setup', {});
}

export function apiAdminMfaEnable(code) {
    return request('POST', '/admin/mfa/enable', { code });
}

export function apiAdminMfaVerify({ code, recoveryCode } = {}) {
    const body = {};
    if (code) body.code = code;
    if (recoveryCode) body.recovery_code = recoveryCode;
    return request('POST', '/admin/mfa/verify', body);
}

export function apiAdminMfaDisable({ code, recoveryCode } = {}) {
    const body = {};
    if (code) body.code = code;
    if (recoveryCode) body.recovery_code = recoveryCode;
    return request('POST', '/admin/mfa/disable', body);
}

export function apiAdminMfaRegenerateRecoveryCodes({ code, recoveryCode } = {}) {
    const body = {};
    if (code) body.code = code;
    if (recoveryCode) body.recovery_code = recoveryCode;
    return request('POST', '/admin/mfa/recovery-codes/regenerate', body);
}

export function apiAdminUsers(search, { limit, cursor } = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/users${qs}`);
}

export function apiAdminRegistrationStatus(options) {
    return request('GET', '/admin/registration/status', undefined, options);
}

export function apiAdminSetRegistrationStatus(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/registration/status', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminHomepageHeroVideos(options) {
    return request('GET', '/admin/homepage/hero-videos', undefined, options);
}

export function apiAdminHomepageHeroVideoFeatureStatus(options) {
    return request('GET', '/admin/homepage/hero-videos/feature-status', undefined, options);
}

export function apiAdminUpdateHomepageHeroVideoFeatureSwitch(key, payload = {}, { idempotencyKey } = {}) {
    return request('PATCH', `/admin/homepage/hero-videos/feature-status/${encodeURIComponent(key)}`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminUpdateHomepageHeroVideoPreset(payload = {}, { idempotencyKey } = {}) {
    return request('PATCH', '/admin/homepage/hero-videos/preset', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminHomepageHeroVideoCandidates(source = 'public', { limit, signal } = {}) {
    const path = '/admin/homepage/hero-videos/candidates';
    const params = new URLSearchParams();
    params.set('source', source);
    if (limit) params.set('limit', String(limit));
    return request('GET', `${path}?${params}`, undefined, { signal });
}

export function apiAdminHomepageHeroVideoDerivatives({
    slot,
    sourceType,
    sourceAssetId,
    status,
    includeUnassigned = true,
    limit,
    signal,
} = {}) {
    const params = new URLSearchParams();
    if (slot) params.set('slot', slot);
    if (sourceType) params.set('source_type', sourceType);
    if (sourceAssetId) params.set('source_asset_id', sourceAssetId);
    if (status) params.set('status', status);
    if (includeUnassigned !== undefined) params.set('include_unassigned', includeUnassigned ? 'true' : 'false');
    if (limit) params.set('limit', String(limit));
    const suffix = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/homepage/hero-videos/derivatives${suffix}`, undefined, { signal });
}

export function apiAdminHomepageHeroVideoDerivative(derivativeId, { signal } = {}) {
    return request('GET', `/admin/homepage/hero-videos/derivatives/${encodeURIComponent(derivativeId)}`, undefined, { signal });
}

export function apiAdminCreateHomepageHeroVideoDerivative(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/homepage/hero-videos/derivatives', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export async function apiAdminUploadHomepageHeroVideoSource(file, {
    title = '',
    operatorReason = '',
    poster = null,
    aspectRatio = '',
    displayAspectRatio = '',
    posterTimeSeconds = null,
    poster_time_seconds = null,
    idempotencyKey,
    signal,
} = {}) {
    try {
        const formData = new FormData();
        const path = '/admin/homepage/hero-videos/uploads';
        const normalizedAspectRatio = ['9:16', '1:1', '16:9'].includes(aspectRatio)
            ? aspectRatio
            : (['9:16', '1:1', '16:9'].includes(displayAspectRatio) ? displayAspectRatio : '');
        const normalizedPosterTimeSeconds = Number(
            posterTimeSeconds ?? poster_time_seconds
        );
        formData.append('video', file);
        if (poster) formData.append('poster', poster, 'hero-source-poster.webp');
        if (title) formData.append('title', title);
        if (normalizedAspectRatio) formData.append('aspect_ratio', normalizedAspectRatio);
        if (Number.isFinite(normalizedPosterTimeSeconds) && normalizedPosterTimeSeconds >= 0) {
            formData.append('poster_time_seconds', String(Math.round(normalizedPosterTimeSeconds * 10) / 10));
        }
        formData.append('operator_reason', operatorReason);
        const headers = {};
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
        const res = await fetch(BASE + path, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: formData,
            signal,
        });
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (res.ok) return { ok: true, data, status: res.status };
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export function apiAdminAttachHomepageHeroVideoPoster(assetId, payload = {}, { idempotencyKey } = {}) {
    return request('POST', `/admin/homepage/hero-videos/uploads/${encodeURIComponent(assetId)}/poster`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminRetryHomepageHeroVideoPoster(assetId, payload = {}, { idempotencyKey } = {}) {
    return request('POST', `/admin/homepage/hero-videos/uploads/${encodeURIComponent(assetId)}/poster/retry`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminRetryHomepageHeroVideoDerivative(derivativeId, payload = {}, { idempotencyKey } = {}) {
    return request('POST', `/admin/homepage/hero-videos/derivatives/${encodeURIComponent(derivativeId)}/retry`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminBackfillMemvidStreamPreviews(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/homepage/hero-videos/memvid-stream-previews/backfill', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminRunMemvidStreamPreviews(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/homepage/hero-videos/memvid-stream-previews/run', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminUpdateHomepageHeroVideoSlot(slot, payload = {}, { idempotencyKey } = {}) {
    return request('PUT', `/admin/homepage/hero-videos/slots/${encodeURIComponent(slot)}`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminChangeRole(userId, role) {
    return request('PATCH', `/admin/users/${userId}/role`, { role });
}

export function apiAdminChangeStatus(userId, status) {
    return request('PATCH', `/admin/users/${userId}/status`, { status });
}

export function apiAdminRevokeSessions(userId) {
    return request('POST', `/admin/users/${userId}/revoke-sessions`, {
        confirm: true,
        confirmation: 'revoke_sessions',
    });
}

export function apiAdminDeleteUser(userId, options = {}) {
    const body = {
        confirm: true,
        confirmation: 'delete_user',
    };
    if (options?.startDataErasureWorkflow === true) {
        const workflow = options.dataErasureWorkflow && typeof options.dataErasureWorkflow === 'object'
            ? options.dataErasureWorkflow
            : {};
        body.startDataErasureWorkflow = true;
        body.dataErasureWorkflow = {
            reason: workflow.reason || 'Admin initiated GDPR/data erasure workflow from Admin user deletion.',
            requestSource: workflow.requestSource || 'admin_delete_user_modal',
            acknowledgement: workflow.acknowledgement || '',
        };
    }
    return request('DELETE', `/admin/users/${userId}`, body);
}

export function apiAdminLatestAvatars() {
    return request('GET', '/admin/avatars/latest');
}

export function apiAdminStats() {
    return request('GET', '/admin/stats');
}

export function apiAdminActivity(limit, cursor, search) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/activity${qs}`);
}

export function apiAdminUserActivity(limit, cursor, search) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    if (search) params.set('search', search);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/user-activity${qs}`);
}

export function apiAdminOperationsTimeline({
    source,
    severity,
    status,
    attentionRequired,
    limit,
    offset,
} = {}) {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    if (severity) params.set('severity', severity);
    if (status) params.set('status', status);
    if (attentionRequired !== undefined && attentionRequired !== null && attentionRequired !== '') {
        params.set('attentionRequired', String(attentionRequired));
    }
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/operations/timeline${qs}`);
}

export function apiAdminOrganizations({ limit, search } = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/orgs${qs}`);
}

export function apiAdminOrganization(orgId) {
    return request('GET', `/admin/orgs/${encodeURIComponent(orgId)}`);
}

export function apiAdminOrganizationUserAccess(orgId, { search, limit } = {}) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/orgs/${encodeURIComponent(orgId)}/user-access${qs}`);
}

export function apiAdminAssignOrganizationUser(orgId, userId, { role = 'member', idempotencyKey } = {}) {
    return request('PUT', `/admin/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`, {
        role,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminRemoveOrganizationUser(orgId, userId, { idempotencyKey } = {}) {
    return request('DELETE', `/admin/orgs/${encodeURIComponent(orgId)}/users/${encodeURIComponent(userId)}`, {
        assigned: false,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminBillingPlans() {
    return request('GET', '/admin/billing/plans');
}

export function apiAdminBillingEvidenceStatus() {
    return request('GET', '/admin/billing/evidence/status');
}

export function apiAdminOrganizationBilling(orgId) {
    return request('GET', `/admin/orgs/${encodeURIComponent(orgId)}/billing`);
}

export function apiAdminUserBilling(userId) {
    return request('GET', `/admin/users/${encodeURIComponent(userId)}/billing`);
}

export function apiAdminUserStorage(userId, { limit, cursor } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/users/${encodeURIComponent(userId)}/storage${qs}`);
}

export function apiAdminUserStorageReconciliation(userId) {
    return request('GET', `/admin/users/${encodeURIComponent(userId)}/storage/reconciliation`);
}

export function apiAdminRenameUserAsset(userId, assetId, name) {
    return request('PATCH', `/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}/rename`, { name });
}

export function apiAdminMoveUserAsset(userId, assetId, folderId) {
    return request('PATCH', `/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}/folder`, {
        folder_id: folderId || null,
    });
}

export function apiAdminSetUserAssetVisibility(userId, assetId, visibility) {
    return request('PATCH', `/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}/visibility`, {
        visibility,
    });
}

export function apiAdminDeleteUserAsset(userId, assetId, { reason, idempotencyKey } = {}) {
    return request('DELETE', `/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}`, {
        confirm: true,
        confirmation: 'delete_user_asset',
        reason,
        targetUserId: userId,
        assetId,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('admin-storage-asset-delete') },
    });
}

export function apiAdminRenameUserFolder(userId, folderId, name) {
    return request('PATCH', `/admin/users/${encodeURIComponent(userId)}/folders/${encodeURIComponent(folderId)}`, { name });
}

export function apiAdminDeleteUserFolder(userId, folderId, { reason, idempotencyKey } = {}) {
    return request('DELETE', `/admin/users/${encodeURIComponent(userId)}/folders/${encodeURIComponent(folderId)}`, {
        confirm: true,
        confirmation: 'delete_user_folder',
        reason,
        targetUserId: userId,
        folderId,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('admin-storage-folder-delete') },
    });
}

export function apiAdminGrantOrganizationCredits(orgId, { amount, reason, idempotencyKey }) {
    return request('POST', `/admin/orgs/${encodeURIComponent(orgId)}/credits/grant`, {
        amount,
        reason,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminGrantUserCredits(userId, { amount, reason, idempotencyKey }) {
    return request('POST', `/admin/users/${encodeURIComponent(userId)}/credits/grant`, {
        amount,
        reason,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminBillingEvents({ provider, status, eventType, organizationId, limit } = {}) {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    if (status) params.set('status', status);
    if (eventType) params.set('event_type', eventType);
    if (organizationId) params.set('organization_id', organizationId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/billing/events${qs}`);
}

export function apiAdminBillingEvent(eventId) {
    return request('GET', `/admin/billing/events/${encodeURIComponent(eventId)}`);
}

export function apiAdminBillingReconciliation() {
    return request('GET', '/admin/billing/reconciliation');
}

export function apiAdminBillingReviews({ reviewState, provider, providerMode, eventType, limit } = {}) {
    const params = new URLSearchParams();
    if (reviewState) params.set('review_state', reviewState);
    if (provider) params.set('provider', provider);
    if (providerMode) params.set('provider_mode', providerMode);
    if (eventType) params.set('event_type', eventType);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/billing/reviews${qs}`);
}

export function apiAdminBillingReview(reviewId) {
    return request('GET', `/admin/billing/reviews/${encodeURIComponent(reviewId)}`);
}

export function apiAdminResolveBillingReview(reviewId, { resolutionStatus, resolutionNote, idempotencyKey }) {
    return request('POST', `/admin/billing/reviews/${encodeURIComponent(reviewId)}/resolution`, {
        resolution_status: resolutionStatus,
        resolution_note: resolutionNote,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiUsageAttempts({ status, organizationId, userId, feature, limit, cursor } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (organizationId) params.set('organization_id', organizationId);
    if (userId) params.set('user_id', userId);
    if (feature) params.set('feature', feature);
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/ai/usage-attempts${qs}`);
}

export function apiAdminAiUsageAttempt(attemptId) {
    return request('GET', `/admin/ai/usage-attempts/${encodeURIComponent(attemptId)}`);
}

export function apiAdminAiCleanupUsageAttempts({ limit, dryRun, idempotencyKey }) {
    return request('POST', '/admin/ai/usage-attempts/cleanup-expired', {
        limit,
        dry_run: dryRun !== false,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiBudgetSwitches(options) {
    return request('GET', '/admin/ai/budget-switches', undefined, options);
}

export function apiAdminAiUpdateBudgetSwitch(switchKey, { enabled, reason, idempotencyKey, metadata } = {}) {
    return request('PATCH', `/admin/ai/budget-switches/${encodeURIComponent(switchKey)}`, {
        enabled: enabled === true,
        reason,
        metadata,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiPlatformBudgetCaps(options) {
    return request('GET', '/admin/ai/platform-budget-caps', undefined, options);
}

export function apiAdminAiUpdatePlatformBudgetCap(budgetScope, { windowType, limitUnits, reason, idempotencyKey, metadata } = {}) {
    return request('PATCH', `/admin/ai/platform-budget-caps/${encodeURIComponent(budgetScope)}`, {
        window_type: windowType,
        limit_units: limitUnits,
        reason,
        metadata,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiPlatformBudgetUsage(options) {
    return request('GET', '/admin/ai/platform-budget-usage', undefined, options);
}

export function apiAdminAiPlatformBudgetReconciliation({ limit = 25, includeCandidates = true } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    params.set('includeCandidates', includeCandidates === false ? 'false' : 'true');
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/ai/platform-budget-reconciliation' + qs, undefined, options);
}

export function apiAdminAiRepairPlatformBudgetCandidate(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/ai/platform-budget-reconciliation/repair', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiPlatformBudgetRepairActions({ limit = 25 } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/ai/platform-budget-repair-actions' + qs, undefined, options);
}

export function apiAdminAiPlatformBudgetRepairAction(actionId, options) {
    return request('GET', `/admin/ai/platform-budget-repair-actions/${encodeURIComponent(actionId)}`, undefined, options);
}

export function apiAdminAiPlatformBudgetRepairReport({
    limit = 25,
    includeDetails = false,
    includeCandidates = false,
    status,
    candidateType,
    requestedAction,
} = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    params.set('includeDetails', includeDetails ? 'true' : 'false');
    params.set('includeCandidates', includeCandidates ? 'true' : 'false');
    if (status) params.set('status', String(status));
    if (candidateType) params.set('candidateType', String(candidateType));
    if (requestedAction) params.set('requestedAction', String(requestedAction));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/ai/platform-budget-repair-report' + qs, undefined, options);
}

export async function apiAdminAiPlatformBudgetRepairReportExport({
    format = 'json',
    limit = 50,
    includeDetails = true,
    includeCandidates = false,
} = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', String(limit || 50));
    params.set('includeDetails', includeDetails ? 'true' : 'false');
    params.set('includeCandidates', includeCandidates ? 'true' : 'false');
    const exportPath = '/admin/ai/platform-budget-repair-report/export';
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export function apiAdminAiPlatformBudgetEvidenceArchives({ limit = 25, status, archiveType, format } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (status) params.set('status', String(status));
    if (archiveType) params.set('archiveType', String(archiveType));
    if (format) params.set('format', String(format));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/ai/platform-budget-evidence-archives' + qs, undefined, options);
}

export function apiAdminTenantAssetManualReviewEvidence({ limit = 25, includeItems = true } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    params.set('includeItems', includeItems === false ? 'false' : 'true');
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/tenant-assets/folders-images/manual-review/evidence' + qs, undefined, options);
}

export function apiAdminTenantAssetManualReviewPostCleanupDryRun({ limit = 500, sampleLimit = 25 } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (sampleLimit) params.set('sampleLimit', String(sampleLimit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/tenant-assets/manual-review/post-cleanup/dry-run' + qs, undefined, options);
}

export function apiAdminTenantAssetManualReviewPostCleanupSupersede(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/tenant-assets/manual-review/post-cleanup/supersede', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminTenantAssetDomainEvidence(options) {
    return request('GET', '/admin/tenant-assets/domains/evidence', undefined, options);
}

export function apiAdminOwnershipBackfillDryRun({ limit = 50, includeDetails = true } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    params.set('includeDetails', includeDetails === false ? 'false' : 'true');
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/tenant-assets/ownership-backfill/dry-run' + qs, undefined, options);
}

export function apiAdminOwnershipBackfillExecute(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/tenant-assets/ownership-backfill/execute', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAccessSwitchStatus(options) {
    return request('GET', '/admin/tenant-assets/access-switch/status', undefined, options);
}

export function apiAdminAccessSwitchShadowDiagnostics({ limit = 50 } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/tenant-assets/access-switch/shadow-diagnostics' + qs, undefined, options);
}

export function apiAdminLegacyMediaResetStatus(options) {
    return request('GET', '/admin/tenant-assets/legacy-media-reset/status', undefined, options);
}

export async function apiAdminTenantIsolationEvidenceExport({
    scope = 'combined',
    format = 'json',
    limit = 50,
} = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', String(limit || 50));
    const paths = {
        backfill: '/admin/tenant-assets/ownership-backfill/evidence',
        access: '/admin/tenant-assets/access-switch/evidence',
        reset: '/admin/tenant-assets/legacy-media-reset/evidence',
        combined: '/admin/tenant-assets/tenant-isolation/evidence',
    };
    const exportPath = paths[scope] || paths.combined;
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export async function apiAdminLegacyMediaResetDryRunExport({
    format = 'json',
    limit = 50,
} = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', String(limit || 50));
    const exportPath = '/admin/tenant-assets/legacy-media-reset/dry-run/export';
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export async function apiAdminTenantAssetManualReviewEvidenceExport({
    format = 'json',
    limit = 50,
    includeItems = true,
} = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', String(limit || 50));
    params.set('includeItems', includeItems === false ? 'false' : 'true');
    const exportPath = '/admin/tenant-assets/folders-images/manual-review/evidence/export';
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export async function apiAdminTenantAssetManualReviewPostCleanupEvidenceExport({
    format = 'json',
    limit = 500,
    sampleLimit = 50,
} = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format);
    params.set('limit', String(limit || 500));
    params.set('sampleLimit', String(sampleLimit || 50));
    const exportPath = '/admin/tenant-assets/manual-review/post-cleanup/evidence';
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export function apiAdminTenantAssetManualReviewItems({
    limit = 25,
    offset,
    reviewStatus,
    issueCategory,
    severity,
    priority,
    assetDomain,
    assetId,
    includeEvents,
} = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    if (reviewStatus) params.set('reviewStatus', String(reviewStatus));
    if (issueCategory) params.set('issueCategory', String(issueCategory));
    if (severity) params.set('severity', String(severity));
    if (priority) params.set('priority', String(priority));
    if (assetDomain) params.set('assetDomain', String(assetDomain));
    if (assetId) params.set('assetId', String(assetId));
    if (includeEvents) params.set('includeEvents', 'true');
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', '/admin/tenant-assets/folders-images/manual-review/items' + qs, undefined, options);
}

export function apiAdminTenantAssetManualReviewItem(itemId, { includeEvents = true } = {}, options) {
    const params = new URLSearchParams();
    if (includeEvents) params.set('includeEvents', 'true');
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/tenant-assets/folders-images/manual-review/items/${encodeURIComponent(itemId)}${qs}`, undefined, options);
}

export function apiAdminTenantAssetManualReviewItemEvents(itemId, { limit = 25 } = {}, options) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/tenant-assets/folders-images/manual-review/items/${encodeURIComponent(itemId)}/events${qs}`, undefined, options);
}

export function apiAdminUpdateTenantAssetManualReviewStatus(itemId, {
    newStatus,
    reason,
    confirm,
    metadata,
    idempotencyKey,
} = {}) {
    return request('POST', `/admin/tenant-assets/folders-images/manual-review/items/${encodeURIComponent(itemId)}/status`, {
        newStatus,
        reason,
        confirm: confirm === true,
        metadata,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiCreatePlatformBudgetEvidenceArchive(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/ai/platform-budget-evidence-archives', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiExpirePlatformBudgetEvidenceArchive(archiveId, payload = {}, { idempotencyKey } = {}) {
    return request('POST', `/admin/ai/platform-budget-evidence-archives/${encodeURIComponent(archiveId)}/expire`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiAdminAiCleanupExpiredPlatformBudgetEvidenceArchives(payload = {}, { idempotencyKey } = {}) {
    return request('POST', '/admin/ai/platform-budget-evidence-archives/cleanup-expired', payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export async function apiAdminAiDownloadPlatformBudgetEvidenceArchive(archiveId, options = {}) {
    const exportPath = `/admin/ai/platform-budget-evidence-archives/${encodeURIComponent(archiveId)}/download`;
    try {
        const res = await fetch(BASE + exportPath, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            return {
                ok: true,
                text,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export function apiAdminDataLifecycleRequests({ limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/data-lifecycle/requests${qs}`);
}

export function apiAdminDataLifecycleRequest(requestId) {
    return request('GET', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}`);
}

export function apiAdminDataLifecycleGeneratePlan(requestId, { idempotencyKey } = {}) {
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/plan`, {}, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-plan') },
    });
}

export function apiAdminDataLifecycleApprove(requestId, { reason, idempotencyKey } = {}) {
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/approve`, {
        confirm: true,
        reason: reason || 'Admin approved data lifecycle request from detail overlay.',
    }, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-approve') },
    });
}

export function apiAdminDataLifecycleExecuteSafe(requestId, { dryRun = true, idempotencyKey } = {}) {
    const body = { dryRun: dryRun !== false };
    if (dryRun === false) body.confirm = true;
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/execute-safe`, body, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-execute-safe') },
    });
}

export function apiAdminDataLifecycleComplete(requestId, { completionNote, finalStatus, idempotencyKey } = {}) {
    const body = {
        confirm: true,
        completionNote: completionNote || 'Admin marked data lifecycle request complete after evidence review.',
    };
    if (finalStatus) body.finalStatus = finalStatus;
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/complete`, body, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-complete') },
    });
}

export function apiAdminDataLifecycleReject(requestId, { reason, idempotencyKey } = {}) {
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/reject`, {
        confirm: true,
        reason: reason || 'Admin rejected data lifecycle request from detail overlay.',
    }, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-reject') },
    });
}

export function apiAdminDataLifecycleClose(requestId, { reason, finalStatus, idempotencyKey } = {}) {
    const body = {
        confirm: true,
        reason: reason || 'Admin closed data lifecycle request from detail overlay.',
    };
    if (finalStatus) body.finalStatus = finalStatus;
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/close`, body, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-close') },
    });
}

export function apiAdminDataLifecycleGenerateExport(requestId, { idempotencyKey } = {}) {
    return request('POST', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/generate-export`, {
        confirm: true,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey || createAdminIdempotencyKey('data-lifecycle-export') },
    });
}

export function apiAdminDataLifecycleRequestExport(requestId) {
    return request('GET', `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/export`);
}

export async function apiAdminDataLifecycleRequestEvidence(requestId, { format = 'json' } = {}, options = {}) {
    const params = new URLSearchParams();
    params.set('format', format || 'json');
    const exportPath = `/admin/data-lifecycle/requests/${encodeURIComponent(requestId)}/evidence`;
    try {
        const res = await fetch(BASE + exportPath + '?' + params, {
            method: 'GET',
            credentials: 'include',
            headers: options.headers || {},
        });
        const text = await res.text();
        if (res.ok) {
            let data = null;
            if ((res.headers.get('content-type') || '').includes('application/json')) {
                try { data = JSON.parse(text); } catch { data = null; }
            }
            return {
                ok: true,
                text,
                data,
                status: res.status,
                contentType: res.headers.get('content-type') || '',
                filename: res.headers.get('content-disposition') || '',
            };
        }
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

export function apiAdminDataLifecycleArchives({ limit, cursor } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/data-lifecycle/exports${qs}`);
}

export function apiAdminAiModels(options) {
    return request('GET', '/admin/ai/models', undefined, options);
}

export function apiAdminAiTestText(payload, options) {
    return request('POST', '/admin/ai/test-text', payload, options);
}

export function apiAdminAiTestImage(payload, options) {
    return request('POST', '/admin/ai/test-image', payload, options);
}

export function apiAdminAiTestEmbeddings(payload, options) {
    return request('POST', '/admin/ai/test-embeddings', payload, options);
}

export function apiAdminAiTestMusic(payload, options) {
    return request('POST', '/admin/ai/test-music', payload, options);
}

export function apiAdminAiTestVideo(payload, options) {
    return request('POST', '/admin/ai/test-video', payload, options);
}

export function apiAdminAiCreateVideoJob(payload, options) {
    return request('POST', '/admin/ai/video-jobs', payload, options);
}

export function apiAdminAiGetVideoJob(jobId, options) {
    return request('GET', `/admin/ai/video-jobs/${encodeURIComponent(jobId)}`, undefined, options);
}

export function apiAdminAiRecoverVideoJob(jobId, payload, options) {
    return request('POST', `/admin/ai/video-jobs/${encodeURIComponent(jobId)}/recover`, payload, options);
}

export function apiAdminAiMediaSourceCandidates({ media, scope, limit, cursor } = {}, options) {
    const params = new URLSearchParams();
    if (media) params.set('media', String(media));
    if (scope) params.set('scope', String(scope));
    if (limit != null) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request('GET', '/admin/ai/media-source-candidates' + qs, undefined, options);
}

export function apiAdminAiVideoSourceCandidates({ scope, limit, cursor } = {}, options) {
    const params = new URLSearchParams();
    if (scope) params.set('scope', String(scope));
    if (limit != null) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request('GET', '/admin/ai/video-source-candidates' + qs, undefined, options);
}

export function apiAdminAiListVideoJobPoisonMessages({ limit, cursor } = {}, options) {
    const params = new URLSearchParams();
    if (limit != null) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request('GET', '/admin/ai/video-jobs/poison' + qs, undefined, options);
}

export function apiAdminAiGetVideoJobPoisonMessage(poisonId, options) {
    return request('GET', `/admin/ai/video-jobs/poison/${encodeURIComponent(poisonId)}`, undefined, options);
}

export function apiAdminAiListFailedVideoJobs({ limit, cursor } = {}, options) {
    const params = new URLSearchParams();
    if (limit != null) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request('GET', '/admin/ai/video-jobs/failed' + qs, undefined, options);
}

export function apiAdminAiGetFailedVideoJob(jobId, options) {
    return request('GET', `/admin/ai/video-jobs/failed/${encodeURIComponent(jobId)}`, undefined, options);
}

export function apiAdminAiCompare(payload, options) {
    return request('POST', '/admin/ai/compare', payload, options);
}

export async function apiAdminAiLiveAgent(payload, options = {}) {
    try {
        const opts = {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };
        if (options.signal) opts.signal = options.signal;
        const res = await fetch(BASE + '/admin/ai/live-agent', opts);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream') && res.ok && res.body) {
            return { ok: true, stream: true, body: res.body };
        }
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (res.ok) return { ok: true, data };
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
    }
}

/* ── Email Verification ── */

export function apiVerifyEmail(token) {
    return request('GET', `/verify-email?token=${encodeURIComponent(token)}`);
}

export function apiResendVerification(email) {
    return request('POST', '/resend-verification', { email });
}

export function apiRequestReverification() {
    return request('POST', '/request-reverification');
}

/* ── Assets Manager ── */

export async function apiAiGetQuota() {
    const res = await request('GET', '/ai/quota');
    return res.ok ? (res.data?.data || null) : null;
}

export function apiAccountCreditsDashboard({ limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/account/credits-dashboard${qs}`);
}

export function apiCancelMemberSubscription({ idempotencyKey } = {}) {
    return request('POST', '/account/billing/subscription/cancel', {
        confirmed: true,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiReactivateMemberSubscription({ idempotencyKey } = {}) {
    return request('POST', '/account/billing/subscription/reactivate', {
        confirmed: true,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

function createSafeRandomToken() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
        return cryptoApi.randomUUID();
    }
    if (cryptoApi?.getRandomValues) {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createAiImageIdempotencyKey(prefix = 'ai-image') {
    const safePrefix = String(prefix || 'ai-image')
        .replace(/[^A-Za-z0-9._:-]/g, '-')
        .slice(0, 48) || 'ai-image';
    const token = createSafeRandomToken().replace(/[^A-Za-z0-9._:-]/g, '-');
    return `${safePrefix}-${token}`.slice(0, 128);
}

export function createAdminIdempotencyKey(prefix = 'admin-action') {
    return createAiImageIdempotencyKey(prefix);
}

function hasHeader(headers, targetName) {
    const expected = targetName.toLowerCase();
    return Object.keys(headers || {}).some((name) => name.toLowerCase() === expected);
}

function withImageGenerationIdempotency(options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const headers = {
        ...(normalizedOptions.headers && typeof normalizedOptions.headers === 'object'
            ? normalizedOptions.headers
            : {}),
    };
    if (!hasHeader(headers, 'Idempotency-Key')) {
        headers['Idempotency-Key'] = createAiImageIdempotencyKey();
    }
    return {
        ...normalizedOptions,
        headers,
    };
}

function withGenerationRequestTimeout(options = {}) {
    return {
        ...(options && typeof options === 'object' ? options : {}),
        timeoutMs: BITBI_GENERATION_TIMEOUT_MS,
    };
}

export function apiAiGenerateImage(promptOrPayload, steps, seed, model, options = {}) {
    if (promptOrPayload && typeof promptOrPayload === 'object' && !Array.isArray(promptOrPayload)) {
        const requestOptions = steps && typeof steps === 'object' && !Array.isArray(steps)
            ? steps
            : options;
        return request('POST', '/ai/generate-image', promptOrPayload, withGenerationRequestTimeout(withImageGenerationIdempotency(requestOptions)));
    }

    const prompt = promptOrPayload;
    const body = { prompt };
    if (steps != null) body.steps = steps;
    if (seed != null) body.seed = seed;
    if (model) body.model = model;
    return request('POST', '/ai/generate-image', body, withGenerationRequestTimeout(withImageGenerationIdempotency(options)));
}

export function apiAiGenerateMusic(payload, options = {}) {
    return request('POST', '/ai/generate-music', payload, withGenerationRequestTimeout(options)).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export function apiAiGenerateVideo(payload, options = {}) {
    return request('POST', '/ai/generate-video', payload, withGenerationRequestTimeout(options)).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export async function apiAiGetFolders() {
    const res = await request('GET', '/ai/folders');
    const d = res.data?.data;
    const storageUsage = normalizeAssetStorageUsage(d?.storageUsage);
    // Backward compat: old worker returns { folders: [...] } without counts,
    // or legacy shape could be a bare array. Normalize both.
    if (Array.isArray(d)) {
        return { folders: d, counts: {}, unfolderedCount: 0, storageUsage: null };
    }
    if (d && typeof d === 'object') {
        return {
            folders: Array.isArray(d.folders) ? d.folders : [],
            counts: d.counts || {},
            unfolderedCount: d.unfolderedCount || 0,
            storageUsage,
        };
    }
    return { folders: [], counts: {}, unfolderedCount: 0, storageUsage: null };
}

export async function apiAiGetFoldersForDelete() {
    const res = await request('GET', '/ai/folders?include_deleting=1');
    return Array.isArray(res.data?.data?.folders) ? res.data.data.folders : [];
}

export function apiAiCreateFolder(name) {
    return request('POST', '/ai/folders', { name });
}

export function apiAiDeleteFolder(folderId) {
    return request('DELETE', `/ai/folders/${folderId}`);
}

export function apiAiRenameFolder(folderId, name) {
    return request('PATCH', `/ai/folders/${folderId}`, { name });
}

export async function apiAiGetImages(folderId, { onlyUnfoldered } = {}) {
    const params = new URLSearchParams();
    if (onlyUnfoldered) params.set('only_unfoldered', '1');
    else if (folderId) params.set('folder_id', folderId);
    const qs = params.toString() ? `?${params}` : '';
    const res = await request('GET', `/ai/images${qs}`);
    return Array.isArray(res.data?.data?.images) ? res.data.data.images : [];
}

export async function apiAiGetAssets(folderId, { onlyUnfoldered, limit, cursor } = {}) {
    const params = new URLSearchParams();
    if (onlyUnfoldered) params.set('only_unfoldered', '1');
    else if (folderId) params.set('folder_id', folderId);
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString() ? `?${params}` : '';
    const res = await request('GET', `/ai/assets${qs}`);
    if (!res.ok) {
        const error = new Error(res.error || 'Could not load saved assets.');
        error.code = res.code || null;
        error.status = res.status || 500;
        throw error;
    }
    const data = res.data?.data;
    return {
        assets: Array.isArray(data?.assets) ? data.assets : [],
        nextCursor: typeof data?.next_cursor === 'string' ? data.next_cursor : null,
        hasMore: data?.has_more === true,
        appliedLimit: Number.isFinite(Number(data?.applied_limit)) ? Number(data.applied_limit) : null,
        storageUsage: normalizeAssetStorageUsage(data?.storageUsage),
    };
}

export function apiAiSaveImage(imageSource, prompt, model, steps, seed, folderId) {
    const body = { prompt, model, steps, seed };
    if (imageSource && typeof imageSource === 'object' && !Array.isArray(imageSource)) {
        if (imageSource.saveReference) {
            body.save_reference = imageSource.saveReference;
        } else if (imageSource.imageData) {
            body.imageData = imageSource.imageData;
        }
    } else if (typeof imageSource === 'string' && imageSource) {
        body.imageData = imageSource;
    }
    if (folderId) body.folder_id = folderId;
    return request('POST', '/ai/images/save', body).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export function apiAiSaveAudio(payload) {
    return request('POST', '/ai/audio/save', payload).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export function apiAiAttachVideoPoster(assetId, posterBase64) {
    return request('POST', `/ai/text-assets/${encodeURIComponent(assetId)}/poster`, { posterBase64 }).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export function apiAiDeleteImage(imageId) {
    return request('DELETE', `/ai/images/${imageId}`);
}

export function apiAiRenameImage(imageId, name) {
    return request('PATCH', `/ai/images/${imageId}/rename`, { name });
}

export function apiAiSetImagePublication(imageId, visibility) {
    return request('PATCH', `/ai/images/${imageId}/publication`, { visibility });
}

export function apiAiSetTextAssetPublication(assetId, visibility) {
    return request('PATCH', `/ai/text-assets/${assetId}/publication`, { visibility });
}

export function apiAiDeleteTextAsset(assetId) {
    return request('DELETE', `/ai/text-assets/${assetId}`);
}

export function apiAiRenameTextAsset(assetId, name) {
    return request('PATCH', `/ai/text-assets/${assetId}/rename`, { name });
}

export function apiAiBulkMoveAssets(assetIds, folderId) {
    return request('PATCH', '/ai/assets/bulk-move', { asset_ids: assetIds, folder_id: folderId });
}

export function apiAiBulkDeleteAssets(assetIds) {
    return request('POST', '/ai/assets/bulk-delete', { asset_ids: assetIds });
}

export function apiAiBulkMoveImages(imageIds, folderId) {
    return request('PATCH', '/ai/images/bulk-move', { image_ids: imageIds, folder_id: folderId });
}

export function apiAiBulkDeleteImages(imageIds) {
    return request('POST', '/ai/images/bulk-delete', { image_ids: imageIds });
}

export function apiAdminAiSaveTextAsset(payload, options) {
    return request('POST', '/admin/ai/save-text-asset', payload, options);
}

/* ── Organizations / Billing ── */

export function apiListOrganizations({ limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/orgs${qs}`);
}

export function apiOrganizationBilling(orgId) {
    return request('GET', `/orgs/${encodeURIComponent(orgId)}/billing`);
}

export function apiOrganizationCreditsDashboard(orgId, { limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/orgs/${encodeURIComponent(orgId)}/billing/credits-dashboard${qs}`);
}

export function apiOrganizationDashboard(orgId, { limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/orgs/${encodeURIComponent(orgId)}/organization-dashboard${qs}`);
}

export function apiCreateCreditPackCheckout(orgId, {
    packId,
    idempotencyKey,
    termsAccepted,
    termsVersion,
    immediateDeliveryAccepted,
    acceptedAt,
} = {}) {
    return request('POST', `/orgs/${encodeURIComponent(orgId)}/billing/checkout/credit-pack`, {
        pack_id: packId,
        terms_accepted: termsAccepted === true,
        terms_version: termsVersion,
        immediate_delivery_accepted: immediateDeliveryAccepted === true,
        accepted_at: acceptedAt || null,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiCreateLiveCreditPackCheckout(orgId, {
    packId,
    idempotencyKey,
    termsAccepted,
    termsVersion,
    immediateDeliveryAccepted,
    acceptedAt,
} = {}) {
    return request('POST', `/orgs/${encodeURIComponent(orgId)}/billing/checkout/live-credit-pack`, {
        pack_id: packId,
        terms_accepted: termsAccepted === true,
        terms_version: termsVersion,
        immediate_delivery_accepted: immediateDeliveryAccepted === true,
        accepted_at: acceptedAt || null,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiCreateMemberLiveCreditPackCheckout({
    packId,
    idempotencyKey,
    termsAccepted,
    termsVersion,
    immediateDeliveryAccepted,
    acceptedAt,
} = {}) {
    return request('POST', '/account/billing/checkout/live-credit-pack', {
        pack_id: packId,
        terms_accepted: termsAccepted === true,
        terms_version: termsVersion,
        immediate_delivery_accepted: immediateDeliveryAccepted === true,
        accepted_at: acceptedAt || null,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

export function apiCreateMemberSubscriptionCheckout({
    idempotencyKey,
    termsAccepted,
    termsVersion,
    immediateDeliveryAccepted,
    acceptedAt,
} = {}) {
    return request('POST', '/account/billing/checkout/subscription', {
        terms_accepted: termsAccepted === true,
        terms_version: termsVersion,
        immediate_delivery_accepted: immediateDeliveryAccepted === true,
        accepted_at: acceptedAt || null,
    }, {
        headers: { 'Idempotency-Key': idempotencyKey },
    });
}

/* ── Password Reset ── */

export function apiForgotPassword(email) {
    return request('POST', '/forgot-password', { email });
}

export function apiValidateResetToken(token) {
    return request('GET', `/reset-password/validate?token=${encodeURIComponent(token)}`);
}

export function apiResetPassword(token, password) {
    return request('POST', '/reset-password', { token, password });
}
