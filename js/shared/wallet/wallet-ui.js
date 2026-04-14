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
let mobileTrigger = null;
let modalRoot = null;
let modalPanel = null;
let modalBody = null;
let removeFocusTrap = null;
let modalIsOpen = false;

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
        || document.querySelector('#mobileNav.open')
        || document.querySelector('.auth-modal__overlay.active, .modal-overlay.active')
    );
    document.body.style.overflow = shouldLock ? 'hidden' : '';
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
    desktopTrigger.innerHTML = `
        <span class="wallet-nav__status-dot" aria-hidden="true"></span>
        <span class="wallet-nav__text">
            <span class="wallet-nav__label">Wallet</span>
            <span class="wallet-nav__meta">Connect</span>
        </span>
    `;
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
    if (mobileTrigger?.isConnected) return mobileTrigger;

    const mobileNav = document.getElementById('mobileNav');
    const mobileAuth = document.getElementById('mobileNavAuth');
    if (!mobileNav || !mobileAuth?.parentNode) return null;

    const section = createElement('section', 'mobile-nav__section mobile-nav__section--wallet');
    section.setAttribute('aria-label', 'Wallet');

    const label = createElement('span', 'mobile-nav__label', 'Wallet');
    section.appendChild(label);

    mobileTrigger = createElement('button', 'wallet-nav__mobile-trigger');
    mobileTrigger.type = 'button';
    mobileTrigger.dataset.walletOpen = 'mobile';
    mobileTrigger.innerHTML = `
        <span class="wallet-nav__mobile-status" aria-hidden="true"></span>
        <span class="wallet-nav__mobile-copy">
            <span class="wallet-nav__mobile-label">Wallet</span>
            <span class="wallet-nav__mobile-meta">Connect on Ethereum</span>
        </span>
    `;
    mobileTrigger.addEventListener('click', () => {
        document.getElementById('mobileNavClose')?.click();
        window.setTimeout(() => actionsRef?.openPanel?.(), 40);
    });

    section.appendChild(mobileTrigger);
    mobileAuth.parentNode.insertBefore(section, mobileAuth.nextSibling);

    return mobileTrigger;
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
    const desc = createElement('p', 'wallet-modal__desc', 'Connect an Ethereum wallet to view account details on BITBI.');
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
    trigger.classList.toggle('is-busy', state.status === 'connecting');
    trigger.setAttribute('aria-expanded', String(!!state.isOpen));

    if (statusDot) {
        statusDot.classList.toggle('is-connected', isConnected);
        statusDot.classList.toggle('is-warning', isWrongNetwork);
        statusDot.classList.toggle('is-busy', state.status === 'connecting');
    }

    if (label) {
        label.textContent = isConnected ? (state.active.shortAddress || 'Wallet') : 'Wallet';
    }

    if (meta) {
        if (state.status === 'connecting') {
            meta.textContent = 'Connecting…';
        } else if (isWrongNetwork) {
            meta.textContent = 'Wrong network';
        } else if (isConnected) {
            meta.textContent = state.active.providerName || 'Ethereum Mainnet';
        } else {
            meta.textContent = isMobile ? 'Connect on Ethereum' : 'Connect';
        }
    }
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

function renderDisconnectedState(state) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createSectionTitle(
        'Connect a wallet',
        'Ethereum Mainnet is the only supported network in this first release.',
    ));

    const walletsWrap = createElement('div', 'wallet-modal__stack');
    const injectedTitle = createElement('h4', 'wallet-modal__mini-title', 'Installed browser wallets');
    walletsWrap.appendChild(injectedTitle);

    if (state.injectedWallets.length > 0) {
        state.injectedWallets.forEach((wallet) => {
            const button = createElement('button', 'wallet-modal__option');
            button.type = 'button';
            button.dataset.walletProviderId = wallet.id;
            button.disabled = state.status === 'connecting';
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
    } else {
        const empty = createElement('div', 'wallet-modal__empty');
        empty.append(
            createElement('strong', 'wallet-modal__empty-title', 'No browser wallet detected'),
            createElement('span', 'wallet-modal__empty-copy', 'Install an Ethereum wallet that supports injected browser access to connect here.'),
        );
        walletsWrap.appendChild(empty);
    }

    fragment.appendChild(walletsWrap);

    const externalWrap = createElement('div', 'wallet-modal__stack');
    externalWrap.appendChild(createElement('h4', 'wallet-modal__mini-title', 'External wallet'));

    const walletConnectButton = createElement('button', 'wallet-modal__option');
    walletConnectButton.type = 'button';
    walletConnectButton.dataset.walletConnect = 'true';
    walletConnectButton.disabled = !state.walletConnectConfigured || state.status === 'connecting';
    walletConnectButton.append(
        createProviderVisual('WalletConnect', '', 'sm'),
        (() => {
            const copy = createElement('span', 'wallet-modal__option-copy');
            copy.append(
                createElement('span', 'wallet-modal__option-title', 'WalletConnect'),
                createElement('span', 'wallet-modal__option-meta', state.walletConnectConfigured
                    ? 'Open the QR or mobile deep-link flow'
                    : 'Unavailable until a Reown project ID is configured'),
            );
            return copy;
        })(),
    );
    walletConnectButton.addEventListener('click', () => actionsRef?.connectWalletConnect?.());
    externalWrap.appendChild(walletConnectButton);

    const note = createElement('p', 'wallet-modal__footnote', state.walletConnectConfigured
        ? 'WalletConnect uses the upstream WalletConnect/Reown browser flow for QR and mobile handoff.'
        : 'Set `walletConfig.walletConnectProjectId` in `js/shared/wallet/wallet-config.js` to enable WalletConnect.');
    externalWrap.appendChild(note);
    fragment.appendChild(externalWrap);

    return fragment;
}

function renderConnectingState(state) {
    const wrap = createElement('div', 'wallet-modal__connecting');
    const connectorName = state.connectingConnectorId === 'walletconnect'
        ? 'WalletConnect'
        : state.injectedWallets.find(wallet => wallet.id === state.connectingConnectorId)?.name || 'Browser wallet';

    wrap.append(
        createElement('div', 'wallet-modal__spinner'),
        createElement('h3', 'wallet-modal__connecting-title', 'Connecting…'),
        createElement('p', 'wallet-modal__connecting-copy', `Waiting for ${connectorName} to finish the connection request.`),
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

    if (state.status === 'connected' && state.active.address) {
        modalBody.appendChild(renderConnectedState(state));
        return;
    }

    modalBody.appendChild(renderDisconnectedState(state));
}

function render(state) {
    currentState = state;
    ensureDesktopTrigger();
    ensureMobileTrigger();
    ensureModal();

    syncTrigger(desktopTrigger, state, false);
    syncTrigger(mobileTrigger, state, true);
    renderBody(state);
    setModalOpen(!!state.isOpen);
}

export function initWalletUI(actions) {
    if (initialized) return;
    initialized = true;
    actionsRef = actions;

    ensureStyles();
    ensureDesktopTrigger();
    ensureMobileTrigger();
    ensureModal();
    subscribeWalletState(render);
}
