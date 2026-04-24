/* ============================================================
   BITBI — Wallet UI
   Shared desktop/mobile trigger and wallet overlay renderer.
   ============================================================ */

import { setupFocusTrap } from '../focus-trap.js';
import { ETHERSCAN_ADDRESS_BASE, walletConfig } from './wallet-config.js?v=__ASSET_VERSION__';
import { subscribeWalletState } from './wallet-state.js?v=__ASSET_VERSION__';

let initialized = false;
let currentState = null;
let actionsRef = null;
let desktopTrigger = null;
let mobileRow = null;
let mobileTrigger = null;
let mobilePageLink = null;
let modalRoot = null;
let modalPanel = null;
let modalBody = null;
let removeFocusTrap = null;
let modalIsOpen = false;
let pendingScrollLockSync = false;

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
}

function ensureStyles() {
    if (document.getElementById('bitbiWalletStyles')) return;
    const link = document.createElement('link');
    link.id = 'bitbiWalletStyles';
    link.rel = 'stylesheet';
    link.href = walletConfig.stylesUrl;
    document.head.appendChild(link);
}

function getSafeImageUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return '';

    try {
        const url = new URL(raw, window.location.href);
        if (url.protocol === 'https:') return url.toString();
        if (url.protocol === 'http:' && window.location.protocol === 'http:') return url.toString();
    } catch {
        return '';
    }

    return '';
}

function addressesEqual(left, right) {
    if (!left || !right) return false;
    return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function getAuthContext(state) {
    const hasConnectedWallet = state.status === 'connected' && !!state.active.address;
    const linkedWallet = state.linkedWallet;
    const linkedMatchesActive = !!(linkedWallet && hasConnectedWallet && addressesEqual(linkedWallet.address, state.active.address));
    return {
        hasConnectedWallet,
        linkedWallet,
        linkedMatchesActive,
        connectedDiffersFromLinked: !!(linkedWallet && hasConnectedWallet && !linkedMatchesActive),
        busy: state.identityAction && state.identityAction !== 'idle',
    };
}

function createProviderVisual(name, icon, size = 'md') {
    const visual = createElement('span', `wallet-ui__provider-visual wallet-ui__provider-visual--${size}`);
    const safeIcon = getSafeImageUrl(icon);
    if (safeIcon) {
        const image = document.createElement('img');
        image.className = 'wallet-ui__provider-icon';
        image.src = safeIcon;
        image.alt = '';
        image.decoding = 'async';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        visual.appendChild(image);
        return visual;
    }

    const fallback = createElement('span', 'wallet-ui__provider-fallback', (name || 'W').slice(0, 1).toUpperCase());
    fallback.setAttribute('aria-hidden', 'true');
    visual.appendChild(fallback);
    return visual;
}

function syncBodyScrollLock() {
    const shouldLock = !!(
        modalRoot?.classList.contains('is-open')
        || document.querySelector('#walletWorkspace.is-open')
        || document.querySelector('#mobileNav.open')
        || document.querySelector('.auth-modal__overlay.active, .modal-overlay.active')
    );
    document.body.style.overflow = shouldLock ? 'hidden' : '';
}

function queueBodyScrollLockSync() {
    if (pendingScrollLockSync) return;
    pendingScrollLockSync = true;
    queueMicrotask(() => {
        pendingScrollLockSync = false;
        syncBodyScrollLock();
    });
}

function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (!currentState?.isOpen) return;
    actionsRef?.closePanel?.();
}

function ensureDesktopTrigger() {
    if (desktopTrigger?.isConnected) return desktopTrigger;

    const actions = document.querySelector('.site-nav__actions');
    if (!actions) return null;

    desktopTrigger = createElement('button', 'wallet-nav__trigger');
    desktopTrigger.type = 'button';
    desktopTrigger.dataset.walletOpen = 'desktop';
    desktopTrigger.setAttribute('aria-haspopup', 'dialog');
    desktopTrigger.setAttribute('aria-controls', 'walletModal');
    desktopTrigger.setAttribute('aria-label', 'Open wallet panel');
    desktopTrigger.innerHTML = `<span class="wallet-nav__status-dot" aria-hidden="true"></span>Panel`;
    desktopTrigger.addEventListener('click', () => actionsRef?.openPanel?.());

    const mood = actions.querySelector('.site-nav__mood');
    if (mood?.nextSibling) {
        actions.insertBefore(desktopTrigger, mood.nextSibling);
    } else if (mood) {
        actions.appendChild(desktopTrigger);
    } else {
        actions.prepend(desktopTrigger);
    }

    return desktopTrigger;
}

function ensureMobileTrigger() {
    if (mobileRow?.isConnected) return mobileRow;

    const mobileNav = document.getElementById('mobileNav');
    const mobileAuth = document.getElementById('mobileNavAuth');
    if (!mobileNav || !mobileAuth?.parentNode) return null;

    const section = createElement('nav', 'mobile-nav__section mobile-nav__section--wallet');
    section.setAttribute('aria-label', 'Wallet');

    const label = createElement('span', 'mobile-nav__label', 'Wallet');
    section.appendChild(label);
    mobileRow = section;

    const mobileRowLayout = createElement('div', 'wallet-nav__mobile-row');
    mobileRowLayout.dataset.walletRow = 'mobile';

    mobilePageLink = document.createElement('button');
    mobilePageLink.className = 'mobile-nav__link mobile-nav__link--primary wallet-nav__mobile-link';
    mobilePageLink.type = 'button';
    mobilePageLink.dataset.walletPage = 'mobile';
    mobilePageLink.dataset.walletDefaultMeta = 'Open wallet workspace';
    mobilePageLink.setAttribute('aria-haspopup', 'dialog');
    mobilePageLink.setAttribute('aria-controls', 'walletWorkspace');
    const pageCopy = createElement('span', 'wallet-nav__mobile-copy');
    pageCopy.append(
        createElement('span', 'wallet-nav__mobile-label', 'Wallet'),
        createElement('span', 'wallet-nav__mobile-meta', 'Open wallet workspace'),
    );
    mobilePageLink.appendChild(pageCopy);
    mobilePageLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('mobileNavClose')?.click();
        window.setTimeout(() => actionsRef?.openWorkspace?.(), 40);
    });

    mobileTrigger = createElement('button', 'wallet-nav__mobile-trigger');
    mobileTrigger.type = 'button';
    mobileTrigger.dataset.walletOpen = 'mobile';
    mobileTrigger.setAttribute('aria-label', 'Open wallet panel');
    const triggerLabel = createElement('span', 'wallet-nav__mobile-trigger-label', 'Panel');
    mobileTrigger.appendChild(triggerLabel);
    mobileTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('mobileNavClose')?.click();
        window.setTimeout(() => actionsRef?.openPanel?.(), 40);
    });

    mobileRowLayout.append(mobilePageLink, mobileTrigger);
    section.appendChild(mobileRowLayout);
    mobileAuth.parentNode.insertBefore(section, mobileAuth.nextSibling);

    return section;
}

function ensureModal() {
    if (modalRoot?.isConnected) return modalRoot;

    modalRoot = createElement('div', 'wallet-modal');
    modalRoot.id = 'walletModal';
    modalRoot.dataset.walletModal = 'true';
    modalRoot.hidden = true;

    const backdrop = createElement('button', 'wallet-modal__backdrop');
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Close wallet panel');
    backdrop.dataset.walletClose = 'backdrop';
    backdrop.addEventListener('click', () => actionsRef?.closePanel?.());

    modalPanel = createElement('section', 'wallet-modal__panel');
    modalPanel.setAttribute('role', 'dialog');
    modalPanel.setAttribute('aria-modal', 'true');
    modalPanel.setAttribute('aria-labelledby', 'walletModalTitle');
    modalPanel.tabIndex = -1;
    modalPanel.dataset.walletScroll = 'panel';

    const close = createElement('button', 'wallet-modal__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close wallet panel');
    close.dataset.walletClose = 'panel';
    close.textContent = '×';
    close.addEventListener('click', () => actionsRef?.closePanel?.());

    const header = createElement('div', 'wallet-modal__header');
    const titleWrap = createElement('div', 'wallet-modal__title-wrap');
    const eyebrow = createElement('span', 'wallet-modal__eyebrow', 'Ethereum');
    const title = createElement('h2', 'wallet-modal__title', 'Wallet');
    title.id = 'walletModalTitle';
    const desc = createElement('p', 'wallet-modal__desc', 'Connect an Ethereum wallet to view account details and use wallet sign-in on BITBI.');
    titleWrap.append(eyebrow, title, desc);
    header.append(titleWrap, close);

    modalBody = createElement('div', 'wallet-modal__body');
    modalBody.setAttribute('data-wallet-body', 'true');

    modalPanel.append(header, modalBody);
    modalRoot.append(backdrop, modalPanel);
    document.body.appendChild(modalRoot);
    document.addEventListener('keydown', handleEscape);

    return modalRoot;
}

function setModalOpen(open) {
    if (!modalRoot || !modalPanel) return;

    if (open === modalIsOpen) {
        syncBodyScrollLock();
        return;
    }

    modalIsOpen = open;
    modalRoot.hidden = !open;
    modalRoot.classList.toggle('is-open', open);

    if (open) {
        removeFocusTrap = setupFocusTrap(modalPanel);
    } else {
        removeFocusTrap?.();
        removeFocusTrap = null;
    }

    syncBodyScrollLock();
}

function syncTrigger(trigger, state, isMobile = false) {
    if (!trigger) return;

    const label = trigger.querySelector(isMobile ? '.wallet-nav__mobile-label' : '.wallet-nav__label');
    const meta = trigger.querySelector(isMobile ? '.wallet-nav__mobile-meta' : '.wallet-nav__meta');
    const statusDot = trigger.querySelector(isMobile ? '.wallet-nav__mobile-status' : '.wallet-nav__status-dot');
    const isConnected = state.status === 'connected' && !!state.active.address;
    const isWrongNetwork = isConnected && !state.active.isMainnet;

    trigger.classList.toggle('is-connected', isConnected);
    trigger.classList.toggle('is-warning', isWrongNetwork);
    trigger.classList.toggle('is-busy', (state.status === 'connecting' || state.status === 'restoring') || (state.identityAction && state.identityAction !== 'idle'));

    if (statusDot) {
        statusDot.classList.toggle('is-connected', isConnected);
        statusDot.classList.toggle('is-warning', isWrongNetwork);
        statusDot.classList.toggle('is-busy', (state.status === 'connecting' || state.status === 'restoring') || (state.identityAction && state.identityAction !== 'idle'));
    }

    if (label) {
        label.textContent = 'Wallet';
    }

    if (meta) {
        const defaultMeta = trigger.dataset.walletDefaultMeta || 'Open wallet workspace';
        let metaText = defaultMeta;

        if (state.status === 'connecting') {
            metaText = 'Connection pending';
        } else if (state.status === 'restoring') {
            metaText = state.active.shortAddress || state.active.address
                ? `Restoring ${state.active.shortAddress || state.active.address}`
                : 'Restoring wallet';
        } else if (state.identityAction === 'signing') {
            metaText = 'Check wallet';
        } else if (state.identityAction === 'verifying') {
            metaText = 'Verifying…';
        } else if (isConnected) {
            metaText = state.active.shortAddress || state.active.address || 'Connected';
        } else if (state.authLoggedIn && state.linkedWallet) {
            metaText = state.linkedWallet.shortAddress || 'Linked wallet';
        }

        meta.textContent = metaText;
        meta.classList.toggle('is-connected-address', isConnected);
    }

    const isCurrent = !!state.workspaceOpen;
    trigger.classList.toggle('is-current', isCurrent);
    trigger.setAttribute('aria-expanded', String(isCurrent));
}

function createBanner(state) {
    if (!state.message?.text) return null;
    const banner = createElement('div', `wallet-modal__banner wallet-modal__banner--${state.message.type || 'info'}`);
    banner.dataset.walletMessage = state.message.type || 'info';
    banner.setAttribute('role', 'status');
    banner.textContent = state.message.text;
    return banner;
}

function createSectionTitle(title, subtitle) {
    const wrap = createElement('div', 'wallet-modal__section-heading');
    wrap.append(
        createElement('h3', 'wallet-modal__section-title', title),
        createElement('p', 'wallet-modal__section-subtitle', subtitle),
    );
    return wrap;
}

function renderDetailRow(label, value, extraClass = '') {
    const row = createElement('div', `wallet-modal__detail-row ${extraClass}`.trim());
    row.append(
        createElement('span', 'wallet-modal__detail-label', label),
        createElement('span', 'wallet-modal__detail-value', value),
    );
    return row;
}

function buildIdentityActionLabel(state, intent) {
    if (state.identityAction === 'requesting') {
        return 'Preparing message…';
    }
    if (state.identityAction === 'signing') {
        return 'Check your wallet…';
    }
    if (state.identityAction === 'verifying') {
        return intent === 'login' ? 'Signing in…' : 'Linking…';
    }
    if (state.identityAction === 'unlinking') {
        return 'Unlinking…';
    }
    if (intent === 'login') return 'Sign In with Ethereum';
    if (intent === 'link') return 'Link Wallet to Account';
    return 'Continue';
}

function createIdentityActionButton(state, intent) {
    const button = createElement('button', 'wallet-modal__action', buildIdentityActionLabel(state, intent));
    button.type = 'button';
    button.disabled = state.identityAction !== 'idle' || !state.active.isMainnet;
    if (intent === 'login') {
        button.dataset.walletLogin = 'true';
        button.addEventListener('click', () => actionsRef?.loginWithWallet?.());
    } else {
        button.dataset.walletLink = 'true';
        button.addEventListener('click', () => actionsRef?.linkWallet?.());
    }
    return button;
}

function createUnlinkButton(state) {
    const button = createElement('button', 'wallet-modal__action wallet-modal__action--ghost', state.identityAction === 'unlinking' ? 'Unlinking…' : 'Unlink Wallet');
    button.type = 'button';
    button.dataset.walletUnlink = 'true';
    button.disabled = state.identityAction !== 'idle';
    button.addEventListener('click', () => actionsRef?.unlinkWallet?.());
    return button;
}

function renderDisconnectedIdentityState(state) {
    if (!state.authReady || !state.authLoggedIn || !state.linkedWallet) return null;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(createSectionTitle(
        'Linked wallet',
        'Your BITBI account session stays active even when no wallet is currently connected in this browser tab.',
    ));

    const details = createElement('div', 'wallet-modal__details');
    details.appendChild(renderDetailRow('Linked address', state.linkedWallet.address));
    details.appendChild(renderDetailRow('Network', 'Ethereum Mainnet'));
    if (state.linkedWallet.lastLoginAt) {
        details.appendChild(renderDetailRow('Last wallet sign-in', state.linkedWallet.lastLoginAt));
    }
    fragment.appendChild(details);

    const actions = createElement('div', 'wallet-modal__action-row');
    actions.appendChild(createUnlinkButton(state));
    fragment.appendChild(actions);
    return fragment;
}

function renderConnectedIdentityState(state) {
    const auth = getAuthContext(state);
    const fragment = document.createDocumentFragment();

    fragment.appendChild(createSectionTitle(
        'Wallet access',
        'Connecting a wallet does not automatically sign you in or link it to your BITBI account.',
    ));

    if (!state.active.isMainnet) {
        const note = createElement('p', 'wallet-modal__footnote', 'Switch to Ethereum Mainnet before using wallet sign-in or wallet linking.');
        fragment.appendChild(note);
        return fragment;
    }

    if (!state.authReady) {
        fragment.appendChild(createElement('p', 'wallet-modal__footnote', 'Loading BITBI account state…'));
        return fragment;
    }

    if (!state.authLoggedIn) {
        fragment.appendChild(createElement('p', 'wallet-modal__footnote', 'If this wallet is already linked to a BITBI account, use Sign in with Ethereum to create the normal BITBI session.'));
        const actions = createElement('div', 'wallet-modal__action-row');
        actions.appendChild(createIdentityActionButton(state, 'login'));
        fragment.appendChild(actions);
        return fragment;
    }

    if (!auth.linkedWallet) {
        fragment.appendChild(createElement('p', 'wallet-modal__footnote', 'This connected wallet is not yet linked to your current BITBI account.'));
        const actions = createElement('div', 'wallet-modal__action-row');
        actions.appendChild(createIdentityActionButton(state, 'link'));
        fragment.appendChild(actions);
        return fragment;
    }

    if (auth.linkedMatchesActive) {
        const banner = createElement('div', 'wallet-modal__banner wallet-modal__banner--success');
        banner.textContent = 'This connected wallet is already linked to your BITBI account.';
        fragment.appendChild(banner);
        const actions = createElement('div', 'wallet-modal__action-row');
        actions.appendChild(createUnlinkButton(state));
        fragment.appendChild(actions);
        return fragment;
    }

    const warning = createElement('div', 'wallet-modal__warning');
    warning.append(
        createElement('strong', 'wallet-modal__warning-title', 'Different linked wallet'),
        createElement('p', 'wallet-modal__warning-copy', `Your BITBI account is currently linked to ${state.linkedWallet.shortAddress || state.linkedWallet.address}. Unlink it before linking a different wallet.`),
    );
    fragment.appendChild(warning);

    const actions = createElement('div', 'wallet-modal__action-row');
    actions.appendChild(createUnlinkButton(state));
    fragment.appendChild(actions);
    return fragment;
}

function renderDisconnectedState(state) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createSectionTitle(
        'Connect a wallet',
        'Ethereum Mainnet is the only supported network in this release. Use an injected browser wallet or a compatible wallet in-app browser.',
    ));

    const walletsWrap = createElement('div', 'wallet-modal__stack');
    const injectedTitle = createElement('h4', 'wallet-modal__mini-title', 'Installed browser wallets');
    walletsWrap.appendChild(injectedTitle);

    if (state.injectedDiscoveryState === 'scanning') {
        const empty = createElement('div', 'wallet-modal__empty');
        empty.append(
            createElement('strong', 'wallet-modal__empty-title', 'Looking for browser wallets'),
            createElement('span', 'wallet-modal__empty-copy', 'Scanning this browser for injected Ethereum wallets before showing connection choices.'),
        );
        walletsWrap.appendChild(empty);
    }

    if (state.injectedWallets.length > 0) {
        state.injectedWallets.forEach((wallet) => {
            const button = createElement('button', 'wallet-modal__option');
            button.type = 'button';
            button.dataset.walletProviderId = wallet.id;
            button.disabled = state.status === 'connecting' || state.status === 'restoring';
            button.append(
                createProviderVisual(wallet.name, wallet.icon, 'sm'),
                (() => {
                    const copy = createElement('span', 'wallet-modal__option-copy');
                    copy.append(
                        createElement('span', 'wallet-modal__option-title', wallet.name),
                        createElement('span', 'wallet-modal__option-meta', 'Connect with the injected EIP-1193 provider'),
                    );
                    return copy;
                })(),
            );
            button.addEventListener('click', () => actionsRef?.connectInjected?.(wallet.id));
            walletsWrap.appendChild(button);
        });
    } else if (state.injectedDiscoveryState !== 'scanning') {
        const empty = createElement('div', 'wallet-modal__empty');
        empty.append(
            createElement('strong', 'wallet-modal__empty-title', 'No browser wallet detected'),
            createElement('span', 'wallet-modal__empty-copy', 'Install an Ethereum wallet that supports injected browser access to connect here.'),
        );
        walletsWrap.appendChild(empty);
    }

    fragment.appendChild(walletsWrap);

    const linkedState = renderDisconnectedIdentityState(state);
    if (linkedState) {
        fragment.appendChild(linkedState);
    }

    return fragment;
}

function renderConnectingState(state) {
    const wrap = createElement('div', 'wallet-modal__connecting');
    const connectorName = state.injectedWallets.find(wallet => wallet.id === state.connectingConnectorId)?.name || 'Browser wallet';

    wrap.append(
        createElement('div', 'wallet-modal__spinner'),
        createElement('h3', 'wallet-modal__connecting-title', 'Connecting…'),
        createElement('p', 'wallet-modal__connecting-copy', `Waiting for ${connectorName} to finish the connection request.`),
    );
    return wrap;
}

function renderRestoringState() {
    const wrap = createElement('div', 'wallet-modal__connecting');
    wrap.append(
        createElement('div', 'wallet-modal__spinner'),
        createElement('h3', 'wallet-modal__connecting-title', 'Restoring…'),
        createElement('p', 'wallet-modal__connecting-copy', 'Reattaching the previous browser-wallet session without opening a new connection request.'),
    );
    return wrap;
}

function renderConnectedState(state) {
    const fragment = document.createDocumentFragment();

    const summary = createElement('div', 'wallet-modal__summary');
    summary.append(
        createProviderVisual(state.active.providerName || 'Wallet', state.active.providerIcon, 'lg'),
        (() => {
            const copy = createElement('div', 'wallet-modal__summary-copy');
            copy.append(
                createElement('span', 'wallet-modal__summary-name', state.active.providerName || 'Connected wallet'),
                createElement('span', 'wallet-modal__summary-address', state.active.shortAddress || state.active.address),
            );
            return copy;
        })(),
    );
    fragment.appendChild(summary);

    const details = createElement('div', 'wallet-modal__details');
    details.appendChild(renderDetailRow('Address', state.active.address));
    details.appendChild(renderDetailRow('Network', state.active.chainLabel));
    if (state.active.balanceStatus === 'loading') {
        details.appendChild(renderDetailRow('ETH Balance', 'Loading…'));
    } else if (state.active.balanceStatus === 'loaded') {
        details.appendChild(renderDetailRow('ETH Balance', state.active.balanceFormatted || '0 ETH'));
    } else if (state.active.balanceStatus === 'error') {
        details.appendChild(renderDetailRow('ETH Balance', state.active.balanceError || 'Could not load balance.', 'is-error'));
    } else if (state.active.balanceStatus === 'unavailable') {
        details.appendChild(renderDetailRow('ETH Balance', 'Switch to Ethereum Mainnet', 'is-warning'));
    }
    fragment.appendChild(details);

    const actions = createElement('div', 'wallet-modal__action-row');

    const copyBtn = createElement('button', 'wallet-modal__action wallet-modal__action--ghost', 'Copy Address');
    copyBtn.type = 'button';
    copyBtn.dataset.walletCopy = 'true';
    copyBtn.addEventListener('click', () => actionsRef?.copyAddress?.());

    const etherscan = createElement('a', 'wallet-modal__action', 'View on Etherscan');
    etherscan.href = `${ETHERSCAN_ADDRESS_BASE}${state.active.address}`;
    etherscan.target = '_blank';
    etherscan.rel = 'noopener noreferrer';
    etherscan.dataset.walletEtherscan = 'true';

    const disconnect = createElement('button', 'wallet-modal__action wallet-modal__action--ghost', 'Disconnect');
    disconnect.type = 'button';
    disconnect.dataset.walletDisconnect = 'true';
    disconnect.addEventListener('click', () => actionsRef?.disconnectWallet?.());

    actions.append(copyBtn, etherscan, disconnect);
    fragment.appendChild(actions);

    if (!state.active.isMainnet) {
        const warning = createElement('div', 'wallet-modal__warning');
        warning.append(
            createElement('strong', 'wallet-modal__warning-title', 'Wrong network'),
            createElement('p', 'wallet-modal__warning-copy', 'Switch to Ethereum Mainnet to use this wallet release on BITBI.'),
        );

        const switchBtn = createElement('button', 'wallet-modal__switch-btn', 'Switch to Ethereum');
        switchBtn.type = 'button';
        switchBtn.dataset.walletSwitch = 'true';
        switchBtn.addEventListener('click', () => actionsRef?.switchToMainnet?.());
        warning.appendChild(switchBtn);
        fragment.appendChild(warning);
    }

    fragment.appendChild(renderConnectedIdentityState(state));

    return fragment;
}

function renderBody(state) {
    if (!modalBody) return;

    modalBody.replaceChildren();
    const banner = createBanner(state);
    if (banner) modalBody.appendChild(banner);

    if (state.status === 'connecting') {
        modalBody.appendChild(renderConnectingState(state));
        return;
    }

    if (state.status === 'restoring') {
        modalBody.appendChild(renderRestoringState());
        return;
    }

    if (state.status === 'connected' && state.active.address) {
        modalBody.appendChild(renderConnectedState(state));
        return;
    }

    modalBody.appendChild(renderDisconnectedState(state));
}

function syncDesktopStatusDot(state) {
    const dot = desktopTrigger?.querySelector('.wallet-nav__status-dot');
    if (!dot) return;
    const isConnected = state.status === 'connected' && !!state.active?.address;
    const isWrongNetwork = isConnected && !state.active?.isMainnet;
    const isBusy = (state.status === 'connecting' || state.status === 'restoring')
        || (state.identityAction && state.identityAction !== 'idle');
    dot.classList.toggle('is-connected', isConnected);
    dot.classList.toggle('is-warning', isWrongNetwork);
    dot.classList.toggle('is-busy', isBusy);
}

function render(state) {
    currentState = state;
    ensureDesktopTrigger();
    ensureMobileTrigger();
    ensureModal();

    syncDesktopStatusDot(state);
    syncTrigger(mobilePageLink, state, true);
    desktopTrigger?.setAttribute('aria-expanded', String(!!state.isOpen));
    mobileTrigger?.setAttribute('aria-expanded', String(!!state.isOpen));
    renderBody(state);
    setModalOpen(!!state.isOpen);
    queueBodyScrollLockSync();
}

export function initWalletUI(actions) {
    actionsRef = actions;
    if (initialized) return;
    initialized = true;

    ensureStyles();
    ensureDesktopTrigger();
    ensureMobileTrigger();
    ensureModal();
    subscribeWalletState(render);
}
