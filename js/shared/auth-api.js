/* ============================================================
   BITBI — Auth API: pure fetch wrappers for auth endpoints
   ============================================================ */

const BASE = '/api';

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
    try {
        const opts = {
            method,
            credentials: 'include',
            headers: {},
        };
        if (options.signal) {
            opts.signal = options.signal;
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
        return { ok: false, error: data?.error || `Error ${res.status}`, code: data?.code || null, data, status: res.status };
    } catch (e) {
        if (e?.name === 'AbortError') {
            return { ok: false, aborted: true, error: 'Request cancelled.', code: 'request_aborted' };
        }
        return { ok: false, error: 'Network error. Please try again.', code: 'network_error' };
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

export function apiAdminChangeRole(userId, role) {
    return request('PATCH', `/admin/users/${userId}/role`, { role });
}

export function apiAdminChangeStatus(userId, status) {
    return request('PATCH', `/admin/users/${userId}/status`, { status });
}

export function apiAdminRevokeSessions(userId) {
    return request('POST', `/admin/users/${userId}/revoke-sessions`);
}

export function apiAdminDeleteUser(userId) {
    return request('DELETE', `/admin/users/${userId}`);
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

export function apiAdminBillingPlans() {
    return request('GET', '/admin/billing/plans');
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

export function apiAdminDeleteUserAsset(userId, assetId) {
    return request('DELETE', `/admin/users/${encodeURIComponent(userId)}/assets/${encodeURIComponent(assetId)}`);
}

export function apiAdminRenameUserFolder(userId, folderId, name) {
    return request('PATCH', `/admin/users/${encodeURIComponent(userId)}/folders/${encodeURIComponent(folderId)}`, { name });
}

export function apiAdminDeleteUserFolder(userId, folderId) {
    return request('DELETE', `/admin/users/${encodeURIComponent(userId)}/folders/${encodeURIComponent(folderId)}`);
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

export function apiAdminDataLifecycleRequests({ limit } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params}` : '';
    return request('GET', `/admin/data-lifecycle/requests${qs}`);
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

export function apiAiGenerateImage(promptOrPayload, steps, seed, model) {
    if (promptOrPayload && typeof promptOrPayload === 'object' && !Array.isArray(promptOrPayload)) {
        return request('POST', '/ai/generate-image', promptOrPayload);
    }

    const prompt = promptOrPayload;
    const body = { prompt };
    if (steps != null) body.steps = steps;
    if (seed != null) body.seed = seed;
    if (model) body.model = model;
    return request('POST', '/ai/generate-image', body);
}

export function apiAiGenerateMusic(payload, options = {}) {
    return request('POST', '/ai/generate-music', payload, options).then((res) => {
        if (res.ok) notifyAssetStorageChanged();
        return res;
    });
}

export function apiAiGenerateVideo(payload, options = {}) {
    return request('POST', '/ai/generate-video', payload, options).then((res) => {
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

/* ── Favorites ── */

export function apiGetFavorites() {
    return request('GET', '/favorites');
}

export function apiAddFavorite(item_type, item_id, title, thumb_url) {
    return request('POST', '/favorites', { item_type, item_id, title, thumb_url });
}

export function apiRemoveFavorite(item_type, item_id) {
    return request('DELETE', '/favorites', { item_type, item_id });
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
