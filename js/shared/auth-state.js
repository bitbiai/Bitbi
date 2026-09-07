/* ============================================================
   BITBI — Auth state: centralized state + CustomEvent dispatch
   ============================================================ */

import { apiGetMe, apiLogin, apiLogout, apiRegister } from './auth-api.js?v=__ASSET_VERSION__';

let state = { ready: false, loggedIn: false, user: null, sessionConfirmed: false };
let requestVersion = 0;

function dispatch() {
    document.dispatchEvent(new CustomEvent('bitbi:auth-change', { detail: state }));
}

export function getAuthState() {
    return { ...state };
}

export async function initAuth() {
    const version = ++requestVersion;
    const res = await apiGetMe();
    if (version !== requestVersion) return;
    if (res.ok && res.data?.loggedIn && res.data?.user) {
        state = { ready: true, loggedIn: true, user: res.data.user,
            sessionConfirmed: res.data.loggedIn === true
                && typeof res.data.user.id === 'string' && res.data.user.id.trim().length > 0
                && typeof res.data.user.role === 'string' && res.data.user.role.trim().length > 0 };
    } else {
        // /api/me reports a missing session as explicit guest JSON. Network/WAF
        // failures and malformed responses do not establish a logout.
        state = { ready: true, loggedIn: false, user: null,
            sessionConfirmed: res.ok && res.data?.loggedIn === false && res.data.user === null };
    }
    dispatch();
}

export async function authLogin(email, password) {
    const res = await apiLogin(email, password);
    if (res.ok) {
        await initAuth();
    }
    return res;
}

export async function authRegister(email, password) {
    return apiRegister(email, password);
}

export async function authLogout({ redirectTo = '' } = {}) {
    const res = await apiLogout();
    if (!res.ok) return res;

    requestVersion += 1; // A pre-logout /me response cannot restore the old actor.
    state = { ready: true, loggedIn: false, user: null, sessionConfirmed: true };
    dispatch();
    if (typeof window !== 'undefined' && window.location) {
        if (redirectTo) {
            window.location.assign(redirectTo);
        } else {
            window.location.reload();
        }
    }
    return res;
}

export function patchAuthUser(patch) {
    if (!state.loggedIn || !state.user || !patch || typeof patch !== 'object') return;
    state = {
        ...state,
        user: {
            ...state.user,
            ...patch,
        },
    };
    dispatch();
}
