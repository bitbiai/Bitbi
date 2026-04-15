/* ============================================================
   BITBI — Wallet workspace
   Same-document wallet workspace overlay for desktop and mobile.
   ============================================================ */

import { setupFocusTrap } from '../focus-trap.js';
import { getAddressExplorerUrl, getChainExplorer, walletConfig } from './wallet-config.js?v=__ASSET_VERSION__';
import { renderWalletQrSvg } from './wallet-qr.js?v=__ASSET_VERSION__';
import { getWalletState, subscribeWalletState } from './wallet-state.js?v=__ASSET_VERSION__';

let initialized = false;
let actionsRef = null;
let walletState = getWalletState();
let root = null;
let panel = null;
let removeFocusTrap = null;
let workspaceOpen = false;

const refs = {};
const detailDateTime = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

let qrToken = 0;
let previousAddress = '';
let bannerTimer = null;
const walletTabs = ['overview', 'send', 'receive', 'account'];
const pageUiState = {
    banner: null,
    refreshing: false,
    maxLoading: false,
    qr: {
        requestKey: '',
        error: '',
    },
    send: {
        status: '',
        text: '',
        explorerUrl: '',
        submitting: false,
    },
};

function shortenAddress(address) {
    if (typeof address !== 'string' || address.length < 10) return address || '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function ensureStyles() {
    if (document.getElementById('bitbiWalletWorkspaceStyles')) return;
    const link = document.createElement('link');
    link.id = 'bitbiWalletWorkspaceStyles';
    link.rel = 'stylesheet';
    link.href = walletConfig.workspaceStylesUrl;
    document.head.appendChild(link);
}

function createWorkspaceMarkup() {
    return `
        <button type="button" class="wallet-workspace__backdrop" aria-label="Close wallet workspace" data-wallet-workspace-close="backdrop"></button>
        <section class="wallet-workspace__panel" role="dialog" aria-modal="true" aria-labelledby="walletWorkspaceTitle" tabindex="-1" data-wallet-workspace-panel="true">
            <div class="wallet-workspace__hero">
                <div class="wallet-workspace__hero-copy">
                    <span class="wallet-workspace__eyebrow">Wallet Workspace</span>
                    <h2 id="walletWorkspaceTitle" class="wallet-workspace__title">Wallet</h2>
                </div>
                <button type="button" class="wallet-workspace__close" aria-label="Close wallet workspace" data-wallet-workspace-close="panel">×</button>
            </div>

            <div class="wallet-workspace__body">
                <div class="wallet-page-shell">
                    <div id="walletPageBanner" class="wallet-page__banner" role="status" hidden></div>
                    <div id="walletSectionNav" class="profile-tab-bar wallet-page__section-nav" role="tablist" aria-label="Wallet sections">
                        <button type="button" id="walletOverviewTab" class="profile-tab-btn wallet-page__section-link active" data-wallet-tab-button="overview" role="tab" aria-selected="true" aria-controls="wallet-overview">Overview</button>
                        <button type="button" id="walletSendTab" class="profile-tab-btn wallet-page__section-link" data-wallet-tab-button="send" role="tab" aria-selected="false" aria-controls="wallet-send">Send</button>
                        <button type="button" id="walletReceiveTab" class="profile-tab-btn wallet-page__section-link" data-wallet-tab-button="receive" role="tab" aria-selected="false" aria-controls="wallet-receive">Receive</button>
                        <button type="button" id="walletAccountTab" class="profile-tab-btn wallet-page__section-link" data-wallet-tab-button="account" role="tab" aria-selected="false" aria-controls="wallet-account">Bitbi Account</button>
                    </div>

                    <section id="walletPageEmpty" class="wallet-page__empty reveal visible" aria-labelledby="walletEmptyTitle">
                        <div class="wallet-page__empty-visual" aria-hidden="true">
                            <span class="wallet-page__empty-orb"></span>
                            <span class="wallet-page__empty-ring wallet-page__empty-ring--outer"></span>
                            <span class="wallet-page__empty-ring wallet-page__empty-ring--inner"></span>
                        </div>
                        <div class="wallet-page__empty-copy">
                            <span class="wallet-page__eyebrow">Disconnected</span>
                            <h2 id="walletEmptyTitle" class="wallet-page__title">Connect a wallet to unlock your wallet workspace.</h2>
                            <p id="walletPageEmptyText" class="wallet-page__copy">Your wallet dashboard, receive QR, send form, and BITBI wallet linking state appear here after you connect.</p>
                            <div class="wallet-page__empty-actions">
                                <button type="button" id="walletPageConnectBtn" class="wallet-page__button">Connect Wallet</button>
                                <button type="button" id="walletPageOpenPanelBtn" class="wallet-page__button wallet-page__button--ghost">Open Wallet Panel</button>
                            </div>
                            <div class="wallet-page__empty-features" aria-hidden="true">
                                <span>Receive QR</span>
                                <span>Native ETH send</span>
                                <span>Explorer shortcuts</span>
                            </div>
                        </div>
                    </section>

                    <div id="walletPageDashboard" class="wallet-page__grid" data-active-tab="overview" hidden>
                        <section id="wallet-overview" class="wallet-page__card wallet-page__card--summary wallet-page__section-card reveal visible" data-wallet-tab="overview" role="tabpanel" aria-labelledby="walletOverviewTab">
                            <div class="wallet-page__card-head">
                                <div>
                                    <span class="wallet-page__eyebrow">Overview</span>
                                    <h2 id="walletOverviewTitle" class="wallet-page__title">Connected wallet</h2>
                                </div>
                                <div class="wallet-page__status-group">
                                    <span id="walletPageConnectionPill" class="wallet-page__pill">Disconnected</span>
                                    <span id="walletPageNetworkPill" class="wallet-page__pill wallet-page__pill--ghost">Ethereum</span>
                                </div>
                            </div>

                            <div class="wallet-page__provider-strip">
                                <div class="wallet-page__provider-badge" aria-hidden="true" id="walletPageProviderBadge">W</div>
                                <div class="wallet-page__provider-copy">
                                    <span id="walletPageProviderLabel" class="wallet-page__provider-label">Wallet</span>
                                    <span id="walletPageProviderMeta" class="wallet-page__provider-meta">Waiting for a connection</span>
                                </div>
                            </div>

                            <div class="wallet-page__balance-block">
                                <span class="wallet-page__balance-label">Native balance</span>
                                <strong id="walletPageBalanceValue" class="wallet-page__balance-value">—</strong>
                                <span id="walletPageUpdated" class="wallet-page__updated">Updated when connected</span>
                            </div>

                            <dl class="wallet-page__detail-grid">
                                <div class="wallet-page__detail-card">
                                    <dt>Full address</dt>
                                    <dd id="walletPageAddressFull">—</dd>
                                </div>
                                <div class="wallet-page__detail-card">
                                    <dt>Compact address</dt>
                                    <dd id="walletPageAddressShort">—</dd>
                                </div>
                                <div class="wallet-page__detail-card">
                                    <dt>Network</dt>
                                    <dd id="walletPageNetworkName">—</dd>
                                </div>
                                <div class="wallet-page__detail-card">
                                    <dt>Chain ID</dt>
                                    <dd id="walletPageChainId">—</dd>
                                </div>
                            </dl>

                            <div class="wallet-page__actions">
                                <button type="button" id="walletPageRefreshBtn" class="wallet-page__button wallet-page__button--ghost">Refresh</button>
                                <button type="button" id="walletPageCopyBtn" class="wallet-page__button wallet-page__button--ghost">Copy Address</button>
                                <a id="walletPageExplorerLink" class="wallet-page__button" href="#" target="_blank" rel="noopener noreferrer">View Activity</a>
                                <button type="button" id="walletPageSwitchBtn" class="wallet-page__button" hidden>Switch to Ethereum</button>
                            </div>
                        </section>

                        <section id="wallet-receive" class="wallet-page__card wallet-page__card--receive wallet-page__section-card reveal visible" data-wallet-tab="receive" role="tabpanel" aria-labelledby="walletReceiveTab" hidden>
                            <div class="wallet-page__card-head">
                                <div>
                                    <span class="wallet-page__eyebrow">Receive</span>
                                    <h2 id="walletReceiveTitle" class="wallet-page__title">Receive to this address</h2>
                                </div>
                            </div>

                            <div id="walletPageQrFrame" class="wallet-page__qr-frame" data-wallet-receive-qr="idle" role="img" aria-label="Wallet receive QR code"></div>
                            <p id="walletPageQrHint" class="wallet-page__qr-hint">A local QR code appears here for the connected wallet address.</p>

                            <div class="wallet-page__receive-address">
                                <span class="wallet-page__receive-label">Address</span>
                                <code id="walletPageReceiveAddress" class="wallet-page__receive-code">—</code>
                            </div>

                            <div class="wallet-page__actions wallet-page__actions--stack">
                                <button type="button" id="walletPageReceiveCopyBtn" class="wallet-page__button wallet-page__button--ghost">Copy Address</button>
                                <a id="walletPageReceiveExplorerLink" class="wallet-page__button" href="#" target="_blank" rel="noopener noreferrer">Open on Explorer</a>
                            </div>
                        </section>

                        <section id="wallet-send" class="wallet-page__card wallet-page__card--send wallet-page__section-card reveal visible" data-wallet-tab="send" role="tabpanel" aria-labelledby="walletSendTab" hidden>
                            <div class="wallet-page__card-head">
                                <div>
                                    <span class="wallet-page__eyebrow">Send</span>
                                    <h2 id="walletSendTitle" class="wallet-page__title">Send ETH with your wallet</h2>
                                </div>
                            </div>

                            <p class="wallet-page__copy">Transactions are prepared in BITBI and confirmed inside your connected wallet. BITBI never handles private keys or custody.</p>
                            <div id="walletSendMsg" class="wallet-page__msg" role="status" aria-live="polite"></div>

                            <form id="walletSendForm" class="wallet-page__form" novalidate>
                                <label class="wallet-page__field" for="walletSendRecipient">
                                    <span>Recipient address</span>
                                    <input type="text" id="walletSendRecipient" class="wallet-page__input" placeholder="0x…" autocomplete="off" spellcheck="false" inputmode="text">
                                </label>

                                <div class="wallet-page__field">
                                    <div class="wallet-page__field-head">
                                        <label for="walletSendAmount">Amount (ETH)</label>
                                        <button type="button" id="walletSendMaxBtn" class="wallet-page__field-action">Use Max</button>
                                    </div>
                                    <input type="text" id="walletSendAmount" class="wallet-page__input" placeholder="0.00" autocomplete="off" spellcheck="false" inputmode="decimal">
                                </div>

                                <p id="walletSendHint" class="wallet-page__hint">Available only while an Ethereum Mainnet wallet is actively connected.</p>

                                <div class="wallet-page__actions">
                                    <button type="submit" id="walletSendSubmit" class="wallet-page__button">Send ETH</button>
                                    <button type="button" id="walletSendPanelBtn" class="wallet-page__button wallet-page__button--ghost">Open Wallet Panel</button>
                                </div>
                            </form>
                        </section>

                        <section id="wallet-account" class="wallet-page__card wallet-page__card--identity wallet-page__section-card reveal visible" data-wallet-tab="account" role="tabpanel" aria-labelledby="walletAccountTab" hidden>
                            <div class="wallet-page__card-head">
                                <div>
                                    <span class="wallet-page__eyebrow">BITBI Account</span>
                                    <h2 id="walletIdentityTitle" class="wallet-page__title">Wallet identity</h2>
                                </div>
                            </div>

                            <p id="walletPageIdentityCopy" class="wallet-page__copy">Wallet connection and BITBI account authentication stay modeled separately.</p>
                            <dl id="walletPageIdentityRows" class="wallet-page__identity-grid"></dl>
                            <div id="walletPageIdentityActions" class="wallet-page__actions wallet-page__actions--stack"></div>
                        </section>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function query(id) {
    return root?.querySelector(`#${id}`) || null;
}

function cacheRefs() {
    refs.banner = query('walletPageBanner');
    refs.sectionNav = query('walletSectionNav');
    refs.empty = query('walletPageEmpty');
    refs.emptyText = query('walletPageEmptyText');
    refs.emptyConnectBtn = query('walletPageConnectBtn');
    refs.emptyOpenPanelBtn = query('walletPageOpenPanelBtn');
    refs.dashboard = query('walletPageDashboard');
    refs.connectionPill = query('walletPageConnectionPill');
    refs.networkPill = query('walletPageNetworkPill');
    refs.providerBadge = query('walletPageProviderBadge');
    refs.providerLabel = query('walletPageProviderLabel');
    refs.providerMeta = query('walletPageProviderMeta');
    refs.balanceValue = query('walletPageBalanceValue');
    refs.updated = query('walletPageUpdated');
    refs.addressFull = query('walletPageAddressFull');
    refs.addressShort = query('walletPageAddressShort');
    refs.networkName = query('walletPageNetworkName');
    refs.chainId = query('walletPageChainId');
    refs.refreshBtn = query('walletPageRefreshBtn');
    refs.copyBtn = query('walletPageCopyBtn');
    refs.explorerLink = query('walletPageExplorerLink');
    refs.switchBtn = query('walletPageSwitchBtn');
    refs.qrFrame = query('walletPageQrFrame');
    refs.qrHint = query('walletPageQrHint');
    refs.receiveAddress = query('walletPageReceiveAddress');
    refs.receiveCopyBtn = query('walletPageReceiveCopyBtn');
    refs.receiveExplorerLink = query('walletPageReceiveExplorerLink');
    refs.sendForm = query('walletSendForm');
    refs.sendMsg = query('walletSendMsg');
    refs.sendRecipient = query('walletSendRecipient');
    refs.sendAmount = query('walletSendAmount');
    refs.sendHint = query('walletSendHint');
    refs.sendSubmit = query('walletSendSubmit');
    refs.sendPanelBtn = query('walletSendPanelBtn');
    refs.sendMaxBtn = query('walletSendMaxBtn');
    refs.identityCopy = query('walletPageIdentityCopy');
    refs.identityRows = query('walletPageIdentityRows');
    refs.identityActions = query('walletPageIdentityActions');
    refs.sectionPanels = Array.from(root?.querySelectorAll('[data-wallet-tab]') || []);
}

function ensureWorkspace() {
    if (root?.isConnected) return root;

    ensureStyles();
    root = document.createElement('div');
    root.id = 'walletWorkspace';
    root.className = 'wallet-workspace';
    root.hidden = true;
    root.dataset.walletWorkspace = 'true';
    root.innerHTML = createWorkspaceMarkup();
    document.body.appendChild(root);

    panel = root.querySelector('[data-wallet-workspace-panel="true"]');
    cacheRefs();
    bindEvents();
    document.addEventListener('keydown', handleEscape);
    return root;
}

function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (!workspaceOpen) return;
    if (walletState.isOpen) return;
    actionsRef?.closeWorkspace?.();
}

function syncWorkspaceOpen(open, panelOpen = false) {
    if (!root || !panel) return;
    if (workspaceOpen !== open) {
        workspaceOpen = open;
        root.hidden = !open;
        root.classList.toggle('is-open', open);
    }

    if (!open) {
        removeFocusTrap?.();
        removeFocusTrap = null;
        return;
    }

    if (panelOpen) {
        removeFocusTrap?.();
        removeFocusTrap = null;
        return;
    }

    if (!removeFocusTrap) {
        removeFocusTrap = setupFocusTrap(panel);
        panel.focus();
    }
}

function getActiveWalletTab() {
    const activeTab = refs.dashboard?.dataset.activeTab || 'overview';
    return walletTabs.includes(activeTab) ? activeTab : 'overview';
}

function setActiveWalletTab(tab) {
    const resolvedTab = walletTabs.includes(tab) ? tab : 'overview';
    if (refs.dashboard) {
        refs.dashboard.dataset.activeTab = resolvedTab;
    }
    if (refs.sectionNav) {
        refs.sectionNav.querySelectorAll('[data-wallet-tab-button]').forEach((button) => {
            const isActive = button.dataset.walletTabButton === resolvedTab;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
            button.tabIndex = isActive ? 0 : -1;
        });
    }
    refs.sectionPanels.forEach((panelEl) => {
        panelEl.hidden = panelEl.dataset.walletTab !== resolvedTab;
    });
}

function addressesEqual(left, right) {
    if (!left || !right) return false;
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function buildReceiveUri(state) {
    if (!state?.active?.address) return '';
    if (state.active.chainId) {
        return `ethereum:${state.active.address}@${state.active.chainId}`;
    }
    return state.active.address;
}

function formatUpdated(iso) {
    if (!iso) return 'Updated when connected';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Updated recently';
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 60_000) return 'Updated just now';
    if (diffMs < 3_600_000) {
        const mins = Math.max(1, Math.round(diffMs / 60_000));
        return `Updated ${mins} min${mins === 1 ? '' : 's'} ago`;
    }
    return `Updated ${detailDateTime.format(date)}`;
}

function formatIdentityDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return detailDateTime.format(date);
}

function isValidEthereumAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(String(value || '').trim());
}

function sanitizeDecimalInput(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('.')) return `0${value}`;
    if (value.endsWith('.')) return `${value}0`;
    return value;
}

function parseEthAmountToWei(raw) {
    const value = sanitizeDecimalInput(raw);
    if (!/^\d+(?:\.\d{1,18})?$/.test(value)) {
        throw new Error('Enter a valid ETH amount with up to 18 decimals.');
    }

    const [wholePart, fractionPart = ''] = value.split('.');
    const wholeWei = BigInt(wholePart || '0') * 1000000000000000000n;
    const fractionWei = BigInt((fractionPart.padEnd(18, '0')).slice(0, 18));
    return wholeWei + fractionWei;
}

function formatWeiToInput(wei, fractionDigits = 6) {
    const value = BigInt(wei);
    const whole = value / 1000000000000000000n;
    const fraction = value % 1000000000000000000n;
    const trimmedFraction = fraction
        .toString()
        .padStart(18, '0')
        .slice(0, fractionDigits)
        .replace(/0+$/, '');
    return trimmedFraction ? `${whole.toString()}.${trimmedFraction}` : whole.toString();
}

function setBanner(type, text) {
    if (bannerTimer) {
        window.clearTimeout(bannerTimer);
        bannerTimer = null;
    }
    pageUiState.banner = text ? { type, text } : null;
    renderBanner(walletState);
    if (text) {
        bannerTimer = window.setTimeout(() => {
            pageUiState.banner = null;
            renderBanner(walletState);
            bannerTimer = null;
        }, 4200);
    }
}

function renderBanner(state) {
    const activeBanner = pageUiState.banner || state.message;
    if (!refs.banner) return;
    if (!activeBanner?.text) {
        refs.banner.hidden = true;
        refs.banner.textContent = '';
        refs.banner.className = 'wallet-page__banner';
        return;
    }

    refs.banner.hidden = false;
    refs.banner.textContent = activeBanner.text;
    refs.banner.className = `wallet-page__banner wallet-page__banner--${activeBanner.type || 'warning'}`;
}

function setSendMessage(type, text, explorerUrl = '') {
    pageUiState.send = {
        status: type || '',
        text: text || '',
        explorerUrl: explorerUrl || '',
        submitting: pageUiState.send.submitting,
    };
    renderSendMessage();
}

function renderSendMessage() {
    const { status, text, explorerUrl } = pageUiState.send;
    if (!refs.sendMsg) return;

    refs.sendMsg.className = status ? `wallet-page__msg wallet-page__msg--${status}` : 'wallet-page__msg';
    refs.sendMsg.textContent = '';
    refs.sendMsg.replaceChildren();

    if (!text) return;

    const copy = document.createElement('span');
    copy.className = 'wallet-page__msg-copy';

    const txPrefix = 'Transaction submitted: ';
    if (text.startsWith(txPrefix) && text.slice(txPrefix.length).startsWith('0x')) {
        const intro = document.createElement('span');
        intro.textContent = txPrefix.trim();
        const hash = document.createElement('code');
        hash.className = 'wallet-page__msg-hash';
        hash.textContent = text.slice(txPrefix.length);
        copy.append(intro, document.createTextNode(' '), hash);
    } else {
        copy.textContent = text;
    }

    refs.sendMsg.appendChild(copy);

    if (explorerUrl) {
        refs.sendMsg.appendChild(document.createTextNode(' '));
        const link = document.createElement('a');
        link.href = explorerUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'wallet-page__msg-link';
        link.textContent = 'View transaction';
        refs.sendMsg.appendChild(link);
    }
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

function createRow(label, value) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value || '—';
    wrap.append(dt, dd);
    return wrap;
}

function createIdentityButton(label, className, onClick, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
}

function renderEmptyState(state) {
    const connectedLinkedWallet = state.authLoggedIn && state.linkedWallet
        ? `Your BITBI account is currently linked to ${state.linkedWallet.shortAddress || shortenAddress(state.linkedWallet.address)}.`
        : 'Your wallet dashboard, receive QR, send form, and BITBI wallet linking state appear here after you connect.';

    if (!refs.emptyText || !refs.emptyConnectBtn || !refs.emptyOpenPanelBtn) return;

    if (state.status === 'connecting') {
        refs.emptyText.textContent = 'Finish the connection request in your wallet. BITBI keeps the wallet workspace ready while the panel handles the connection flow.';
        refs.emptyConnectBtn.disabled = true;
        refs.emptyConnectBtn.textContent = 'Connecting…';
        refs.emptyOpenPanelBtn.disabled = true;
        refs.emptyOpenPanelBtn.textContent = 'Panel Busy';
        return;
    }

    if (state.status === 'restoring') {
        refs.emptyText.textContent = 'Restoring the previous browser-wallet session without opening a new connection request. BITBI keeps the workspace ready while the provider settles.';
        refs.emptyConnectBtn.disabled = true;
        refs.emptyConnectBtn.textContent = 'Restoring…';
        refs.emptyOpenPanelBtn.disabled = false;
        refs.emptyOpenPanelBtn.textContent = 'Open Wallet Panel';
        return;
    }

    refs.emptyText.textContent = connectedLinkedWallet;
    refs.emptyConnectBtn.disabled = false;
    refs.emptyConnectBtn.textContent = state.authLoggedIn && state.linkedWallet ? 'Reconnect Wallet' : 'Connect Wallet';
    refs.emptyOpenPanelBtn.disabled = false;
    refs.emptyOpenPanelBtn.textContent = 'Open Wallet Panel';
}

function renderSummary(state) {
    const active = state.active;
    const connected = state.status === 'connected' && !!active.address;
    const restoring = state.status === 'restoring' && !!active.address;
    const chainExplorer = getChainExplorer(active.chainId);
    const explorerUrl = getAddressExplorerUrl(active.chainId, active.address);
    const explorerLabel = chainExplorer?.label || 'Explorer';
    const wrongNetwork = connected && !active.isMainnet;

    if (!refs.connectionPill) return;

    if (restoring) {
        refs.connectionPill.textContent = 'Restoring';
        refs.connectionPill.className = 'wallet-page__pill wallet-page__pill--ghost';
    } else {
        refs.connectionPill.textContent = wrongNetwork ? 'Wrong network' : 'Connected';
        refs.connectionPill.className = `wallet-page__pill ${wrongNetwork ? 'wallet-page__pill--warning' : 'wallet-page__pill--success'}`;
    }
    refs.networkPill.textContent = active.chainLabel || 'Unknown network';
    refs.networkPill.className = `wallet-page__pill ${wrongNetwork ? 'wallet-page__pill--warning' : 'wallet-page__pill--ghost'}`;

    refs.providerBadge.textContent = (active.providerName || 'Wallet').slice(0, 1).toUpperCase();
    refs.providerLabel.textContent = active.providerName || 'Connected wallet';
    refs.providerMeta.textContent = active.type === 'injected'
        ? (connected ? 'Connected through an installed browser wallet' : 'Restoring the last browser-wallet session seen in this browser')
        : 'Connected wallet session';

    refs.balanceValue.textContent = !connected && active.address
        ? 'Restoring…'
        : active.balanceStatus === 'loading'
            ? 'Loading…'
            : active.balanceStatus === 'loaded'
                ? (active.balanceFormatted || '0 ETH')
                : active.balanceStatus === 'error'
                    ? 'Balance unavailable'
                    : active.balanceStatus === 'unavailable'
                        ? 'Mainnet only'
                        : '—';

    refs.updated.textContent = pageUiState.refreshing ? 'Refreshing…' : formatUpdated(active.refreshedAt);
    refs.addressFull.textContent = active.address || '—';
    refs.addressShort.textContent = active.shortAddress || shortenAddress(active.address) || '—';
    refs.networkName.textContent = active.chainLabel || '—';
    refs.chainId.textContent = active.chainId != null ? String(active.chainId) : '—';

    refs.refreshBtn.disabled = pageUiState.refreshing || !connected;
    refs.refreshBtn.textContent = pageUiState.refreshing ? 'Refreshing…' : (connected ? 'Refresh' : 'Restore in Progress');

    if (explorerUrl) {
        refs.explorerLink.hidden = false;
        refs.explorerLink.href = explorerUrl;
        refs.explorerLink.textContent = `View on ${explorerLabel}`;
    } else {
        refs.explorerLink.hidden = true;
        refs.explorerLink.removeAttribute('href');
    }

    refs.switchBtn.hidden = !wrongNetwork;
}

function renderReceive(state) {
    const active = state.active;
    const connected = state.status === 'connected' && !!active.address;
    const explorer = getAddressExplorerUrl(active.chainId, active.address);
    const receiveUri = buildReceiveUri(state);
    const explorerLabel = getChainExplorer(active.chainId)?.label || 'Explorer';

    if (!refs.receiveAddress) return;

    refs.receiveAddress.textContent = active.address || '—';
    refs.receiveCopyBtn.disabled = !active.address;

    if (explorer) {
        refs.receiveExplorerLink.hidden = false;
        refs.receiveExplorerLink.href = explorer;
        refs.receiveExplorerLink.textContent = `Open on ${explorerLabel}`;
    } else {
        refs.receiveExplorerLink.hidden = true;
        refs.receiveExplorerLink.removeAttribute('href');
    }

    const requestKey = `${receiveUri}|${active.chainId || ''}`;
    if (!receiveUri) {
        pageUiState.qr.requestKey = '';
        pageUiState.qr.error = '';
        refs.qrFrame.dataset.walletReceiveQr = 'idle';
        refs.qrFrame.replaceChildren();
        refs.qrHint.textContent = 'A local QR code appears here for the connected wallet address.';
        return;
    }

    if (pageUiState.qr.requestKey === requestKey && !refs.qrFrame.dataset.walletReceiveQr.startsWith('loading')) {
        return;
    }

    pageUiState.qr.requestKey = requestKey;
    pageUiState.qr.error = '';
    const currentToken = ++qrToken;
    refs.qrFrame.dataset.walletReceiveQr = 'loading';
    refs.qrFrame.replaceChildren();
    refs.qrHint.textContent = 'Generating a client-side QR code for this connected address…';

    void renderWalletQrSvg(receiveUri, {
        cellSize: 9,
        margin: 1,
        title: 'BITBI wallet receive QR',
        description: `QR code for ${active.address} on ${active.chainLabel || 'the active chain'}.`,
    }).then((svgMarkup) => {
        if (currentToken !== qrToken) return;
        refs.qrFrame.dataset.walletReceiveQr = 'ready';
        refs.qrFrame.innerHTML = svgMarkup;
        if (!connected) {
            refs.qrHint.textContent = 'This QR uses the last wallet address seen in this browser while BITBI restores the live session.';
            return;
        }
        refs.qrHint.textContent = active.isMainnet
            ? 'Scan to copy the connected Ethereum Mainnet address into another wallet.'
            : `Connected on ${active.chainLabel || 'another chain'}. BITBI wallet actions still target Ethereum Mainnet.`;
    }).catch(() => {
        if (currentToken !== qrToken) return;
        pageUiState.qr.error = 'QR unavailable';
        refs.qrFrame.dataset.walletReceiveQr = 'error';
        refs.qrFrame.replaceChildren();
        refs.qrHint.textContent = 'The wallet address is still shown below if QR rendering is unavailable in this browser.';
    });
}

function renderIdentity(state) {
    if (!refs.identityRows || !refs.identityActions || !refs.identityCopy) return;

    const connected = state.status === 'connected' && !!state.active.address;
    const linkedWallet = state.linkedWallet || null;
    const linkedMatchesActive = !!(linkedWallet && connected && addressesEqual(linkedWallet.address, state.active.address));
    const connectedDiffersFromLinked = !!(linkedWallet && connected && !linkedMatchesActive);
    const actionBusy = state.identityAction && state.identityAction !== 'idle';

    refs.identityRows.replaceChildren();
    refs.identityActions.replaceChildren();

    if (!state.authReady) {
        refs.identityCopy.textContent = 'Loading the current BITBI account session…';
        refs.identityRows.appendChild(createRow('Status', 'Loading…'));
        return;
    }

    if (!state.authLoggedIn) {
        refs.identityCopy.textContent = 'Wallet connection alone does not sign you in. Use Sign in with Ethereum only if this wallet is already linked to a BITBI account.';
        refs.identityRows.appendChild(createRow('Status', 'Not signed in to BITBI'));
        refs.identityRows.appendChild(createRow('Wallet session', connected ? 'Connected in this browser' : 'Not connected'));

        if (connected) {
            refs.identityActions.appendChild(createIdentityButton(
                actionBusy ? 'Working…' : 'Sign In with Ethereum',
                'wallet-page__button',
                () => actionsRef?.requestWalletLogin?.(),
                actionBusy || !state.active.isMainnet,
            ));
        }
        return;
    }

    if (!linkedWallet) {
        refs.identityCopy.textContent = connected
            ? 'Your wallet is connected in this browser, but it is not linked to your BITBI account yet.'
            : 'You are signed in to BITBI. Connect a wallet to link it to this account.';
        refs.identityRows.appendChild(createRow('Status', connected ? 'Connected, not linked' : 'Signed in, wallet not connected'));
        if (connected) {
            refs.identityRows.appendChild(createRow('Connected wallet', state.active.address));
            refs.identityActions.appendChild(createIdentityButton(
                actionBusy ? 'Working…' : 'Link Connected Wallet',
                'wallet-page__button',
                () => actionsRef?.requestWalletLink?.(),
                actionBusy || !state.active.isMainnet,
            ));
        } else {
            refs.identityActions.appendChild(createIdentityButton(
                'Connect Wallet',
                'wallet-page__button',
                () => actionsRef?.openPanel?.(),
            ));
        }
        return;
    }

    refs.identityRows.appendChild(createRow('Linked wallet', linkedWallet.address));
    refs.identityRows.appendChild(createRow('Linked at', formatIdentityDate(linkedWallet.linkedAt)));
    if (linkedWallet.lastLoginAt) {
        refs.identityRows.appendChild(createRow('Last wallet sign-in', formatIdentityDate(linkedWallet.lastLoginAt)));
    }

    if (linkedMatchesActive) {
        refs.identityCopy.textContent = 'This connected wallet matches the wallet linked to your BITBI account.';
        refs.identityRows.prepend(createRow('Status', 'Linked and connected'));
    } else if (connectedDiffersFromLinked) {
        refs.identityCopy.textContent = 'A different wallet is connected in this browser than the one currently linked to your BITBI account.';
        refs.identityRows.prepend(createRow('Status', 'Different wallet connected'));
        refs.identityRows.appendChild(createRow('Connected wallet', state.active.address));
    } else {
        refs.identityCopy.textContent = 'Your BITBI account remains signed in even when the linked wallet is not currently connected in this browser tab.';
        refs.identityRows.prepend(createRow('Status', 'Linked'));
    }

    if (!connected) {
        refs.identityActions.appendChild(createIdentityButton(
            'Reconnect Wallet',
            'wallet-page__button',
            () => actionsRef?.openPanel?.(),
        ));
    }

    refs.identityActions.appendChild(createIdentityButton(
        state.identityAction === 'unlinking' ? 'Unlinking…' : 'Unlink Wallet',
        'wallet-page__button wallet-page__button--danger',
        async () => {
            await actionsRef?.unlinkLinkedWallet?.();
        },
        actionBusy,
    ));
}

function renderSendState(state) {
    const connected = state.status === 'connected' && !!state.active.address;
    const sendEnabled = connected && state.active.isMainnet;

    refs.sendRecipient.disabled = !sendEnabled || pageUiState.send.submitting;
    refs.sendAmount.disabled = !sendEnabled || pageUiState.send.submitting;
    refs.sendSubmit.disabled = !sendEnabled || pageUiState.send.submitting;
    refs.sendMaxBtn.disabled = !sendEnabled || pageUiState.send.submitting || pageUiState.maxLoading || state.active.balanceStatus !== 'loaded';

    if (!connected) {
        refs.sendHint.textContent = state.status === 'restoring' && !!state.active.address
            ? 'Wait for the browser wallet to finish restoring before preparing a native ETH transfer from this address.'
            : 'Connect an Ethereum Mainnet wallet to prepare a native ETH transfer.';
    } else if (!state.active.isMainnet) {
        refs.sendHint.textContent = 'Switch the connected wallet to Ethereum Mainnet before sending from BITBI.';
    } else if (state.active.balanceStatus === 'loaded') {
        refs.sendHint.textContent = `Available balance: ${state.active.balanceFormatted || '0 ETH'}. The transaction is confirmed inside your connected wallet.`;
    } else if (state.active.balanceStatus === 'loading') {
        refs.sendHint.textContent = 'Balance is loading. You can still enter an amount manually.';
    } else if (state.active.balanceStatus === 'error') {
        refs.sendHint.textContent = 'Balance could not be refreshed, but the connected wallet can still attempt a send.';
    } else {
        refs.sendHint.textContent = 'Available only while an Ethereum Mainnet wallet is actively connected.';
    }

    refs.sendSubmit.textContent = pageUiState.send.submitting ? 'Confirm in Wallet…' : 'Send ETH';
    refs.sendMaxBtn.textContent = pageUiState.maxLoading ? 'Preparing…' : 'Use Max';
}

function renderConnectedState(state) {
    renderSummary(state);
    renderReceive(state);
    renderIdentity(state);
    renderSendState(state);
}

function render(state) {
    walletState = state;
    ensureWorkspace();
    syncWorkspaceOpen(!!state.workspaceOpen, !!state.isOpen);
    renderBanner(state);

    const connected = state.status === 'connected' && !!state.active.address;
    const restoringPreview = state.status === 'restoring' && !!state.active.address;
    const visibleWallet = connected || restoringPreview;
    const activeTab = getActiveWalletTab();
    if (previousAddress && previousAddress !== (state.active.address || '')) {
        setSendMessage('', '', '');
    }
    previousAddress = state.active.address || '';

    refs.empty.hidden = visibleWallet || activeTab !== 'overview';
    refs.dashboard.hidden = !visibleWallet && activeTab === 'overview';

    if (!visibleWallet) {
        qrToken += 1;
        pageUiState.qr.requestKey = '';
        pageUiState.qr.error = '';
        refs.qrFrame.dataset.walletReceiveQr = 'idle';
        refs.qrFrame.replaceChildren();
        refs.qrHint.textContent = 'A local QR code appears here for the connected wallet address.';
        renderEmptyState(state);
        renderReceive(state);
        renderIdentity(state);
        renderSendState(state);
        setActiveWalletTab(activeTab);
        return;
    }

    renderConnectedState(state);
    setActiveWalletTab(activeTab);
}

function normalizeSendError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (error?.code === 4001 || message.includes('rejected') || message.includes('denied')) {
        return 'The transaction was cancelled in your wallet.';
    }
    if (message.includes('insufficient funds')) {
        return 'The connected wallet reported insufficient funds for the amount plus gas.';
    }
    if (message.includes('invalid address')) {
        return 'The wallet rejected the recipient address.';
    }
    if (message.includes('wrong network') || message.includes('ethereum mainnet')) {
        return 'Switch to Ethereum Mainnet before sending from BITBI.';
    }
    return 'The wallet could not submit that transaction.';
}

async function handleRefresh() {
    if (pageUiState.refreshing) return;

    pageUiState.refreshing = true;
    render(walletState);
    try {
        await actionsRef?.refreshWallet?.();
        setBanner(null, null);
    } catch {
        setBanner('warning', 'The connected wallet could not be refreshed right now.');
    } finally {
        pageUiState.refreshing = false;
        render(walletState);
    }
}

async function handleUseMax() {
    if (pageUiState.maxLoading) return;
    const recipient = refs.sendRecipient.value.trim();

    pageUiState.maxLoading = true;
    renderSendState(walletState);
    try {
        const maxWei = await actionsRef?.estimateMaxSendableAmount?.(recipient);
        refs.sendAmount.value = formatWeiToInput(maxWei || 0n);
        setSendMessage((maxWei || 0n) > 0n ? 'success' : 'warning', (maxWei || 0n) > 0n
            ? 'Prepared the maximum estimated send amount after reserving gas.'
            : 'No spendable ETH remains after reserving gas.');
    } catch {
        setSendMessage('warning', 'Could not estimate a safe maximum amount for this wallet right now.');
    } finally {
        pageUiState.maxLoading = false;
        renderSendState(walletState);
    }
}

async function handleSend(event) {
    event.preventDefault();
    setSendMessage('', '', '');

    if (!(walletState.status === 'connected' && walletState.active.address)) {
        setSendMessage('warning', 'Connect a wallet before sending.');
        return;
    }

    if (!walletState.active.isMainnet) {
        setSendMessage('warning', 'Switch to Ethereum Mainnet before sending from BITBI.');
        return;
    }

    const recipient = refs.sendRecipient.value.trim();
    if (!isValidEthereumAddress(recipient)) {
        setSendMessage('error', 'Enter a valid Ethereum address.');
        refs.sendRecipient.focus();
        return;
    }

    let amountWei = 0n;
    try {
        amountWei = parseEthAmountToWei(refs.sendAmount.value);
    } catch (error) {
        setSendMessage('error', error.message || 'Enter a valid ETH amount.');
        refs.sendAmount.focus();
        return;
    }

    if (amountWei <= 0n) {
        setSendMessage('error', 'Enter an amount greater than 0.');
        refs.sendAmount.focus();
        return;
    }

    pageUiState.send.submitting = true;
    renderSendState(walletState);

    try {
        const result = await actionsRef?.sendNativeTransaction?.({
            to: recipient,
            valueWei: amountWei,
        });
        pageUiState.send.submitting = false;
        refs.sendAmount.value = '';
        setSendMessage('success', result?.hash ? `Transaction submitted: ${result.hash}` : 'Transaction submitted.', result?.explorerUrl);
        window.setTimeout(() => {
            void handleRefresh();
        }, 1200);
    } catch (error) {
        pageUiState.send.submitting = false;
        setSendMessage('error', normalizeSendError(error));
        renderSendState(walletState);
    }
}

async function handleCopyAddress() {
    const address = walletState.active?.address || '';
    if (!address) return;

    try {
        const copied = await copyText(address);
        setBanner(copied ? 'success' : 'warning', copied ? 'Wallet address copied.' : 'Could not copy the wallet address.');
    } catch {
        setBanner('warning', 'Could not copy the wallet address.');
    }
}

function bindEvents() {
    root.querySelectorAll('[data-wallet-workspace-close]').forEach((button) => {
        button.addEventListener('click', () => actionsRef?.closeWorkspace?.());
    });
    refs.emptyConnectBtn?.addEventListener('click', () => actionsRef?.openPanel?.());
    refs.emptyOpenPanelBtn?.addEventListener('click', () => actionsRef?.openPanel?.());
    refs.refreshBtn?.addEventListener('click', () => { void handleRefresh(); });
    refs.copyBtn?.addEventListener('click', () => { void handleCopyAddress(); });
    refs.receiveCopyBtn?.addEventListener('click', () => { void handleCopyAddress(); });
    refs.switchBtn?.addEventListener('click', () => { void actionsRef?.switchToMainnet?.(); });
    refs.sendPanelBtn?.addEventListener('click', () => actionsRef?.openPanel?.());
    refs.sendMaxBtn?.addEventListener('click', () => { void handleUseMax(); });
    refs.sendForm?.addEventListener('submit', (event) => { void handleSend(event); });
    refs.sectionNav?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-wallet-tab-button]');
        if (!button) return;
        if (button.dataset.walletTabButton === getActiveWalletTab()) return;
        setActiveWalletTab(button.dataset.walletTabButton);
        render(walletState);
    });
}

export function initWalletWorkspace(actions) {
    actionsRef = actions || actionsRef;
    if (initialized) return;

    initialized = true;
    ensureWorkspace();
    subscribeWalletState((state) => {
        render(state);
    });
}
