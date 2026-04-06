/* ============================================================
   BITBI — Auth API: pure fetch wrappers for auth endpoints
   ============================================================ */

const BASE = '/api';

async function request(method, path, body) {
    try {
        const opts = {
            method,
            credentials: 'include',
            headers: {},
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(BASE + path, opts);
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (res.ok) return { ok: true, data };
        return { ok: false, error: data?.error || `Error ${res.status}`, data };
    } catch (e) {
        return { ok: false, error: 'Network error. Please try again.' };
    }
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

export function apiDeleteAvatar() {
    return request('DELETE', '/profile/avatar');
}

/* ── Admin API ── */

export function apiAdminMe() {
    return request('GET', '/admin/me');
}

export function apiAdminUsers(search) {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
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

/* ── Image Studio ── */

export async function apiAiGetQuota() {
    const res = await request('GET', '/ai/quota');
    return res.ok ? (res.data?.data || null) : null;
}

export function apiAiGenerateImage(prompt, steps, seed) {
    const body = { prompt };
    if (steps != null) body.steps = steps;
    if (seed != null) body.seed = seed;
    return request('POST', '/ai/generate-image', body);
}

export async function apiAiGetFolders() {
    const res = await request('GET', '/ai/folders');
    return Array.isArray(res.data?.data?.folders) ? res.data.data.folders : [];
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

export async function apiAiGetImages(folderId, { onlyUnfoldered } = {}) {
    const params = new URLSearchParams();
    if (onlyUnfoldered) params.set('only_unfoldered', '1');
    else if (folderId) params.set('folder_id', folderId);
    const qs = params.toString() ? `?${params}` : '';
    const res = await request('GET', `/ai/images${qs}`);
    return Array.isArray(res.data?.data?.images) ? res.data.data.images : [];
}

export function apiAiSaveImage(imageData, prompt, model, steps, seed, folderId) {
    const body = { imageData, prompt, model, steps, seed };
    if (folderId) body.folder_id = folderId;
    return request('POST', '/ai/images/save', body);
}

export function apiAiDeleteImage(imageId) {
    return request('DELETE', `/ai/images/${imageId}`);
}

export function apiAiBulkMoveImages(imageIds, folderId) {
    return request('PATCH', '/ai/images/bulk-move', { image_ids: imageIds, folder_id: folderId });
}

export function apiAiBulkDeleteImages(imageIds) {
    return request('POST', '/ai/images/bulk-delete', { image_ids: imageIds });
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
