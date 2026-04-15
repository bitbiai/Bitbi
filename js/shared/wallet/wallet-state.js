/* ============================================================
   BITBI — Wallet state
   Centralized UI state + CustomEvent dispatch for wallet UI.
   ============================================================ */

import {
    MAINNET_CHAIN_HEX,
    getChainLabel,
} from './wallet-config.js?v=__ASSET_VERSION__';

function createEmptyConnection() {
    return {
        type: null,
        id: null,
        providerName: '',
        providerIcon: '',
        address: '',
        shortAddress: '',
        chainId: null,
        chainHex: null,
        chainLabel: 'Not connected',
        isMainnet: false,
        balanceFormatted: '',
        balanceStatus: 'idle',
        balanceError: '',
        refreshedAt: '',
    };
}

function createEmptyLinkedWallet() {
    return null;
}

let state = {
    isOpen: false,
    workspaceOpen: false,
    status: 'disconnected',
    connectingConnectorId: null,
    injectedWallets: [],
    injectedDiscoveryState: 'idle',
    message: null,
    active: createEmptyConnection(),
    authReady: false,
    authLoggedIn: false,
    identityStatus: 'idle',
    identityAction: 'idle',
    pendingAuthIntent: null,
    linkedWallet: createEmptyLinkedWallet(),
};

function cloneMessage(message) {
    if (!message) return null;
    return {
        type: message.type,
        text: message.text,
    };
}

function cloneConnection(active) {
    return {
        ...active,
    };
}

function cloneLinkedWallet(linkedWallet) {
    if (!linkedWallet) return null;
    return {
        ...linkedWallet,
    };
}

function cloneState() {
    return {
        ...state,
        injectedWallets: state.injectedWallets.map(wallet => ({ ...wallet })),
        message: cloneMessage(state.message),
        active: cloneConnection(state.active),
        linkedWallet: cloneLinkedWallet(state.linkedWallet),
    };
}

function dispatch() {
    document.dispatchEvent(new CustomEvent('bitbi:wallet-change', { detail: cloneState() }));
}

export function getWalletState() {
    return cloneState();
}

export function subscribeWalletState(listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = (event) => listener(event.detail);
    document.addEventListener('bitbi:wallet-change', handler);
    listener(getWalletState());
    return () => document.removeEventListener('bitbi:wallet-change', handler);
}

export function patchWalletState(patch) {
    if (!patch || typeof patch !== 'object') return;

    state = {
        ...state,
        ...patch,
        injectedWallets: Array.isArray(patch.injectedWallets)
            ? patch.injectedWallets.map(wallet => ({ ...wallet }))
            : state.injectedWallets,
        message: Object.prototype.hasOwnProperty.call(patch, 'message')
            ? cloneMessage(patch.message)
            : state.message,
        active: patch.active
            ? {
                ...state.active,
                ...patch.active,
            }
            : state.active,
        linkedWallet: Object.prototype.hasOwnProperty.call(patch, 'linkedWallet')
            ? cloneLinkedWallet(patch.linkedWallet)
            : state.linkedWallet,
    };

    dispatch();
}

export function resetWalletConnection(overrides = {}) {
    patchWalletState({
        status: 'disconnected',
        connectingConnectorId: null,
        active: createEmptyConnection(),
        ...overrides,
    });
}

export function setWalletMessage(type, text) {
    if (!type || !text) {
        patchWalletState({ message: null });
        return;
    }

    patchWalletState({
        message: { type, text },
    });
}

export function updateWalletConnection(connection = {}) {
    const chainId = connection.chainId ?? null;
    const chainHex = connection.chainHex || (chainId != null ? `0x${Number(chainId).toString(16)}` : null);
    patchWalletState({
        status: 'connected',
        connectingConnectorId: null,
        active: {
            type: connection.type || null,
            id: connection.id || null,
            providerName: connection.providerName || '',
            providerIcon: connection.providerIcon || '',
            address: connection.address || '',
            shortAddress: connection.shortAddress || '',
            chainId,
            chainHex,
            chainLabel: connection.chainLabel || getChainLabel(chainId),
            isMainnet: chainHex === MAINNET_CHAIN_HEX,
            balanceFormatted: connection.balanceFormatted || '',
            balanceStatus: connection.balanceStatus || 'idle',
            balanceError: connection.balanceError || '',
            refreshedAt: connection.refreshedAt || '',
        },
    });
}

export function clearWalletIdentityState(overrides = {}) {
    patchWalletState({
        identityStatus: 'idle',
        identityAction: 'idle',
        pendingAuthIntent: null,
        linkedWallet: createEmptyLinkedWallet(),
        ...overrides,
    });
}
