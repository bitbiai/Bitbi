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
    if (res.ok && res.data?.email) {
        state = { loggedIn: true, user: res.data };
    } else {
        state = { loggedIn: false, user: null };
    }
    dispatch();
}

export async function authLogin(email, password) {
    const res = await apiLogin(email, password);
    if (res.ok) {
        state = { loggedIn: true, user: res.data || { email } };
        dispatch();
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
