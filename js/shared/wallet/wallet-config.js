/* ============================================================
   BITBI — Wallet config
   Shared constants for the wallet connection feature.
   ============================================================ */

export const MAINNET_CHAIN_ID = 1;
export const MAINNET_CHAIN_HEX = '0x1';
export const MAINNET_NAMESPACE = 'eip155:1';
export const ETHERSCAN_ADDRESS_BASE = 'https://etherscan.io/address/';

export const walletConfig = Object.freeze({
    walletConnectProjectId: '0d0d325bb6cb9f63b7b98fe58fcd0492',
    storageKeys: {
        connectorType: 'bitbi_wallet_connector_type',
        connectorId: 'bitbi_wallet_connector_id',
        address: 'bitbi_wallet_address',
        chainId: 'bitbi_wallet_chain_id',
        updatedAt: 'bitbi_wallet_updated_at',
    },
    walletConnect: {
        bundleUrl: new URL('../../vendor/walletconnect-ethereum-provider-2.23.8.umd.js?v=__ASSET_VERSION__', import.meta.url).toString(),
        metadata: Object.freeze({
            name: 'BITBI',
            description: 'BITBI wallet connection',
            url: 'https://bitbi.ai',
            icons: ['https://bitbi.ai/assets/favicons/android-chrome-192x192.png'],
        }),
        methods: Object.freeze([
            'eth_sendTransaction',
            'personal_sign',
            'eth_signTypedData',
            'eth_signTypedData_v4',
        ]),
        optionalMethods: Object.freeze([
            'eth_accounts',
            'eth_requestAccounts',
            'eth_chainId',
            'eth_getBalance',
            'wallet_switchEthereumChain',
        ]),
        optionalEvents: Object.freeze([
            'accountsChanged',
            'chainChanged',
            'disconnect',
        ]),
    },
    stylesUrl: new URL('../../../css/components/wallet.css?v=__ASSET_VERSION__', import.meta.url).toString(),
});

const KNOWN_CHAIN_NAMES = new Map([
    [1, 'Ethereum Mainnet'],
    [10, 'Optimism'],
    [137, 'Polygon'],
    [8453, 'Base'],
    [42161, 'Arbitrum One'],
    [11155111, 'Sepolia'],
]);

export function isWalletConnectConfigured() {
    return (
        typeof walletConfig.walletConnectProjectId === 'string'
        && walletConfig.walletConnectProjectId.trim()
        && walletConfig.walletConnectProjectId !== 'REPLACE_WITH_REOWN_PROJECT_ID'
    );
}

export function getChainLabel(chainId) {
    if (chainId == null || Number.isNaN(Number(chainId))) return 'Not connected';
    return KNOWN_CHAIN_NAMES.get(Number(chainId)) || `Chain ${Number(chainId)}`;
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
