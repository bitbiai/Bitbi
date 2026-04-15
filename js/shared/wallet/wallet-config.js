/* ============================================================
   BITBI — Wallet config
   Shared constants for the wallet connection feature.
   ============================================================ */

export const MAINNET_CHAIN_ID = 1;
export const MAINNET_CHAIN_HEX = '0x1';
export const MAINNET_NAMESPACE = 'eip155:1';
export const ETHERSCAN_ADDRESS_BASE = 'https://etherscan.io/address/';
export const WALLET_PAGE_URL = '/account/wallet.html';
export const WALLET_WORKSPACE_HASH = '#wallet-workspace';

export const walletConfig = Object.freeze({
    storageKeys: {
        connectorType: 'bitbi_wallet_connector_type',
        connectorId: 'bitbi_wallet_connector_id',
        address: 'bitbi_wallet_address',
        chainId: 'bitbi_wallet_chain_id',
        updatedAt: 'bitbi_wallet_updated_at',
    },
    stylesUrl: new URL('../../../css/components/wallet.css?v=__ASSET_VERSION__', import.meta.url).toString(),
    workspaceStylesUrl: new URL('../../../css/account/wallet.css?v=__ASSET_VERSION__', import.meta.url).toString(),
});

const KNOWN_CHAIN_NAMES = new Map([
    [1, 'Ethereum Mainnet'],
    [10, 'Optimism'],
    [137, 'Polygon'],
    [8453, 'Base'],
    [42161, 'Arbitrum One'],
    [11155111, 'Sepolia'],
]);

const KNOWN_CHAIN_EXPLORERS = new Map([
    [1, {
        label: 'Etherscan',
        addressBase: 'https://etherscan.io/address/',
        txBase: 'https://etherscan.io/tx/',
    }],
    [10, {
        label: 'Optimistic Etherscan',
        addressBase: 'https://optimistic.etherscan.io/address/',
        txBase: 'https://optimistic.etherscan.io/tx/',
    }],
    [137, {
        label: 'PolygonScan',
        addressBase: 'https://polygonscan.com/address/',
        txBase: 'https://polygonscan.com/tx/',
    }],
    [8453, {
        label: 'BaseScan',
        addressBase: 'https://basescan.org/address/',
        txBase: 'https://basescan.org/tx/',
    }],
    [42161, {
        label: 'Arbiscan',
        addressBase: 'https://arbiscan.io/address/',
        txBase: 'https://arbiscan.io/tx/',
    }],
    [11155111, {
        label: 'Sepolia Etherscan',
        addressBase: 'https://sepolia.etherscan.io/address/',
        txBase: 'https://sepolia.etherscan.io/tx/',
    }],
]);

export function getChainLabel(chainId) {
    if (chainId == null || Number.isNaN(Number(chainId))) return 'Not connected';
    return KNOWN_CHAIN_NAMES.get(Number(chainId)) || `Chain ${Number(chainId)}`;
}

export function getChainExplorer(chainId) {
    const normalized = normalizeChainId(chainId);
    return normalized == null ? null : (KNOWN_CHAIN_EXPLORERS.get(normalized) || null);
}

export function getAddressExplorerUrl(chainId, address) {
    const explorer = getChainExplorer(chainId);
    if (!explorer || typeof address !== 'string' || !address.trim()) return '';
    return `${explorer.addressBase}${address}`;
}

export function getTransactionExplorerUrl(chainId, txHash) {
    const explorer = getChainExplorer(chainId);
    if (!explorer || typeof txHash !== 'string' || !txHash.trim()) return '';
    return `${explorer.txBase}${txHash}`;
}

export function normalizeChainId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value) {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = trimmed.startsWith('0x')
            ? Number.parseInt(trimmed, 16)
            : Number.parseInt(trimmed, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

export function toChainHex(chainId) {
    const normalized = normalizeChainId(chainId);
    return normalized == null ? null : `0x${normalized.toString(16)}`;
}
