/* ============================================================
   BITBI — Auth state: centralized state + CustomEvent dispatch
   ============================================================ */

import { apiGetMe, apiLogin, apiLogout, apiRegister } from './auth-api.js';

let state = { loggedIn: false, user: null };

function dispatch() {
    document.dispatchEvent(new CustomEvent('bitbi:auth-change', { detail: state }));
}

export function getAuthState() {
    return { ...state };
}

export async function initAuth() {
    const res = await apiGetMe();
    if (res.ok && res.data?.loggedIn && res.data?.user) {
        state = { loggedIn: true, user: res.data.user };
    } else {
        state = { loggedIn: false, user: null };
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

export async function authLogout() {
    await apiLogout();
    state = { loggedIn: false, user: null };
    dispatch();
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
