/* ============================================================
   BITBI — Wallet controller
   Shared controller for wallet state, connectors, and UI.
   ============================================================ */

import {
    ETHERSCAN_ADDRESS_BASE,
    MAINNET_CHAIN_HEX,
    getChainLabel,
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

function persistSelection(type, id) {
    writeStorage(walletConfig.storageKeys.connectorType, type);
    writeStorage(walletConfig.storageKeys.connectorId, id);
}

function clearPersistedSelection() {
    writeStorage(walletConfig.storageKeys.connectorType, null);
    writeStorage(walletConfig.storageKeys.connectorId, null);
}

function readPersistedSelection() {
    const type = readStorage(walletConfig.storageKeys.connectorType);
    const id = readStorage(walletConfig.storageKeys.connectorId);
    if (!type) return null;
    return { type, id };
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
        return 'The connection request was cancelled.';
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
        return 'The wallet connected without exposing an account.';
    }
    if (lower.includes('unauthorized') || lower.includes('unsupported method')) {
        return 'The connected wallet rejected this request.';
    }

    return fallback;
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
            },
        });
    } catch {
        if (requestToken !== balanceRequestToken) return;
        patchWalletState({
            active: {
                balanceStatus: 'error',
                balanceFormatted: '',
                balanceError: 'Could not load the ETH balance.',
            },
        });
    }
}

async function syncConnectionFromProvider(provider, base = {}) {
    if (!provider) return;

    const accounts = await readAccounts(provider);
    const address = accounts[0];
    if (!address) {
        cleanupProviderListeners();
        clearPersistedSelection();
        resetWalletConnection({ isOpen: getWalletState().isOpen });
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
        persistSelection(snapshot.type, snapshot.id);
    }

    if (options.message) {
        flashMessage('success', options.message);
    } else {
        setWalletMessage(null, null);
    }
}

async function restorePreviousConnection() {
    if (restoreAttempted) return;
    restoreAttempted = true;

    const persisted = readPersistedSelection();
    if (!persisted) return;

    try {
        if (persisted.type === 'injected' && persisted.id) {
            const connection = await restoreInjectedWallet(persisted.id);
            if (connection) {
                await activateConnection(connection, { message: null, persist: true });
                return;
            }
        }

        if (persisted.type === 'walletconnect' && isWalletConnectConfigured()) {
            const connection = await restoreWalletConnect();
            if (connection) {
                await activateConnection(connection, { message: null, persist: true });
                return;
            }
        }
    } catch (error) {
        console.warn('walletRestore:', error);
    }

    clearPersistedSelection();
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

function openWalletPanel() {
    patchWalletState({ isOpen: true });
}

function closeWalletPanel() {
    patchWalletState({ isOpen: false });
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
    });

    initWalletUI({
        openPanel: openWalletPanel,
        closePanel: closeWalletPanel,
        connectInjected,
        connectWalletConnect: connectExternalWallet,
        disconnectWallet: disconnectActiveWallet,
        switchToMainnet: switchToEthereumMainnet,
        copyAddress: copyConnectedAddress,
    });

    startInjectedDiscovery((wallets) => {
        patchWalletState({ injectedWallets: wallets });
    });

    window.setTimeout(() => {
        void restorePreviousConnection();
    }, 320);
}

export function getConnectedAddressLink() {
    const address = getWalletState().active.address;
    return address ? `${ETHERSCAN_ADDRESS_BASE}${address}` : '';
}
