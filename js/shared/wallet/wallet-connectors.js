/* ============================================================
   BITBI — Wallet connectors
   EIP-6963 injected discovery + WalletConnect loader.
   ============================================================ */

import {
    MAINNET_CHAIN_ID,
    getChainLabel,
    isWalletConnectConfigured,
    normalizeChainId,
    toChainHex,
    walletConfig,
} from './wallet-config.js?v=__ASSET_VERSION__';

const injectedProviders = new Map();
const discoveryListeners = new Set();

let injectedDiscoveryStarted = false;
let walletConnectLibraryPromise = null;
let walletConnectProvider = null;
let walletConnectProviderUsesModal = false;

function isLikelyMobileWalletEnvironment() {
    if (typeof window === 'undefined') return false;

    const userAgent = typeof navigator?.userAgent === 'string' ? navigator.userAgent : '';
    const isMobileUserAgent = /android|iphone|ipad|ipod|mobile/i.test(userAgent);
    const isCoarsePointer = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
    const isNarrowViewport = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 1023px)').matches
        : false;

    return isMobileUserAgent || isNarrowViewport || isCoarsePointer;
}

function notifyInjectedDiscovery() {
    const wallets = listInjectedWallets();
    discoveryListeners.forEach(listener => {
        try {
            listener(wallets);
        } catch (error) {
            console.warn('walletDiscovery:', error);
        }
    });
}

function buildInjectedWalletRecord({ id, info, provider, isFallback = false }) {
    return {
        id,
        isFallback,
        name: typeof info?.name === 'string' && info.name.trim()
            ? info.name.trim()
            : 'Browser Wallet',
        icon: typeof info?.icon === 'string' ? info.icon : '',
        rdns: typeof info?.rdns === 'string' ? info.rdns : '',
        uuid: typeof info?.uuid === 'string' ? info.uuid : '',
        provider,
    };
}

function addInjectedProvider(record) {
    if (!record?.id || !record?.provider) return;
    if (!record.isFallback && injectedProviders.has('legacy-injected')) {
        injectedProviders.delete('legacy-injected');
    }
    injectedProviders.set(record.id, record);
    notifyInjectedDiscovery();
}

function handleEip6963Announcement(event) {
    const detail = event?.detail;
    const info = detail?.info;
    const provider = detail?.provider;
    if (!provider || !info) return;

    const id = info.uuid || info.rdns || info.name;
    if (!id) return;

    addInjectedProvider(buildInjectedWalletRecord({ id, info, provider }));
}

function maybeAddLegacyInjectedProvider() {
    if (injectedProviders.size > 0) return;
    const provider = window.ethereum;
    if (!provider) return;

    addInjectedProvider(buildInjectedWalletRecord({
        id: 'legacy-injected',
        info: {
            name: 'Browser Wallet',
            icon: '',
            rdns: '',
            uuid: 'legacy-injected',
        },
        provider,
        isFallback: true,
    }));
}

function shortenAddress(address) {
    if (typeof address !== 'string' || address.length < 10) return address || '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function getChainId(provider) {
    const chainId = provider?.chainId ?? await provider.request?.({ method: 'eth_chainId' });
    return normalizeChainId(chainId);
}

async function getAccounts(provider, method = 'eth_accounts') {
    const accounts = await provider.request?.({ method });
    return Array.isArray(accounts) ? accounts.filter(Boolean) : [];
}

function buildConnectionPayload({ provider, type, id, providerName, providerIcon, address, chainId }) {
    return {
        provider,
        type,
        id,
        providerName,
        providerIcon: providerIcon || '',
        address,
        shortAddress: shortenAddress(address),
        chainId,
        chainHex: toChainHex(chainId),
        chainLabel: getChainLabel(chainId),
        isMainnet: Number(chainId) === MAINNET_CHAIN_ID,
    };
}

export function listInjectedWallets() {
    return Array.from(injectedProviders.values())
        .map(wallet => ({
            id: wallet.id,
            name: wallet.name,
            icon: wallet.icon,
            rdns: wallet.rdns,
            uuid: wallet.uuid,
            isFallback: wallet.isFallback,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

export function startInjectedDiscovery(listener) {
    if (typeof window === 'undefined') return () => {};
    if (typeof listener === 'function') discoveryListeners.add(listener);

    if (!injectedDiscoveryStarted) {
        injectedDiscoveryStarted = true;
        window.addEventListener('eip6963:announceProvider', handleEip6963Announcement);
        window.dispatchEvent(new Event('eip6963:requestProvider'));
        window.setTimeout(maybeAddLegacyInjectedProvider, 250);
    } else {
        queueMicrotask(() => notifyInjectedDiscovery());
    }

    if (typeof listener === 'function') {
        queueMicrotask(() => listener(listInjectedWallets()));
    }

    return () => {
        if (typeof listener === 'function') discoveryListeners.delete(listener);
    };
}

export async function connectInjectedWallet(id) {
    const entry = injectedProviders.get(id);
    if (!entry?.provider?.request) {
        throw new Error('The selected browser wallet is no longer available.');
    }

    const accounts = await getAccounts(entry.provider, 'eth_requestAccounts');
    const address = accounts[0];
    if (!address) {
        throw new Error('The wallet did not return an account.');
    }

    const chainId = await getChainId(entry.provider);

    return buildConnectionPayload({
        provider: entry.provider,
        type: 'injected',
        id: entry.id,
        providerName: entry.name,
        providerIcon: entry.icon,
        address,
        chainId,
    });
}

export async function restoreInjectedWallet(id) {
    const entry = injectedProviders.get(id);
    if (!entry?.provider?.request) return null;

    const accounts = await getAccounts(entry.provider, 'eth_accounts');
    const address = accounts[0];
    if (!address) return null;

    const chainId = await getChainId(entry.provider);

    return buildConnectionPayload({
        provider: entry.provider,
        type: 'injected',
        id: entry.id,
        providerName: entry.name,
        providerIcon: entry.icon,
        address,
        chainId,
    });
}

function getWalletConnectGlobal() {
    return globalThis['@walletconnect/ethereum-provider'];
}

export function clearWalletConnectProvider(provider = walletConnectProvider) {
    if (!provider || provider !== walletConnectProvider) return;
    walletConnectProvider = null;
    walletConnectProviderUsesModal = false;
}

export async function loadWalletConnectLibrary() {
    if (getWalletConnectGlobal()?.EthereumProvider) {
        return getWalletConnectGlobal().EthereumProvider;
    }

    if (!walletConnectLibraryPromise) {
        walletConnectLibraryPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-walletconnect-bundle="true"]');
            if (existing) {
                existing.addEventListener('load', () => {
                    const providerLib = getWalletConnectGlobal()?.EthereumProvider;
                    if (providerLib) resolve(providerLib);
                    else reject(new Error('WalletConnect bundle loaded without EthereumProvider.'));
                }, { once: true });
                existing.addEventListener('error', () => reject(new Error('WalletConnect bundle failed to load.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = walletConfig.walletConnect.bundleUrl;
            script.async = true;
            script.dataset.walletconnectBundle = 'true';
            script.addEventListener('load', () => {
                const providerLib = getWalletConnectGlobal()?.EthereumProvider;
                if (providerLib) resolve(providerLib);
                else reject(new Error('WalletConnect bundle loaded without EthereumProvider.'));
            }, { once: true });
            script.addEventListener('error', () => reject(new Error('WalletConnect bundle failed to load.')), { once: true });
            document.head.appendChild(script);
        }).catch(error => {
            walletConnectLibraryPromise = null;
            throw error;
        });
    }

    return walletConnectLibraryPromise;
}

function hasWalletConnectSession(provider) {
    return !!(
        provider?.session
        || (Array.isArray(provider?.accounts) && provider.accounts.length > 0)
    );
}

async function initWalletConnectProvider(showQrModal) {
    if (!isWalletConnectConfigured()) {
        throw new Error('WalletConnect is not configured for this deployment.');
    }

    if (walletConnectProvider) {
        if (walletConnectProviderUsesModal || !showQrModal || hasWalletConnectSession(walletConnectProvider)) {
            return walletConnectProvider;
        }
        walletConnectProvider = null;
        walletConnectProviderUsesModal = false;
    }

    const EthereumProvider = await loadWalletConnectLibrary();
    walletConnectProvider = await EthereumProvider.init({
        projectId: walletConfig.walletConnectProjectId,
        chains: [MAINNET_CHAIN_ID],
        optionalChains: [MAINNET_CHAIN_ID],
        methods: walletConfig.walletConnect.methods,
        optionalMethods: walletConfig.walletConnect.optionalMethods,
        optionalEvents: walletConfig.walletConnect.optionalEvents,
        showQrModal,
        metadata: walletConfig.walletConnect.metadata,
    });
    walletConnectProviderUsesModal = !!showQrModal;

    return walletConnectProvider;
}

function readWalletConnectMetadata(provider) {
    const metadata = provider?.session?.peer?.metadata;
    return {
        name: typeof metadata?.name === 'string' && metadata.name.trim()
            ? metadata.name.trim()
            : 'WalletConnect',
        icon: Array.isArray(metadata?.icons) && typeof metadata.icons[0] === 'string'
            ? metadata.icons[0]
            : '',
    };
}

export async function connectWalletConnect() {
    const provider = await initWalletConnectProvider(true);
    const accounts = await provider.enable();
    const address = Array.isArray(accounts) ? accounts[0] : '';
    if (!address) {
        throw new Error('WalletConnect did not return an account.');
    }

    const chainId = await getChainId(provider);
    const metadata = readWalletConnectMetadata(provider);

    return buildConnectionPayload({
        provider,
        type: 'walletconnect',
        id: 'walletconnect',
        providerName: metadata.name,
        providerIcon: metadata.icon,
        address,
        chainId,
    });
}

export async function restoreWalletConnect() {
    if (!isWalletConnectConfigured()) return null;

    // A fresh WalletConnect init on mobile can trigger unsolicited "open in wallet"
    // prompts during passive restore. Only reuse an in-memory provider there; a new
    // mobile handoff must come from an explicit connect action.
    if (!walletConnectProvider && isLikelyMobileWalletEnvironment()) {
        return null;
    }

    const provider = await initWalletConnectProvider(false);
    const accounts = provider?.accounts?.length
        ? provider.accounts
        : await getAccounts(provider, 'eth_accounts');
    const address = accounts[0];
    if (!address) {
        clearWalletConnectProvider(provider);
        return null;
    }

    const chainId = await getChainId(provider);
    const metadata = readWalletConnectMetadata(provider);

    return buildConnectionPayload({
        provider,
        type: 'walletconnect',
        id: 'walletconnect',
        providerName: metadata.name,
        providerIcon: metadata.icon,
        address,
        chainId,
    });
}

export async function disconnectWalletConnect(provider = walletConnectProvider) {
    if (!provider?.disconnect) {
        clearWalletConnectProvider(provider);
        return;
    }

    try {
        await provider.disconnect();
    } finally {
        clearWalletConnectProvider(provider);
    }
}
