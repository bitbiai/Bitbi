/* ============================================================
   BITBI — Wallet connectors
   EIP-6963 injected discovery and browser-wallet helpers.
   ============================================================ */

import {
    MAINNET_CHAIN_ID,
    getChainLabel,
    normalizeChainId,
    toChainHex,
} from './wallet-config.js?v=__ASSET_VERSION__';

const injectedProviders = new Map();
const discoveryListeners = new Set();

let injectedDiscoveryStarted = false;

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

export function hasInjectedWalletProvider(id) {
    return !!(id && injectedProviders.has(id));
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
