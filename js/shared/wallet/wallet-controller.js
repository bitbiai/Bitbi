/* ============================================================
   BITBI — Wallet controller
   Shared controller for wallet state, SIWE auth, connectors, and UI.
   ============================================================ */

import { apiWalletSiweNonce, apiWalletSiweVerify, apiWalletStatus, apiWalletUnlink } from '../auth-api.js?v=__ASSET_VERSION__';
import { getAuthState, initAuth } from '../auth-state.js';
import {
    MAINNET_CHAIN_HEX,
    WALLET_WORKSPACE_HASH,
    getAddressExplorerUrl,
    getChainLabel,
    getTransactionExplorerUrl,
    normalizeChainId,
    toChainHex,
    walletConfig,
} from './wallet-config.js?v=__ASSET_VERSION__';
import {
    connectInjectedWallet,
    hasInjectedWalletProvider,
    listInjectedWallets,
    restoreInjectedWallet,
    restoreInjectedWalletByAddress,
    startInjectedDiscovery,
} from './wallet-connectors.js?v=__ASSET_VERSION__';
import { buildSiweMessage, utf8ToHex } from './siwe-message.js?v=__ASSET_VERSION__';
import {
    getWalletState,
    patchWalletState,
    resetWalletConnection,
    setWalletMessage,
    updateWalletConnection,
} from './wallet-state.js?v=__ASSET_VERSION__';
import { initWalletUI } from './wallet-ui.js?v=__ASSET_VERSION__';
import { initWalletWorkspace } from './wallet-workspace.js?v=__ASSET_VERSION__';

let initialized = false;
let activeProvider = null;
let removeActiveListeners = null;
let messageTimer = null;
let balanceRequestToken = 0;
let restoreAttempted = false;
let walletStatusRequestToken = 0;
let transientDisconnectTimer = null;
let lifecycleReconcileTimer = null;
let reconcilePromise = null;
let disconnectConfirmationFingerprint = '';
let disconnectConfirmationReason = '';
let disconnectConfirmationCount = 0;
let workspaceHashRequested = false;

const PERSISTED_SELECTION_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSIENT_DISCONNECT_GRACE_MS = 1800;
const LIFECYCLE_RECONCILE_DELAY_MS = 240;

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (value == null || value === '') {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, value);
        }
    } catch {
        /* storage unavailable */
    }
}

function addressesEqual(left, right) {
    if (!left || !right) return false;
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function isWalletWorkspaceHashActive() {
    return window.location.hash.trim().toLowerCase() === WALLET_WORKSPACE_HASH;
}

function clearTransientDisconnectTimer() {
    if (!transientDisconnectTimer) return;
    window.clearTimeout(transientDisconnectTimer);
    transientDisconnectTimer = null;
}

function clearLifecycleReconcileTimer() {
    if (!lifecycleReconcileTimer) return;
    window.clearTimeout(lifecycleReconcileTimer);
    lifecycleReconcileTimer = null;
}

function parseStoredTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isPersistedSelectionClearlyStale(persisted) {
    const timestamp = parseStoredTimestamp(persisted?.updatedAt);
    if (!timestamp) return false;
    return (Date.now() - timestamp) > PERSISTED_SELECTION_STALE_MS;
}

function persistConnectionSnapshot(snapshot = {}) {
    writeStorage(walletConfig.storageKeys.connectorType, snapshot.type || null);
    writeStorage(walletConfig.storageKeys.connectorId, snapshot.id || null);
    writeStorage(walletConfig.storageKeys.address, snapshot.address || null);
    writeStorage(walletConfig.storageKeys.chainId, snapshot.chainId != null ? String(snapshot.chainId) : null);
    writeStorage(walletConfig.storageKeys.updatedAt, new Date().toISOString());
}

function clearPersistedSelection() {
    writeStorage(walletConfig.storageKeys.connectorType, null);
    writeStorage(walletConfig.storageKeys.connectorId, null);
    writeStorage(walletConfig.storageKeys.address, null);
    writeStorage(walletConfig.storageKeys.chainId, null);
    writeStorage(walletConfig.storageKeys.updatedAt, null);
}

function readPersistedSelection() {
    const type = readStorage(walletConfig.storageKeys.connectorType);
    const id = readStorage(walletConfig.storageKeys.connectorId);
    const address = readStorage(walletConfig.storageKeys.address);
    const chainId = normalizeChainId(readStorage(walletConfig.storageKeys.chainId));
    const updatedAt = readStorage(walletConfig.storageKeys.updatedAt);
    if (!type) return null;
    return { type, id, address, chainId, updatedAt };
}

function clearMessageTimer() {
    if (!messageTimer) return;
    window.clearTimeout(messageTimer);
    messageTimer = null;
}

function buildConnectionFingerprint(base = getWalletState().active, persisted = readPersistedSelection()) {
    const type = persisted?.type || base?.type || '';
    if (!type) return '';

    const id = persisted?.id || base?.id || '';
    const address = persisted?.address || base?.address || '';
    return `${type}:${id}:${String(address || '').trim().toLowerCase()}`;
}

function clearDisconnectConfirmation() {
    disconnectConfirmationFingerprint = '';
    disconnectConfirmationReason = '';
    disconnectConfirmationCount = 0;
}

function noteDisconnectConfirmation(fingerprint, reason = '') {
    if (!fingerprint) return 0;

    if (disconnectConfirmationFingerprint === fingerprint && disconnectConfirmationReason === reason) {
        disconnectConfirmationCount += 1;
    } else {
        disconnectConfirmationFingerprint = fingerprint;
        disconnectConfirmationReason = reason;
        disconnectConfirmationCount = 1;
    }

    return disconnectConfirmationCount;
}

function flashMessage(type, text, duration = 4200) {
    clearMessageTimer();
    setWalletMessage(type, text);
    if (duration > 0) {
        messageTimer = window.setTimeout(() => {
            setWalletMessage(null, null);
            messageTimer = null;
        }, duration);
    }
}

function normalizeWalletError(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message : '';
    const lower = message.toLowerCase();
    const code = error?.code;

    if (code === 4001 || lower.includes('user rejected') || lower.includes('user denied')) {
        return 'The wallet request was cancelled.';
    }
    if (code === -32002 || lower.includes('already pending')) {
        return 'A wallet request is already pending. Finish it in your wallet first.';
    }
    if (lower.includes('no longer available')) {
        return 'That browser wallet is no longer available. Refresh and try again.';
    }
    if (lower.includes('did not return an account')) {
        return 'The connected wallet did not expose an account.';
    }
    if (lower.includes('unauthorized') || lower.includes('unsupported method')) {
        return 'The connected wallet rejected this request.';
    }

    return fallback;
}

function normalizeApiError(result, fallback) {
    return typeof result?.error === 'string' && result.error.trim() ? result.error.trim() : fallback;
}

function shortenAddress(address) {
    if (typeof address !== 'string' || address.length < 10) return address || '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEthBalance(hexValue) {
    if (typeof hexValue !== 'string' || !hexValue) return '';
    const wei = BigInt(hexValue);
    const whole = wei / 1000000000000000000n;
    const fraction = wei % 1000000000000000000n;
    const fractionText = fraction.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
    const wholeText = whole.toLocaleString('en-US');
    return fractionText ? `${wholeText}.${fractionText} ETH` : `${wholeText} ETH`;
}

function getPersistedProviderName(persisted = {}) {
    if (persisted?.type === 'injected') {
        return 'Browser Wallet';
    }
    return 'Wallet';
}

function buildPersistedConnectionPreview(persisted = readPersistedSelection()) {
    if (!persisted?.type || !persisted?.address) return null;

    const chainId = normalizeChainId(persisted.chainId);
    return baseConnectionSnapshot({
        type: persisted.type,
        id: persisted.id || null,
        providerName: getPersistedProviderName(persisted),
        providerIcon: '',
        address: persisted.address,
        shortAddress: shortenAddress(persisted.address),
        chainId,
        chainHex: chainId != null ? toChainHex(chainId) : null,
        chainLabel: getChainLabel(chainId),
        refreshedAt: persisted.updatedAt || new Date().toISOString(),
    });
}

function hydratePersistedConnectionPreview(persisted = readPersistedSelection()) {
    const preview = buildPersistedConnectionPreview(persisted);
    if (!preview) return;

    const currentState = getWalletState();
    if (currentState.status === 'connected' && currentState.active.address) return;
    if (addressesEqual(currentState.active.address, preview.address)
        && currentState.active.type === preview.type
        && currentState.active.chainId === preview.chainId
        && currentState.active.providerName === preview.providerName) {
        return;
    }

    patchWalletState({
        active: {
            type: preview.type,
            id: preview.id,
            providerName: preview.providerName,
            providerIcon: preview.providerIcon,
            address: preview.address,
            shortAddress: preview.shortAddress,
            chainId: preview.chainId,
            chainHex: preview.chainHex,
            chainLabel: preview.chainLabel,
            isMainnet: preview.isMainnet,
            balanceFormatted: '',
            balanceStatus: 'idle',
            balanceError: '',
            refreshedAt: preview.refreshedAt,
        },
    });
}

function normalizeLinkedWallet(raw) {
    if (!raw || typeof raw !== 'object' || !raw.address) return null;
    return {
        address: raw.address,
        shortAddress: raw.short_address || shortenAddress(raw.address),
        chainId: normalizeChainId(raw.chain_id) || 1,
        linkedAt: raw.linked_at || '',
        lastLoginAt: raw.last_login_at || '',
        isPrimary: Boolean(raw.is_primary),
    };
}

function markWalletRestoring() {
    const state = getWalletState();
    if (state.status === 'connecting') return;
    patchWalletState({
        status: 'restoring',
        connectingConnectorId: null,
    });
}

function isPendingRestoreReason(reason) {
    return reason === 'waiting-for-provider';
}

function getWalletAuthView(state = getWalletState()) {
    const hasConnectedWallet = state.status === 'connected' && !!state.active.address;
    const linkedWallet = state.linkedWallet;
    const linkedMatchesActive = !!(linkedWallet && hasConnectedWallet && addressesEqual(linkedWallet.address, state.active.address));
    const connectedDiffersFromLinked = !!(linkedWallet && hasConnectedWallet && !linkedMatchesActive);
    return {
        hasConnectedWallet,
        linkedWallet,
        linkedMatchesActive,
        connectedDiffersFromLinked,
    };
}

async function copyText(value) {
    if (!value) return false;

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
    }

    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'absolute';
    field.style.left = '-9999px';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
}

async function readAccounts(provider) {
    if (!provider?.request) return [];
    const accounts = await provider.request({ method: 'eth_accounts' });
    return Array.isArray(accounts) ? accounts.filter(Boolean) : [];
}

async function readChainId(provider) {
    if (!provider) return null;
    const chainId = provider.chainId ?? await provider.request?.({ method: 'eth_chainId' });
    return normalizeChainId(chainId);
}

function cleanupProviderListeners() {
    clearTransientDisconnectTimer();
    if (typeof removeActiveListeners === 'function') {
        removeActiveListeners();
    }
    removeActiveListeners = null;
    activeProvider = null;
}

function finalizeDisconnectedState(message = 'The wallet disconnected from this site.', options = {}) {
    const { clearPersisted = true } = options;
    const { isOpen, workspaceOpen } = getWalletState();

    clearDisconnectConfirmation();
    cleanupProviderListeners();
    if (clearPersisted) {
        clearPersistedSelection();
    }

    resetWalletConnection({ isOpen, workspaceOpen });
    patchWalletState({
        identityAction: 'idle',
        pendingAuthIntent: null,
    });

    if (message) {
        flashMessage('info', message);
    }
}

function baseConnectionSnapshot(connection = {}) {
    const chainId = normalizeChainId(connection.chainId);
    const chainHex = chainId != null ? toChainHex(chainId) : (connection.chainHex || null);
    return {
        type: connection.type || null,
        id: connection.id || null,
        providerName: connection.providerName || '',
        providerIcon: connection.providerIcon || '',
        address: connection.address || '',
        shortAddress: connection.shortAddress || shortenAddress(connection.address),
        chainId,
        chainHex,
        chainLabel: chainId != null ? getChainLabel(chainId) : (connection.chainLabel || 'Not connected'),
        isMainnet: chainHex === MAINNET_CHAIN_HEX,
        refreshedAt: connection.refreshedAt || new Date().toISOString(),
    };
}

async function refreshBalance(provider, snapshot) {
    const requestToken = ++balanceRequestToken;

    if (!snapshot.address || !snapshot.isMainnet) {
        patchWalletState({
            active: {
                balanceStatus: snapshot.address ? 'unavailable' : 'idle',
                balanceFormatted: '',
                balanceError: snapshot.address ? 'Switch to Ethereum Mainnet to load the ETH balance.' : '',
                refreshedAt: new Date().toISOString(),
            },
        });
        return;
    }

    patchWalletState({
        active: {
            balanceStatus: 'loading',
            balanceFormatted: '',
            balanceError: '',
        },
    });

    try {
        const balanceHex = await provider.request({
            method: 'eth_getBalance',
            params: [snapshot.address, 'latest'],
        });

        if (requestToken !== balanceRequestToken) return;

        patchWalletState({
            active: {
                balanceStatus: 'loaded',
                balanceFormatted: formatEthBalance(balanceHex),
                balanceError: '',
                refreshedAt: new Date().toISOString(),
            },
        });
    } catch {
        if (requestToken !== balanceRequestToken) return;
        patchWalletState({
            active: {
                balanceStatus: 'error',
                balanceFormatted: '',
                balanceError: 'Could not load the ETH balance.',
                refreshedAt: new Date().toISOString(),
            },
        });
    }
}

async function readConnectionSnapshotFromProvider(provider, base = {}) {
    if (!provider?.request) return null;

    const accounts = await readAccounts(provider);
    const address = accounts[0];
    if (!address) return null;

    const chainId = await readChainId(provider);
    return baseConnectionSnapshot({
        ...getWalletState().active,
        ...base,
        address,
        chainId,
    });
}

function ensureActiveProviderConnection() {
    const state = getWalletState();
    if (state.status !== 'connected' || !state.active.address || !activeProvider?.request) {
        throw new Error('Connect a wallet first.');
    }
    return state;
}

function normalizeHexQuantity(value) {
    const normalized = BigInt(value);
    return `0x${normalized.toString(16)}`;
}

async function getGasPriceWei(provider) {
    const value = await provider.request({ method: 'eth_gasPrice' });
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('The wallet did not return a gas price.');
    }
    return BigInt(value);
}

async function getMaxSendableWei(recipient = '') {
    const state = ensureActiveProviderConnection();

    if (!state.active.isMainnet) {
        throw new Error('Switch to Ethereum Mainnet before preparing a send amount.');
    }

    const balanceHex = await activeProvider.request({
        method: 'eth_getBalance',
        params: [state.active.address, 'latest'],
    });
    const balanceWei = BigInt(balanceHex);
    const gasPriceWei = await getGasPriceWei(activeProvider);

    let gasLimitWei = 21000n;
    if (recipient) {
        try {
            const gasEstimate = await activeProvider.request({
                method: 'eth_estimateGas',
                params: [{
                    from: state.active.address,
                    to: recipient,
                    value: '0x0',
                }],
            });
            if (typeof gasEstimate === 'string' && gasEstimate.trim()) {
                gasLimitWei = BigInt(gasEstimate);
            }
        } catch {
            gasLimitWei = 21000n;
        }
    }

    const reserveWei = gasPriceWei * gasLimitWei;
    return balanceWei > reserveWei ? (balanceWei - reserveWei) : 0n;
}

async function refreshWalletStatus() {
    const authState = getAuthState();
    const requestToken = ++walletStatusRequestToken;

    if (!authState.ready) {
        patchWalletState({
            authReady: false,
            authLoggedIn: false,
            identityStatus: 'idle',
        });
        return null;
    }

    if (!authState.loggedIn) {
        patchWalletState({
            authReady: true,
            authLoggedIn: false,
            identityStatus: 'ready',
            identityAction: getWalletState().identityAction === 'unlinking' ? 'unlinking' : 'idle',
            linkedWallet: null,
            pendingAuthIntent: getWalletState().pendingAuthIntent === 'login' ? 'login' : null,
        });
        return null;
    }

    patchWalletState({
        authReady: true,
        authLoggedIn: true,
        identityStatus: 'loading',
    });

    const result = await apiWalletStatus();
    if (requestToken !== walletStatusRequestToken) return null;

    if (!result.ok) {
        patchWalletState({
            identityStatus: 'error',
        });
        return null;
    }

    const linkedWallet = normalizeLinkedWallet(result.data?.linked_wallet);
    patchWalletState({
        authReady: true,
        authLoggedIn: !!result.data?.authenticated,
        identityStatus: 'ready',
        linkedWallet,
        pendingAuthIntent: getWalletState().pendingAuthIntent === 'login' ? null : getWalletState().pendingAuthIntent,
    });
    return linkedWallet;
}

async function syncConnectionFromProvider(provider, base = {}, options = {}) {
    if (!provider) return;

    const {
        disconnectOnMissingAddress = true,
        clearPersistedOnDisconnect = true,
        disconnectMessage = 'The wallet disconnected from this site.',
    } = options;

    const snapshot = await readConnectionSnapshotFromProvider(provider, base);
    if (!snapshot) {
        if (disconnectOnMissingAddress) {
            finalizeDisconnectedState(disconnectMessage, { clearPersisted: clearPersistedOnDisconnect });
        }
        return null;
    }

    clearDisconnectConfirmation();
    clearTransientDisconnectTimer();
    updateWalletConnection({
        ...snapshot,
        balanceStatus: snapshot.isMainnet ? 'loading' : 'unavailable',
        balanceFormatted: '',
        balanceError: snapshot.isMainnet ? '' : 'Switch to Ethereum Mainnet to load the ETH balance.',
    });
    persistConnectionSnapshot(snapshot);
    await refreshBalance(provider, snapshot);
    return snapshot;
}

async function restorePersistedConnection(persisted = readPersistedSelection()) {
    if (!persisted?.type) {
        return { connection: null, reason: 'none' };
    }

    if (persisted.type === 'injected' && persisted.id) {
        const availableInjectedWallets = listInjectedWallets();
        if (!hasInjectedWalletProvider(persisted.id)) {
            if (persisted.address) {
                const matchedByAddress = await restoreInjectedWalletByAddress(persisted.address);
                if (matchedByAddress) {
                    return {
                        connection: matchedByAddress,
                        reason: 'restored',
                    };
                }
            }

            if (availableInjectedWallets.length === 0) {
                return { connection: null, reason: 'waiting-for-provider' };
            }

            return { connection: null, reason: 'no-account' };
        }

        const connection = await restoreInjectedWallet(persisted.id);
        if (connection) {
            return {
                connection,
                reason: 'restored',
            };
        }

        if (persisted.address) {
            const matchedByAddress = await restoreInjectedWalletByAddress(persisted.address);
            if (matchedByAddress) {
                return {
                    connection: matchedByAddress,
                    reason: 'restored',
                };
            }
        }

        if (availableInjectedWallets.length === 0) {
            return { connection: null, reason: 'waiting-for-provider' };
        }

        return {
            connection: null,
            reason: 'no-account',
        };
    }

    return { connection: null, reason: 'unsupported' };
}

async function reconcileConnectionState(options = {}) {
    const {
        provider = activeProvider,
        base = getWalletState().active,
        allowPersistedRestore = true,
        markRestoringState = false,
        clearOnConfirmedDisconnect = false,
        disconnectMessage = 'The wallet disconnected from this site.',
    } = options;

    if (reconcilePromise) return reconcilePromise;

    if (markRestoringState && readPersistedSelection()) {
        markWalletRestoring();
    }

    reconcilePromise = (async () => {
        const persisted = allowPersistedRestore ? readPersistedSelection() : null;
        if (persisted) {
            hydratePersistedConnectionPreview(persisted);
        }
        const connectionFingerprint = buildConnectionFingerprint(base, persisted);
        let providerReadFailed = false;
        let providerReportedNoAccount = false;
        let restoreFailed = false;
        let restoreOutcome = { connection: null, reason: persisted ? 'unavailable' : 'none' };

        if (provider?.request) {
            try {
                const synced = await syncConnectionFromProvider(provider, base, {
                    disconnectOnMissingAddress: false,
                });
                if (synced) {
                    clearDisconnectConfirmation();
                    return synced;
                }
                providerReportedNoAccount = true;
            } catch (error) {
                providerReadFailed = true;
                console.warn('walletReconcile:provider', error);
            }
        }

        if (persisted) {
            try {
                restoreOutcome = await restorePersistedConnection(persisted);
                if (restoreOutcome?.connection) {
                    clearDisconnectConfirmation();
                    await activateConnection(restoreOutcome.connection, { message: null, persist: true });
                    return restoreOutcome.connection;
                }
            } catch (error) {
                restoreFailed = true;
                console.warn('walletReconcile:restore', error);
            }
        }

        if (providerReadFailed || restoreFailed) {
            if (persisted) {
                markWalletRestoring();
            }
            scheduleLifecycleReconcile('reconcile-retry');
            return null;
        }

        if (persisted && isPendingRestoreReason(restoreOutcome.reason)) {
            clearDisconnectConfirmation();
            markWalletRestoring();
            return null;
        }

        if (clearOnConfirmedDisconnect) {
            const attemptCount = noteDisconnectConfirmation(
                connectionFingerprint,
                `${providerReportedNoAccount ? 'provider-empty' : 'no-provider'}:${restoreOutcome.reason || 'unknown'}`,
            );
            if (attemptCount >= 2) {
                const shouldClearPersisted = restoreOutcome.reason === 'no-account' || restoreOutcome.reason === 'unsupported';
                finalizeDisconnectedState(disconnectMessage, { clearPersisted: shouldClearPersisted });
            } else {
                if (persisted) {
                    markWalletRestoring();
                }
                scheduleTransientConnectionVerification(provider, base, 'disconnect-reconfirm');
            }
            return null;
        }

        if (persisted) {
            noteDisconnectConfirmation(
                connectionFingerprint,
                `restore:${restoreOutcome.reason || 'unknown'}`,
            );
            if (restoreOutcome.reason === 'waiting-for-provider') {
                markWalletRestoring();
                return null;
            }
        }

        if (persisted && (isPersistedSelectionClearlyStale(persisted) || restoreOutcome.reason === 'unsupported' || restoreOutcome.reason === 'no-account')) {
            clearPersistedSelection();
        }

        if (getWalletState().status === 'restoring') {
            clearDisconnectConfirmation();
            const { isOpen, workspaceOpen } = getWalletState();
            resetWalletConnection({ isOpen, workspaceOpen });
        }

        return null;
    })().finally(() => {
        reconcilePromise = null;
    });

    return reconcilePromise;
}

function scheduleTransientConnectionVerification(provider, base = {}, reason = 'provider') {
    clearTransientDisconnectTimer();
    transientDisconnectTimer = window.setTimeout(() => {
        transientDisconnectTimer = null;
        if (activeProvider !== provider) return;
        void reconcileConnectionState({
            provider,
            base,
            allowPersistedRestore: true,
            clearOnConfirmedDisconnect: true,
            disconnectMessage: 'The wallet disconnected from this site.',
        });
    }, TRANSIENT_DISCONNECT_GRACE_MS);
}

function scheduleLifecycleReconcile(reason = 'lifecycle') {
    const persisted = readPersistedSelection();
    if (getWalletState().status === 'connecting') return;
    if (!activeProvider?.request && !persisted) return;

    clearLifecycleReconcileTimer();
    lifecycleReconcileTimer = window.setTimeout(() => {
        lifecycleReconcileTimer = null;
        void reconcileConnectionState({
            allowPersistedRestore: true,
            markRestoringState: getWalletState().status !== 'connected',
            clearOnConfirmedDisconnect: false,
        });
    }, LIFECYCLE_RECONCILE_DELAY_MS);
}

function bindProviderEvents(connection) {
    cleanupProviderListeners();
    activeProvider = connection.provider;
    if (!activeProvider?.on) return;

    const handleAccountsChanged = (accounts) => {
        if (activeProvider !== connection.provider) return;
        const nextAddress = Array.isArray(accounts) ? accounts[0] : '';
        if (!nextAddress) {
            scheduleTransientConnectionVerification(connection.provider, connection, 'accountsChanged');
            return;
        }
        void syncConnectionFromProvider(connection.provider, connection, {
            disconnectOnMissingAddress: false,
        }).catch((error) => {
            console.warn('walletEvent:accountsChanged', error);
            scheduleLifecycleReconcile('accountsChanged');
        });
    };

    const handleChainChanged = () => {
        if (activeProvider !== connection.provider) return;
        void syncConnectionFromProvider(connection.provider, connection, {
            disconnectOnMissingAddress: false,
        }).catch((error) => {
            console.warn('walletEvent:chainChanged', error);
            scheduleLifecycleReconcile('chainChanged');
        });
    };

    const handleDisconnect = () => {
        if (activeProvider !== connection.provider) return;
        scheduleTransientConnectionVerification(connection.provider, connection, 'disconnect');
    };

    activeProvider.on('accountsChanged', handleAccountsChanged);
    activeProvider.on('chainChanged', handleChainChanged);
    activeProvider.on('disconnect', handleDisconnect);

    removeActiveListeners = () => {
        activeProvider?.removeListener?.('accountsChanged', handleAccountsChanged);
        activeProvider?.removeListener?.('chainChanged', handleChainChanged);
        activeProvider?.removeListener?.('disconnect', handleDisconnect);
    };
}

async function activateConnection(connection, options = {}) {
    clearDisconnectConfirmation();
    clearTransientDisconnectTimer();
    const snapshot = baseConnectionSnapshot(connection);
    bindProviderEvents(connection);
    updateWalletConnection({
        ...snapshot,
        balanceStatus: snapshot.isMainnet ? 'loading' : 'unavailable',
        balanceFormatted: '',
        balanceError: snapshot.isMainnet ? '' : 'Switch to Ethereum Mainnet to load the ETH balance.',
    });
    await refreshBalance(connection.provider, snapshot);

    if (options.persist !== false) {
        persistConnectionSnapshot(snapshot);
    }

    if (options.message === null) {
        setWalletMessage(null, null);
    } else if (options.message) {
        flashMessage('success', options.message);
    }
}

async function restorePreviousConnection() {
    if (restoreAttempted) return;
    const currentState = getWalletState();
    if (currentState.status === 'connected' && currentState.active.address) {
        restoreAttempted = true;
        return;
    }
    restoreAttempted = true;

    const persisted = readPersistedSelection();
    if (!persisted) return;

    hydratePersistedConnectionPreview(persisted);
    markWalletRestoring();

    try {
        const outcome = await restorePersistedConnection(persisted);

        if (outcome?.connection) {
            clearDisconnectConfirmation();
            await activateConnection(outcome.connection, { message: null, persist: true });
            return;
        }

        if (isPersistedSelectionClearlyStale(persisted)) {
            clearPersistedSelection();
            clearDisconnectConfirmation();
            const { isOpen, workspaceOpen } = getWalletState();
            resetWalletConnection({ isOpen, workspaceOpen });
            return;
        }

        if (outcome?.reason === 'waiting-for-provider') {
            markWalletRestoring();
            return;
        }

        clearPersistedSelection();
        clearDisconnectConfirmation();
        {
            const { isOpen, workspaceOpen } = getWalletState();
            resetWalletConnection({ isOpen, workspaceOpen });
        }
    } catch (error) {
        console.warn('walletRestore:', error);
        if (isPersistedSelectionClearlyStale(persisted)) {
            clearPersistedSelection();
            clearDisconnectConfirmation();
            const { isOpen, workspaceOpen } = getWalletState();
            resetWalletConnection({ isOpen, workspaceOpen });
            return;
        }
        markWalletRestoring();
        scheduleLifecycleReconcile('restore-error');
    }
}

function isRetryablePersonalSignError(error) {
    const lower = String(error?.message || '').toLowerCase();
    if (!lower) return false;
    return (
        lower.includes('invalid params')
        || lower.includes('expected a hex')
        || lower.includes('hex string')
        || lower.includes('invalid input')
        || lower.includes('must provide an ethereum address')
        || lower.includes('invalid address')
        || lower.includes('unsupported format')
    );
}

async function signMessageWithProvider(provider, address, message) {
    const hexMessage = utf8ToHex(message);
    const attempts = [
        [hexMessage, address],
        [address, hexMessage],
        [message, address],
        [address, message],
    ];

    let lastError = null;
    for (const params of attempts) {
        try {
            return await provider.request({
                method: 'personal_sign',
                params,
            });
        } catch (error) {
            lastError = error;
            if (!isRetryablePersonalSignError(error)) {
                throw error;
            }
        }
    }

    throw lastError || new Error('The wallet could not sign this message.');
}

function ensureWalletReadyForIntent(intent) {
    const state = getWalletState();
    const authState = getAuthState();

    if (state.identityAction !== 'idle' || state.status === 'connecting') {
        return false;
    }

    if (intent === 'link' && !authState.loggedIn) {
        patchWalletState({ pendingAuthIntent: null });
        flashMessage('warning', 'Sign in to your BITBI account before linking a wallet.');
        return false;
    }

    if (intent === 'login' && authState.loggedIn) {
        patchWalletState({ pendingAuthIntent: null });
        flashMessage('info', 'You are already signed in.');
        return false;
    }

    if (state.status !== 'connected' || !state.active.address || !activeProvider?.request) {
        patchWalletState({ pendingAuthIntent: intent, isOpen: true });
        flashMessage('info', intent === 'login'
            ? 'Connect a wallet first, then continue with Sign in with Ethereum.'
            : 'Connect the wallet you want to link, then continue.');
        return false;
    }

    if (!state.active.isMainnet) {
        patchWalletState({ pendingAuthIntent: intent, isOpen: true });
        flashMessage('warning', 'Switch to Ethereum Mainnet before continuing.');
        return false;
    }

    const authView = getWalletAuthView(state);
    if (intent === 'link' && authView.linkedWallet && authView.connectedDiffersFromLinked) {
        patchWalletState({ pendingAuthIntent: 'link', isOpen: true });
        flashMessage('warning', 'A different wallet is already linked to this BITBI account. Unlink it before linking another wallet.');
        return false;
    }

    return true;
}

async function performSiweIntent(intent) {
    if (!ensureWalletReadyForIntent(intent)) return;

    const state = getWalletState();
    const address = state.active.address;
    if (!address || !activeProvider?.request) return;

    patchWalletState({
        pendingAuthIntent: intent,
        identityAction: 'requesting',
    });

    const nonceResult = await apiWalletSiweNonce(intent);
    if (!nonceResult.ok || !nonceResult.data?.challenge) {
        patchWalletState({ identityAction: 'idle' });
        if (nonceResult.status === 401 && intent === 'link') {
            await initAuth();
        }
        flashMessage('error', normalizeApiError(nonceResult, 'Could not start the wallet request.'));
        return;
    }

    let message = '';
    try {
        message = buildSiweMessage({
            ...nonceResult.data.challenge,
            address,
        });
    } catch {
        patchWalletState({ identityAction: 'idle' });
        flashMessage('error', 'Could not prepare the wallet message.');
        return;
    }

    let signature = '';
    try {
        patchWalletState({ identityAction: 'signing' });
        signature = await signMessageWithProvider(activeProvider, address, message);
    } catch (error) {
        patchWalletState({ identityAction: 'idle' });
        flashMessage('warning', normalizeWalletError(error, 'The wallet signature request was cancelled.'));
        return;
    }

    patchWalletState({ identityAction: 'verifying' });
    const verifyResult = await apiWalletSiweVerify(intent, message, signature);
    if (!verifyResult.ok) {
        patchWalletState({ identityAction: 'idle' });
        if (verifyResult.status === 401 && intent === 'link') {
            await initAuth();
        }
        flashMessage('error', normalizeApiError(verifyResult, intent === 'login'
            ? 'That wallet could not sign in on BITBI.'
            : 'That wallet could not be linked to this BITBI account.'));
        return;
    }

    if (intent === 'login') {
        await initAuth();
        await refreshWalletStatus();
        patchWalletState({
            identityAction: 'idle',
            pendingAuthIntent: null,
        });
        flashMessage('success', 'Signed in with Ethereum.');
        return;
    }

    patchWalletState({
        identityAction: 'idle',
        identityStatus: 'ready',
        pendingAuthIntent: null,
        linkedWallet: normalizeLinkedWallet(verifyResult.data?.linked_wallet),
    });
    flashMessage('success', 'Wallet linked to your BITBI account.');
}

async function connectInjected(id) {
    if (!id) return;

    clearDisconnectConfirmation();
    clearTransientDisconnectTimer();
    clearLifecycleReconcileTimer();
    patchWalletState({
        status: 'connecting',
        connectingConnectorId: id,
        message: null,
    });

    try {
        const connection = await connectInjectedWallet(id);
        await activateConnection(connection, {
            message: `${connection.providerName || 'Wallet'} connected.`,
        });
    } catch (error) {
        const { isOpen, workspaceOpen } = getWalletState();
        resetWalletConnection({ isOpen, workspaceOpen });
        flashMessage('error', normalizeWalletError(error, 'Could not connect that browser wallet.'));
    }
}

async function disconnectActiveWallet() {
    const currentState = getWalletState();
    const isOpen = currentState.isOpen;
    const workspaceOpen = currentState.workspaceOpen;

    clearDisconnectConfirmation();
    clearLifecycleReconcileTimer();
    cleanupProviderListeners();
    clearPersistedSelection();
    resetWalletConnection({ isOpen, workspaceOpen });
    patchWalletState({
        identityAction: 'idle',
        pendingAuthIntent: null,
    });

    flashMessage('info', 'Wallet disconnected.');
}

async function switchToEthereumMainnet() {
    if (!activeProvider?.request) return;

    try {
        await activeProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: MAINNET_CHAIN_HEX }],
        });
        await syncConnectionFromProvider(activeProvider);
        flashMessage('success', 'Switched to Ethereum Mainnet.');
    } catch (error) {
        const message = normalizeWalletError(error, 'The wallet stayed on its current network.');
        flashMessage('warning', message);
    }
}

async function copyConnectedAddress() {
    const address = getWalletState().active.address;
    if (!address) return;

    try {
        const copied = await copyText(address);
        flashMessage(copied ? 'success' : 'warning', copied ? 'Address copied.' : 'Could not copy the address.');
    } catch {
        flashMessage('warning', 'Could not copy the address.');
    }
}

async function refreshActiveWalletConnection() {
    const state = getWalletState();
    if (state.status !== 'connected' || !activeProvider?.request) {
        throw new Error('Connect a wallet first.');
    }

    const snapshot = await syncConnectionFromProvider(activeProvider, state.active, {
        disconnectOnMissingAddress: false,
    });
    if (!snapshot) {
        throw new Error('The connected wallet could not be refreshed right now.');
    }
    return getWalletState().active;
}

async function sendNativeTransaction({ to, valueWei } = {}) {
    const state = ensureActiveProviderConnection();

    if (!state.active.isMainnet) {
        throw new Error('Switch to Ethereum Mainnet before sending ETH from BITBI.');
    }

    const recipient = typeof to === 'string' ? to.trim() : '';
    if (!recipient) {
        throw new Error('Enter a recipient address.');
    }

    const normalizedValue = BigInt(valueWei ?? 0);
    if (normalizedValue <= 0n) {
        throw new Error('Enter an amount greater than 0.');
    }

    const txHash = await activeProvider.request({
        method: 'eth_sendTransaction',
        params: [{
            from: state.active.address,
            to: recipient,
            value: normalizeHexQuantity(normalizedValue),
        }],
    });

    return {
        hash: typeof txHash === 'string' ? txHash : '',
        explorerUrl: getTransactionExplorerUrl(state.active.chainId, txHash),
        chainId: state.active.chainId,
    };
}

async function unlinkLinkedWallet() {
    const authState = getAuthState();
    if (!authState.loggedIn) {
        flashMessage('warning', 'Sign in to your BITBI account before unlinking a wallet.');
        return;
    }

    const currentState = getWalletState();
    if (currentState.identityAction !== 'idle') return;

    patchWalletState({ identityAction: 'unlinking' });
    const result = await apiWalletUnlink();
    if (!result.ok) {
        patchWalletState({ identityAction: 'idle' });
        if (result.status === 401) {
            await initAuth();
        }
        flashMessage('error', normalizeApiError(result, 'Could not unlink that wallet.'));
        return;
    }

    patchWalletState({
        identityAction: 'idle',
        identityStatus: 'ready',
        linkedWallet: null,
        pendingAuthIntent: null,
    });
    flashMessage('success', 'Wallet unlinked from your BITBI account.');
}

function openWalletPanel() {
    patchWalletState({ isOpen: true });
}

function closeWalletPanel() {
    patchWalletState({ isOpen: false });
}

function openWalletWorkspace(options = {}) {
    const { fromHash = false } = options;
    workspaceHashRequested = fromHash || isWalletWorkspaceHashActive();
    patchWalletState({
        workspaceOpen: true,
        isOpen: fromHash ? getWalletState().isOpen : false,
    });
}

function closeWalletWorkspace(options = {}) {
    const { clearHash = true } = options;
    workspaceHashRequested = false;
    patchWalletState({ workspaceOpen: false });

    if (clearHash && isWalletWorkspaceHashActive()) {
        history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
}

function syncWorkspaceHashRoute() {
    const shouldOpen = isWalletWorkspaceHashActive();
    const state = getWalletState();

    if (shouldOpen) {
        if (!state.workspaceOpen) {
            openWalletWorkspace({ fromHash: true });
        } else {
            workspaceHashRequested = true;
        }
        return;
    }

    if (workspaceHashRequested && state.workspaceOpen) {
        closeWalletWorkspace({ clearHash: false });
        return;
    }

    workspaceHashRequested = false;
}

function syncAuthState(authState = getAuthState()) {
    patchWalletState({
        authReady: !!authState.ready,
        authLoggedIn: !!authState.loggedIn,
    });

    void refreshWalletStatus();
}

export function initWalletController() {
    if (initialized) return;

    const hasDesktopActions = !!document.querySelector('.site-nav__actions');
    const hasMobileNav = !!document.getElementById('mobileNav');
    if (!hasDesktopActions && !hasMobileNav) return;

    initialized = true;
    patchWalletState({
        authReady: !!getAuthState().ready,
        authLoggedIn: !!getAuthState().loggedIn,
    });

    initWalletUI({
        openWorkspace: openWalletWorkspace,
        openPanel: openWalletPanel,
        closePanel: closeWalletPanel,
        connectInjected,
        disconnectWallet: disconnectActiveWallet,
        switchToMainnet: switchToEthereumMainnet,
        copyAddress: copyConnectedAddress,
        loginWithWallet: () => performSiweIntent('login'),
        linkWallet: () => performSiweIntent('link'),
        unlinkWallet: unlinkLinkedWallet,
    });

    initWalletWorkspace({
        openPanel: openWalletPanel,
        closeWorkspace: closeWalletWorkspace,
        requestWalletLink,
        requestWalletLogin,
        refreshWallet: refreshActiveWalletConnection,
        sendNativeTransaction,
        switchToMainnet: switchToEthereumMainnet,
        unlinkLinkedWallet,
        estimateMaxSendableAmount,
    });

    startInjectedDiscovery((wallets) => {
        patchWalletState({ injectedWallets: wallets });

        const persisted = readPersistedSelection();
        const hasPersistedInjectedSelection = persisted?.type === 'injected'
            && !!(persisted.id || persisted.address);
        const currentState = getWalletState();
        const alreadyRestored = currentState.status === 'connected'
            && currentState.active.type === 'injected'
            && !!currentState.active.address
            && (
                (persisted?.address && addressesEqual(currentState.active.address, persisted.address))
                || (persisted?.id && currentState.active.id === persisted.id)
            );

        if (hasPersistedInjectedSelection && wallets.length > 0 && !alreadyRestored) {
            scheduleLifecycleReconcile('injected-discovery');
        }
    });

    document.addEventListener('bitbi:auth-change', (event) => {
        syncAuthState(event.detail || getAuthState());
    });

    syncAuthState(getAuthState());

    window.addEventListener('pageshow', () => {
        scheduleLifecycleReconcile('pageshow');
    });

    window.addEventListener('focus', () => {
        scheduleLifecycleReconcile('focus');
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleLifecycleReconcile('visibilitychange');
        }
    });

    window.addEventListener('hashchange', syncWorkspaceHashRoute);
    syncWorkspaceHashRoute();

    window.setTimeout(() => {
        void restorePreviousConnection();
    }, 320);
}

export function requestWalletLogin() {
    openWalletPanel();
    return performSiweIntent('login');
}

export function requestWalletLink() {
    openWalletPanel();
    return performSiweIntent('link');
}

export { unlinkLinkedWallet, refreshWalletStatus };
export function openWalletPanelView() {
    openWalletPanel();
}

export function openWalletWorkspaceView() {
    openWalletWorkspace();
}

export function getConnectedAddressLink() {
    const address = getWalletState().active.address;
    const chainId = getWalletState().active.chainId;
    return address ? getAddressExplorerUrl(chainId, address) : '';
}

export function getWalletPanelState() {
    return getWalletState();
}

export function getWalletIdentitySummary() {
    return getWalletAuthView(getWalletState());
}

export { refreshActiveWalletConnection, sendNativeTransaction, switchToEthereumMainnet as switchConnectedWalletToMainnet };
export async function estimateMaxSendableAmount(recipient = '') {
    return getMaxSendableWei(recipient);
}
