/* ============================================================
   BITBI — Wallet controller
   Shared controller for wallet state, SIWE auth, connectors, and UI.
   ============================================================ */

import { apiWalletSiweNonce, apiWalletSiweVerify, apiWalletStatus, apiWalletUnlink } from '../auth-api.js?v=__ASSET_VERSION__';
import { getAuthState, initAuth } from '../auth-state.js';
import {
    MAINNET_CHAIN_HEX,
    getAddressExplorerUrl,
    getChainLabel,
    getTransactionExplorerUrl,
    isWalletConnectConfigured,
    normalizeChainId,
    toChainHex,
    walletConfig,
} from './wallet-config.js?v=__ASSET_VERSION__';
import {
    connectInjectedWallet,
    connectWalletConnect,
    disconnectWalletConnect,
    restoreInjectedWallet,
    restoreWalletConnect,
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

let initialized = false;
let activeProvider = null;
let removeActiveListeners = null;
let messageTimer = null;
let balanceRequestToken = 0;
let restoreAttempted = false;
let walletStatusRequestToken = 0;

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
    if (lower.includes('not configured')) {
        return 'WalletConnect is unavailable until a Reown project ID is configured.';
    }
    if (lower.includes('no longer available')) {
        return 'That browser wallet is no longer available. Refresh and try again.';
    }
    if (lower.includes('walletconnect bundle failed')) {
        return 'WalletConnect could not be loaded right now.';
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
    if (typeof removeActiveListeners === 'function') {
        removeActiveListeners();
    }
    removeActiveListeners = null;
    activeProvider = null;
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

async function syncConnectionFromProvider(provider, base = {}) {
    if (!provider) return;

    const accounts = await readAccounts(provider);
    const address = accounts[0];
    if (!address) {
        cleanupProviderListeners();
        clearPersistedSelection();
        resetWalletConnection({ isOpen: getWalletState().isOpen });
        patchWalletState({ identityAction: 'idle' });
        flashMessage('info', 'The wallet disconnected from this site.');
        return;
    }

    const chainId = await readChainId(provider);
    const snapshot = baseConnectionSnapshot({
        ...getWalletState().active,
        ...base,
        address,
        chainId,
    });

    updateWalletConnection({
        ...snapshot,
        balanceStatus: snapshot.isMainnet ? 'loading' : 'unavailable',
        balanceFormatted: '',
        balanceError: snapshot.isMainnet ? '' : 'Switch to Ethereum Mainnet to load the ETH balance.',
    });
    persistConnectionSnapshot(snapshot);
    await refreshBalance(provider, snapshot);
}

function bindProviderEvents(connection) {
    cleanupProviderListeners();
    activeProvider = connection.provider;
    if (!activeProvider?.on) return;

    const handleAccountsChanged = (accounts) => {
        if (activeProvider !== connection.provider) return;
        const nextAddress = Array.isArray(accounts) ? accounts[0] : '';
        if (!nextAddress) {
            cleanupProviderListeners();
            clearPersistedSelection();
            resetWalletConnection({ isOpen: getWalletState().isOpen });
            patchWalletState({ identityAction: 'idle' });
            flashMessage('info', 'The wallet disconnected from this site.');
            return;
        }
        void syncConnectionFromProvider(connection.provider, connection);
    };

    const handleChainChanged = () => {
        if (activeProvider !== connection.provider) return;
        void syncConnectionFromProvider(connection.provider, connection);
    };

    const handleDisconnect = () => {
        if (activeProvider !== connection.provider) return;
        cleanupProviderListeners();
        clearPersistedSelection();
        resetWalletConnection({ isOpen: getWalletState().isOpen });
        patchWalletState({ identityAction: 'idle' });
        flashMessage('info', 'The wallet disconnected from this site.');
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
    restoreAttempted = true;

    const persisted = readPersistedSelection();
    if (!persisted) return;

    try {
        let connection = null;

        if (persisted.type === 'injected' && persisted.id) {
            connection = await restoreInjectedWallet(persisted.id);
        } else if (persisted.type === 'walletconnect' && isWalletConnectConfigured()) {
            connection = await restoreWalletConnect();
        }

        if (!connection) {
            clearPersistedSelection();
            return;
        }

        if (persisted.address && !addressesEqual(persisted.address, connection.address)) {
            clearPersistedSelection();
            return;
        }

        await activateConnection(connection, { message: null, persist: true });
    } catch (error) {
        console.warn('walletRestore:', error);
        clearPersistedSelection();
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
        resetWalletConnection({ isOpen: getWalletState().isOpen });
        flashMessage('error', normalizeWalletError(error, 'Could not connect that browser wallet.'));
    }
}

async function connectExternalWallet() {
    if (!isWalletConnectConfigured()) {
        flashMessage('warning', 'WalletConnect needs a Reown project ID before it can be used.');
        return;
    }

    const shouldReopen = getWalletState().isOpen;
    patchWalletState({
        status: 'connecting',
        connectingConnectorId: 'walletconnect',
        message: null,
        isOpen: false,
    });

    try {
        const connection = await connectWalletConnect();
        await activateConnection(connection, {
            message: `${connection.providerName || 'WalletConnect'} connected.`,
        });
        if (shouldReopen) {
            patchWalletState({ isOpen: true });
        }
    } catch (error) {
        resetWalletConnection({ isOpen: shouldReopen });
        flashMessage('error', normalizeWalletError(error, 'WalletConnect could not complete the connection.'));
    }
}

async function disconnectActiveWallet() {
    const currentState = getWalletState();
    const currentProvider = activeProvider;
    const currentType = currentState.active.type;
    const isOpen = currentState.isOpen;

    cleanupProviderListeners();
    clearPersistedSelection();
    resetWalletConnection({ isOpen });
    patchWalletState({
        identityAction: 'idle',
        pendingAuthIntent: null,
    });

    try {
        if (currentType === 'walletconnect') {
            await disconnectWalletConnect(currentProvider);
        }
    } catch (error) {
        console.warn('walletDisconnect:', error);
    }

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

    await syncConnectionFromProvider(activeProvider);
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
        walletConnectConfigured: isWalletConnectConfigured(),
        walletConnectProjectId: walletConfig.walletConnectProjectId,
        authReady: !!getAuthState().ready,
        authLoggedIn: !!getAuthState().loggedIn,
    });

    initWalletUI({
        openPanel: openWalletPanel,
        closePanel: closeWalletPanel,
        connectInjected,
        connectWalletConnect: connectExternalWallet,
        disconnectWallet: disconnectActiveWallet,
        switchToMainnet: switchToEthereumMainnet,
        copyAddress: copyConnectedAddress,
        loginWithWallet: () => performSiweIntent('login'),
        linkWallet: () => performSiweIntent('link'),
        unlinkWallet: unlinkLinkedWallet,
    });

    startInjectedDiscovery((wallets) => {
        patchWalletState({ injectedWallets: wallets });
    });

    document.addEventListener('bitbi:auth-change', (event) => {
        syncAuthState(event.detail || getAuthState());
    });

    syncAuthState(getAuthState());

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
