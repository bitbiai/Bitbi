/* ============================================================
   BITBI — Wallet page
   Connected wallet dashboard with receive and native ETH send.
   ============================================================ */

import { initSiteHeader } from '../../shared/site-header.js?v=__ASSET_VERSION__';
import { initParticles } from '../../shared/particles.js';
import { initBinaryRain } from '../../shared/binary-rain.js';
import { initBinaryFooter } from '../../shared/binary-footer.js';
import { initScrollReveal } from '../../shared/scroll-reveal.js';
import { initCookieConsent } from '../../shared/cookie-consent.js';
import {
    estimateMaxSendableAmount,
    openWalletPanelView,
    refreshActiveWalletConnection,
    requestWalletLink,
    requestWalletLogin,
    sendNativeTransaction,
    switchConnectedWalletToMainnet,
    unlinkLinkedWallet,
} from '../../shared/wallet/wallet-controller.js?v=__ASSET_VERSION__';
import {
    getAddressExplorerUrl,
    getChainExplorer,
} from '../../shared/wallet/wallet-config.js?v=__ASSET_VERSION__';
import { renderWalletQrSvg } from '../../shared/wallet/wallet-qr.js?v=__ASSET_VERSION__';
import { getWalletState, subscribeWalletState } from '../../shared/wallet/wallet-state.js?v=__ASSET_VERSION__';

const $banner = document.getElementById('walletPageBanner');
const $sectionNav = document.getElementById('walletSectionNav');
const $empty = document.getElementById('walletPageEmpty');
const $emptyText = document.getElementById('walletPageEmptyText');
const $emptyConnectBtn = document.getElementById('walletPageConnectBtn');
const $emptyOpenPanelBtn = document.getElementById('walletPageOpenPanelBtn');
const $dashboard = document.getElementById('walletPageDashboard');
const $connectionPill = document.getElementById('walletPageConnectionPill');
const $networkPill = document.getElementById('walletPageNetworkPill');
const $providerBadge = document.getElementById('walletPageProviderBadge');
const $providerLabel = document.getElementById('walletPageProviderLabel');
const $providerMeta = document.getElementById('walletPageProviderMeta');
const $balanceValue = document.getElementById('walletPageBalanceValue');
const $updated = document.getElementById('walletPageUpdated');
const $addressFull = document.getElementById('walletPageAddressFull');
const $addressShort = document.getElementById('walletPageAddressShort');
const $networkName = document.getElementById('walletPageNetworkName');
const $chainId = document.getElementById('walletPageChainId');
const $refreshBtn = document.getElementById('walletPageRefreshBtn');
const $copyBtn = document.getElementById('walletPageCopyBtn');
const $explorerLink = document.getElementById('walletPageExplorerLink');
const $switchBtn = document.getElementById('walletPageSwitchBtn');
const $qrFrame = document.getElementById('walletPageQrFrame');
const $qrHint = document.getElementById('walletPageQrHint');
const $receiveAddress = document.getElementById('walletPageReceiveAddress');
const $receiveCopyBtn = document.getElementById('walletPageReceiveCopyBtn');
const $receiveExplorerLink = document.getElementById('walletPageReceiveExplorerLink');
const $sendForm = document.getElementById('walletSendForm');
const $sendMsg = document.getElementById('walletSendMsg');
const $sendRecipient = document.getElementById('walletSendRecipient');
const $sendAmount = document.getElementById('walletSendAmount');
const $sendHint = document.getElementById('walletSendHint');
const $sendSubmit = document.getElementById('walletSendSubmit');
const $sendPanelBtn = document.getElementById('walletSendPanelBtn');
const $sendMaxBtn = document.getElementById('walletSendMaxBtn');
const $identityCopy = document.getElementById('walletPageIdentityCopy');
const $identityRows = document.getElementById('walletPageIdentityRows');
const $identityActions = document.getElementById('walletPageIdentityActions');

const detailDateTime = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

let walletState = getWalletState();
let qrToken = 0;
let previousAddress = '';
let bannerTimer = null;
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
const walletSectionIds = ['wallet-overview', 'wallet-send', 'wallet-receive', 'wallet-account'];

function shortenAddress(address) {
    if (typeof address !== 'string' || address.length < 10) return address || '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function setActiveSectionLink(sectionId) {
    if (!$sectionNav) return;
    const resolvedSectionId = walletSectionIds.includes(sectionId) ? sectionId : 'wallet-overview';
    $sectionNav.querySelectorAll('[data-wallet-section-link]').forEach((link) => {
        const isActive = link.dataset.walletSectionLink === resolvedSectionId;
        link.classList.toggle('active', isActive);
        if (isActive) {
            link.setAttribute('aria-current', 'true');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

function syncSectionNav() {
    if (!$sectionNav || $sectionNav.hidden) return;
    const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
    setActiveSectionLink(walletSectionIds.includes(hash) ? hash : 'wallet-overview');
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
    if (!activeBanner?.text) {
        $banner.hidden = true;
        $banner.textContent = '';
        $banner.className = 'wallet-page__banner';
        return;
    }

    $banner.hidden = false;
    $banner.textContent = activeBanner.text;
    $banner.className = `wallet-page__banner wallet-page__banner--${activeBanner.type || 'warning'}`;
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
    $sendMsg.className = status ? `wallet-page__msg wallet-page__msg--${status}` : 'wallet-page__msg';
    $sendMsg.textContent = '';
    $sendMsg.replaceChildren();

    if (!text) return;

    const copy = document.createElement('span');
    copy.textContent = text;
    $sendMsg.appendChild(copy);

    if (explorerUrl) {
        $sendMsg.appendChild(document.createTextNode(' '));
        const link = document.createElement('a');
        link.href = explorerUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'View transaction';
        $sendMsg.appendChild(link);
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

    if (state.status === 'connecting') {
        $emptyText.textContent = 'Finish the connection request in your wallet. BITBI keeps the wallet page ready while the panel handles the connection flow.';
        $emptyConnectBtn.disabled = true;
        $emptyConnectBtn.textContent = 'Connecting…';
        $emptyOpenPanelBtn.disabled = true;
        $emptyOpenPanelBtn.textContent = 'Panel Busy';
        return;
    }

    $emptyText.textContent = connectedLinkedWallet;
    $emptyConnectBtn.disabled = false;
    $emptyConnectBtn.textContent = state.authLoggedIn && state.linkedWallet ? 'Reconnect Wallet' : 'Connect Wallet';
    $emptyOpenPanelBtn.disabled = false;
    $emptyOpenPanelBtn.textContent = 'Open Wallet Panel';
}

function renderSummary(state) {
    const active = state.active;
    const connected = state.status === 'connected' && !!active.address;
    const chainExplorer = getChainExplorer(active.chainId);
    const explorerUrl = getAddressExplorerUrl(active.chainId, active.address);
    const explorerLabel = chainExplorer?.label || 'Explorer';
    const wrongNetwork = connected && !active.isMainnet;

    $connectionPill.textContent = wrongNetwork ? 'Wrong network' : 'Connected';
    $connectionPill.className = `wallet-page__pill ${wrongNetwork ? 'wallet-page__pill--warning' : 'wallet-page__pill--success'}`;
    $networkPill.textContent = active.chainLabel || 'Unknown network';
    $networkPill.className = `wallet-page__pill ${wrongNetwork ? 'wallet-page__pill--warning' : 'wallet-page__pill--ghost'}`;

    $providerBadge.textContent = (active.providerName || 'Wallet').slice(0, 1).toUpperCase();
    $providerLabel.textContent = active.providerName || 'Connected wallet';
    $providerMeta.textContent = active.type === 'walletconnect'
        ? 'Connected through WalletConnect'
        : (active.type === 'injected' ? 'Connected through an installed browser wallet' : 'Connected wallet session');

    $balanceValue.textContent = active.balanceStatus === 'loading'
        ? 'Loading…'
        : active.balanceStatus === 'loaded'
            ? (active.balanceFormatted || '0 ETH')
            : active.balanceStatus === 'error'
                ? 'Balance unavailable'
                : active.balanceStatus === 'unavailable'
                    ? 'Mainnet only'
                    : '—';

    $updated.textContent = pageUiState.refreshing ? 'Refreshing…' : formatUpdated(active.refreshedAt);
    $addressFull.textContent = active.address || '—';
    $addressShort.textContent = active.shortAddress || shortenAddress(active.address) || '—';
    $networkName.textContent = active.chainLabel || '—';
    $chainId.textContent = active.chainId != null ? String(active.chainId) : '—';

    $refreshBtn.disabled = pageUiState.refreshing;
    $refreshBtn.textContent = pageUiState.refreshing ? 'Refreshing…' : 'Refresh';

    if (explorerUrl) {
        $explorerLink.hidden = false;
        $explorerLink.href = explorerUrl;
        $explorerLink.textContent = `View on ${explorerLabel}`;
    } else {
        $explorerLink.hidden = true;
        $explorerLink.removeAttribute('href');
    }

    $switchBtn.hidden = !wrongNetwork;
}

function renderReceive(state) {
    const active = state.active;
    const explorer = getAddressExplorerUrl(active.chainId, active.address);
    const receiveUri = buildReceiveUri(state);
    const explorerLabel = getChainExplorer(active.chainId)?.label || 'Explorer';

    $receiveAddress.textContent = active.address || '—';
    $receiveCopyBtn.disabled = !active.address;

    if (explorer) {
        $receiveExplorerLink.hidden = false;
        $receiveExplorerLink.href = explorer;
        $receiveExplorerLink.textContent = `Open on ${explorerLabel}`;
    } else {
        $receiveExplorerLink.hidden = true;
        $receiveExplorerLink.removeAttribute('href');
    }

    const requestKey = `${receiveUri}|${active.chainId || ''}`;
    if (!receiveUri) {
        pageUiState.qr.requestKey = '';
        pageUiState.qr.error = '';
        $qrFrame.dataset.walletReceiveQr = 'idle';
        $qrFrame.replaceChildren();
        $qrHint.textContent = 'A local QR code appears here for the connected wallet address.';
        return;
    }

    if (pageUiState.qr.requestKey === requestKey && !$qrFrame.dataset.walletReceiveQr.startsWith('loading')) {
        return;
    }

    pageUiState.qr.requestKey = requestKey;
    pageUiState.qr.error = '';
    const currentToken = ++qrToken;
    $qrFrame.dataset.walletReceiveQr = 'loading';
    $qrFrame.replaceChildren();
    $qrHint.textContent = 'Generating a client-side QR code for this connected address…';

    void renderWalletQrSvg(receiveUri, {
        cellSize: 9,
        margin: 1,
        title: 'BITBI wallet receive QR',
        description: `QR code for ${active.address} on ${active.chainLabel || 'the active chain'}.`,
    }).then((svgMarkup) => {
        if (currentToken !== qrToken) return;
        $qrFrame.dataset.walletReceiveQr = 'ready';
        $qrFrame.innerHTML = svgMarkup;
        $qrHint.textContent = active.isMainnet
            ? 'Scan to copy the connected Ethereum Mainnet address into another wallet.'
            : `Connected on ${active.chainLabel || 'another chain'}. BITBI wallet actions still target Ethereum Mainnet.`;
    }).catch(() => {
        if (currentToken !== qrToken) return;
        pageUiState.qr.error = 'QR unavailable';
        $qrFrame.dataset.walletReceiveQr = 'error';
        $qrFrame.replaceChildren();
        $qrHint.textContent = 'The wallet address is still shown below if QR rendering is unavailable in this browser.';
    });
}

function renderIdentity(state) {
    const connected = state.status === 'connected' && !!state.active.address;
    const linkedWallet = state.linkedWallet || null;
    const linkedMatchesActive = !!(linkedWallet && connected && addressesEqual(linkedWallet.address, state.active.address));
    const connectedDiffersFromLinked = !!(linkedWallet && connected && !linkedMatchesActive);
    const actionBusy = state.identityAction && state.identityAction !== 'idle';

    $identityRows.replaceChildren();
    $identityActions.replaceChildren();

    if (!state.authReady) {
        $identityCopy.textContent = 'Loading the current BITBI account session…';
        $identityRows.appendChild(createRow('Status', 'Loading…'));
        return;
    }

    if (!state.authLoggedIn) {
        $identityCopy.textContent = 'Wallet connection alone does not sign you in. Use Sign in with Ethereum only if this wallet is already linked to a BITBI account.';
        $identityRows.appendChild(createRow('Status', 'Not signed in to BITBI'));
        $identityRows.appendChild(createRow('Wallet session', connected ? 'Connected in this browser' : 'Not connected'));

        if (connected) {
            $identityActions.appendChild(createIdentityButton(
                actionBusy ? 'Working…' : 'Sign In with Ethereum',
                'wallet-page__button',
                () => requestWalletLogin(),
                actionBusy || !state.active.isMainnet,
            ));
        }
        return;
    }

    if (!linkedWallet) {
        $identityCopy.textContent = connected
            ? 'Your wallet is connected in this browser, but it is not linked to your BITBI account yet.'
            : 'You are signed in to BITBI. Connect a wallet to link it to this account.';
        $identityRows.appendChild(createRow('Status', connected ? 'Connected, not linked' : 'Signed in, wallet not connected'));
        if (connected) {
            $identityRows.appendChild(createRow('Connected wallet', state.active.address));
            $identityActions.appendChild(createIdentityButton(
                actionBusy ? 'Working…' : 'Link Connected Wallet',
                'wallet-page__button',
                () => requestWalletLink(),
                actionBusy || !state.active.isMainnet,
            ));
        } else {
            $identityActions.appendChild(createIdentityButton(
                'Connect Wallet',
                'wallet-page__button',
                () => openWalletPanelView(),
            ));
        }
        return;
    }

    $identityRows.appendChild(createRow('Linked wallet', linkedWallet.address));
    $identityRows.appendChild(createRow('Linked at', formatIdentityDate(linkedWallet.linkedAt)));
    if (linkedWallet.lastLoginAt) {
        $identityRows.appendChild(createRow('Last wallet sign-in', formatIdentityDate(linkedWallet.lastLoginAt)));
    }

    if (linkedMatchesActive) {
        $identityCopy.textContent = 'This connected wallet matches the wallet linked to your BITBI account.';
        $identityRows.prepend(createRow('Status', 'Linked and connected'));
    } else if (connectedDiffersFromLinked) {
        $identityCopy.textContent = 'A different wallet is connected in this browser than the one currently linked to your BITBI account.';
        $identityRows.prepend(createRow('Status', 'Different wallet connected'));
        $identityRows.appendChild(createRow('Connected wallet', state.active.address));
    } else {
        $identityCopy.textContent = 'Your BITBI account remains signed in even when the linked wallet is not currently connected in this browser tab.';
        $identityRows.prepend(createRow('Status', 'Linked'));
    }

    if (!connected) {
        $identityActions.appendChild(createIdentityButton(
            'Reconnect Wallet',
            'wallet-page__button',
            () => openWalletPanelView(),
        ));
    }

    $identityActions.appendChild(createIdentityButton(
        state.identityAction === 'unlinking' ? 'Unlinking…' : 'Unlink Wallet',
        'wallet-page__button wallet-page__button--danger',
        async () => {
            await unlinkLinkedWallet();
        },
        actionBusy,
    ));
}

function renderSendState(state) {
    const connected = state.status === 'connected' && !!state.active.address;
    const sendEnabled = connected && state.active.isMainnet;

    $sendRecipient.disabled = !sendEnabled || pageUiState.send.submitting;
    $sendAmount.disabled = !sendEnabled || pageUiState.send.submitting;
    $sendSubmit.disabled = !sendEnabled || pageUiState.send.submitting;
    $sendMaxBtn.disabled = !sendEnabled || pageUiState.send.submitting || pageUiState.maxLoading || state.active.balanceStatus !== 'loaded';

    if (!connected) {
        $sendHint.textContent = 'Connect an Ethereum Mainnet wallet to prepare a native ETH transfer.';
    } else if (!state.active.isMainnet) {
        $sendHint.textContent = 'Switch the connected wallet to Ethereum Mainnet before sending from BITBI.';
    } else if (state.active.balanceStatus === 'loaded') {
        $sendHint.textContent = `Available balance: ${state.active.balanceFormatted || '0 ETH'}. The transaction is confirmed inside your connected wallet.`;
    } else if (state.active.balanceStatus === 'loading') {
        $sendHint.textContent = 'Balance is loading. You can still enter an amount manually.';
    } else if (state.active.balanceStatus === 'error') {
        $sendHint.textContent = 'Balance could not be refreshed, but the connected wallet can still attempt a send.';
    } else {
        $sendHint.textContent = 'Available only while an Ethereum Mainnet wallet is actively connected.';
    }

    $sendSubmit.textContent = pageUiState.send.submitting ? 'Confirm in Wallet…' : 'Send ETH';
    $sendMaxBtn.textContent = pageUiState.maxLoading ? 'Preparing…' : 'Use Max';
}

function renderConnectedState(state) {
    renderSummary(state);
    renderReceive(state);
    renderIdentity(state);
    renderSendState(state);
}

function render(state) {
    walletState = state;
    renderBanner(state);

    const connected = state.status === 'connected' && !!state.active.address;
    if (previousAddress && previousAddress !== (state.active.address || '')) {
        setSendMessage('', '', '');
    }
    previousAddress = state.active.address || '';

    $empty.hidden = connected;
    $dashboard.hidden = !connected;
    if ($sectionNav) {
        $sectionNav.hidden = !connected;
    }

    if (!connected) {
        qrToken += 1;
        pageUiState.qr.requestKey = '';
        pageUiState.qr.error = '';
        $qrFrame.dataset.walletReceiveQr = 'idle';
        $qrFrame.replaceChildren();
        $qrHint.textContent = 'A local QR code appears here for the connected wallet address.';
        renderEmptyState(state);
        renderSendState(state);
        setActiveSectionLink('wallet-overview');
        return;
    }

    renderConnectedState(state);
    syncSectionNav();
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
        await refreshActiveWalletConnection();
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
    const recipient = $sendRecipient.value.trim();

    pageUiState.maxLoading = true;
    renderSendState(walletState);
    try {
        const maxWei = await estimateMaxSendableAmount(recipient);
        $sendAmount.value = formatWeiToInput(maxWei);
        setSendMessage('success', maxWei > 0n
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

    const recipient = $sendRecipient.value.trim();
    if (!isValidEthereumAddress(recipient)) {
        setSendMessage('error', 'Enter a valid Ethereum address.');
        $sendRecipient.focus();
        return;
    }

    let amountWei = 0n;
    try {
        amountWei = parseEthAmountToWei($sendAmount.value);
    } catch (error) {
        setSendMessage('error', error.message || 'Enter a valid ETH amount.');
        $sendAmount.focus();
        return;
    }

    if (amountWei <= 0n) {
        setSendMessage('error', 'Enter an amount greater than 0.');
        $sendAmount.focus();
        return;
    }

    pageUiState.send.submitting = true;
    renderSendState(walletState);

    try {
        const result = await sendNativeTransaction({
            to: recipient,
            valueWei: amountWei,
        });
        pageUiState.send.submitting = false;
        $sendAmount.value = '';
        setSendMessage('success', result.hash ? `Transaction submitted: ${result.hash}` : 'Transaction submitted.', result.explorerUrl);
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
    $emptyConnectBtn?.addEventListener('click', () => openWalletPanelView());
    $emptyOpenPanelBtn?.addEventListener('click', () => openWalletPanelView());
    $refreshBtn?.addEventListener('click', () => { void handleRefresh(); });
    $copyBtn?.addEventListener('click', () => { void handleCopyAddress(); });
    $receiveCopyBtn?.addEventListener('click', () => { void handleCopyAddress(); });
    $switchBtn?.addEventListener('click', () => { void switchConnectedWalletToMainnet(); });
    $sendPanelBtn?.addEventListener('click', () => openWalletPanelView());
    $sendMaxBtn?.addEventListener('click', () => { void handleUseMax(); });
    $sendForm?.addEventListener('submit', (event) => { void handleSend(event); });
    window.addEventListener('hashchange', syncSectionNav);
}

function init() {
    try { initSiteHeader(); } catch (error) { console.warn(error); }
    try { initParticles('heroCanvas'); } catch (error) { console.warn(error); }
    try { initBinaryRain('binaryRain'); } catch (error) { console.warn(error); }
    try { initBinaryFooter('binaryFooter'); } catch (error) { console.warn(error); }
    try { initScrollReveal(); } catch (error) { console.warn(error); }
    try { initCookieConsent(); } catch (error) { console.warn(error); }

    bindEvents();
    subscribeWalletState((state) => {
        render(state);
    });
}

init();
