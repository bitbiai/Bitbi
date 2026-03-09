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
        return { ok: false, error: data?.error || `Error ${res.status}` };
    } catch (e) {
        return { ok: false, error: 'Netzwerkfehler. Bitte versuche es erneut.' };
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
