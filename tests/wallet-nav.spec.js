const { test, expect } = require('@playwright/test');

function injectMockInjectedWallet(page) {
  return page.addInitScript(() => {
    const listeners = new Map();
    const state = {
      account: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: '0xaa36a7',
      connected: false,
      balanceHex: '0xde0b6b3a7640000',
    };

    function getHandlers(event) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      return listeners.get(event);
    }

    function emit(event, value) {
      getHandlers(event).forEach((handler) => handler(value));
    }

    const provider = {
      chainId: state.chainId,
      async request({ method, params } = {}) {
        switch (method) {
          case 'eth_requestAccounts':
            state.connected = true;
            return [state.account];
          case 'eth_accounts':
            return state.connected ? [state.account] : [];
          case 'eth_chainId':
            return state.chainId;
          case 'eth_getBalance':
            return state.balanceHex;
          case 'wallet_switchEthereumChain': {
            const target = params?.[0]?.chainId;
            if (target !== '0x1') {
              const error = new Error('Unsupported chain');
              error.code = 4902;
              throw error;
            }
            state.chainId = '0x1';
            provider.chainId = state.chainId;
            emit('chainChanged', state.chainId);
            return null;
          }
          default:
            throw new Error(`Unsupported method: ${method}`);
        }
      },
      on(event, handler) {
        getHandlers(event).add(handler);
      },
      removeListener(event, handler) {
        getHandlers(event).delete(handler);
      },
    };

    const detail = {
      info: {
        uuid: 'mock-browser-wallet',
        name: 'Mock Browser Wallet',
        icon: '',
        rdns: 'com.bitbi.mock',
      },
      provider,
    };

    const announce = () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    };

    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  });
}

function injectPersistentMockInjectedWallet(page) {
  return page.addInitScript(() => {
    const listeners = new Map();
    const storageKey = 'bitbi_mock_wallet_connected';
    const statsKey = 'bitbi_mock_wallet_stats';
    const txKey = 'bitbi_mock_wallet_last_tx';
    const accountReadFailureKey = 'bitbi_mock_wallet_account_failures';
    const state = {
      account: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: '0x1',
      balanceHex: '0x1bc16d674ec80000',
    };

    function readStats() {
      try {
        return JSON.parse(sessionStorage.getItem(statsKey) || '{"requestAccounts":0,"accounts":0}');
      } catch {
        return { requestAccounts: 0, accounts: 0 };
      }
    }

    function writeStats(next) {
      sessionStorage.setItem(statsKey, JSON.stringify(next));
    }

    function readAccountFailure() {
      try {
        return JSON.parse(sessionStorage.getItem(accountReadFailureKey) || '{"count":0,"mode":"throw"}');
      } catch {
        return { count: 0, mode: 'throw' };
      }
    }

    function writeAccountFailure(next) {
      sessionStorage.setItem(accountReadFailureKey, JSON.stringify(next));
    }

    function getHandlers(event) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      return listeners.get(event);
    }

    function emit(event, value) {
      getHandlers(event).forEach((handler) => handler(value));
    }

    const provider = {
      chainId: state.chainId,
      async request({ method, params } = {}) {
        const stats = readStats();
        switch (method) {
          case 'eth_requestAccounts':
            stats.requestAccounts += 1;
            writeStats(stats);
            localStorage.setItem(storageKey, '1');
            return [state.account];
          case 'eth_accounts':
            stats.accounts += 1;
            writeStats(stats);
            {
              const failure = readAccountFailure();
              if ((failure.count || 0) > 0) {
                writeAccountFailure({
                  ...failure,
                  count: Math.max(0, (failure.count || 0) - 1),
                });
                if (failure.mode === 'empty') {
                  return [];
                }
                throw new Error('Temporary eth_accounts failure');
              }
            }
            return localStorage.getItem(storageKey) === '1' ? [state.account] : [];
          case 'eth_chainId':
            return state.chainId;
          case 'eth_getBalance':
            return state.balanceHex;
          case 'eth_gasPrice':
            return '0x59682f00';
          case 'eth_estimateGas':
            return '0x5208';
          case 'personal_sign':
            return '0xmock-signature';
          case 'eth_sendTransaction':
            sessionStorage.setItem(txKey, JSON.stringify(params?.[0] || null));
            return '0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface';
          case 'wallet_switchEthereumChain': {
            const target = params?.[0]?.chainId;
            state.chainId = target || '0x1';
            provider.chainId = state.chainId;
            emit('chainChanged', state.chainId);
            return null;
          }
          default:
            throw new Error(`Unsupported method: ${method}`);
        }
      },
      on(event, handler) {
        getHandlers(event).add(handler);
      },
      removeListener(event, handler) {
        getHandlers(event).delete(handler);
      },
    };

    const detail = {
      info: {
        uuid: 'persistent-mock-wallet',
        name: 'Persistent Mock Wallet',
        icon: '',
        rdns: 'com.bitbi.mock.persistent',
      },
      provider,
    };

    const announce = () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    };

    window.__bitbiMockWalletStats = {
      read: () => JSON.parse(sessionStorage.getItem(statsKey) || '{"requestAccounts":0,"accounts":0}'),
    };
    window.__bitbiMockWalletLastTx = {
      read: () => JSON.parse(sessionStorage.getItem(txKey) || 'null'),
    };
    window.__bitbiMockWalletControl = {
      emitAccountsChanged: (accounts, options = {}) => {
        if (options.updateConnectionState === true) {
          localStorage.setItem(storageKey, Array.isArray(accounts) && accounts.length > 0 ? '1' : '0');
        }
        emit('accountsChanged', accounts);
      },
      emitDisconnect: () => emit('disconnect', { code: 4900, message: 'Mock disconnect event' }),
      failNextAccountReads: (count = 1, mode = 'throw') => {
        writeAccountFailure({ count, mode });
      },
      readPersistedSelection: () => ({
        connectorType: localStorage.getItem('bitbi_wallet_connector_type'),
        connectorId: localStorage.getItem('bitbi_wallet_connector_id'),
        address: localStorage.getItem('bitbi_wallet_address'),
        chainId: localStorage.getItem('bitbi_wallet_chain_id'),
      }),
    };

    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  });
}

function injectMockWalletConnect(page, { persisted = false } = {}) {
  return page.addInitScript(({ persisted }) => {
    const listeners = new Map();
    const statsKey = 'bitbi_mock_walletconnect_stats';
    const account = '0x9999999999999999999999999999999999999999';
    const chainId = '0x1';
    const balanceHex = '0xde0b6b3a7640000';
    const hasPersistedSession = () => (
      persisted
      || localStorage.getItem('bitbi_wallet_connector_type') === 'walletconnect'
      || localStorage.getItem('bitbi_wallet_connector_id') === 'walletconnect'
    );

    function readStats() {
      try {
        return JSON.parse(sessionStorage.getItem(statsKey) || '{"init":0,"enable":0,"disconnect":0,"lastShowQrModal":null,"requests":{}}');
      } catch {
        return { init: 0, enable: 0, disconnect: 0, lastShowQrModal: null, requests: {} };
      }
    }

    function writeStats(next) {
      sessionStorage.setItem(statsKey, JSON.stringify(next));
    }

    function getHandlers(event) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      return listeners.get(event);
    }

    function emit(event, value) {
      getHandlers(event).forEach((handler) => handler(value));
    }

    const provider = {
      chainId,
      accounts: hasPersistedSession() ? [account] : [],
      session: hasPersistedSession()
        ? { peer: { metadata: { name: 'Mock WalletConnect', icons: [] } } }
        : null,
      async enable() {
        const stats = readStats();
        stats.enable += 1;
        writeStats(stats);
        provider.accounts = [account];
        provider.session = { peer: { metadata: { name: 'Mock WalletConnect', icons: [] } } };
        localStorage.setItem('bitbi_wallet_connector_type', 'walletconnect');
        localStorage.setItem('bitbi_wallet_connector_id', 'walletconnect');
        localStorage.setItem('bitbi_wallet_address', account);
        localStorage.setItem('bitbi_wallet_chain_id', '1');
        localStorage.setItem('bitbi_wallet_updated_at', new Date().toISOString());
        return [account];
      },
      async request({ method } = {}) {
        const stats = readStats();
        stats.requests[method] = (stats.requests[method] || 0) + 1;
        writeStats(stats);

        switch (method) {
          case 'eth_accounts':
            return provider.accounts;
          case 'eth_chainId':
            return chainId;
          case 'eth_getBalance':
            return balanceHex;
          default:
            throw new Error(`Unsupported WalletConnect method: ${method}`);
        }
      },
      on(event, handler) {
        getHandlers(event).add(handler);
      },
      removeListener(event, handler) {
        getHandlers(event).delete(handler);
      },
      async disconnect() {
        const stats = readStats();
        stats.disconnect += 1;
        writeStats(stats);
        provider.accounts = [];
        provider.session = null;
        emit('disconnect', {});
      },
    };

    window.__bitbiMockWalletConnectStats = {
      read: () => JSON.parse(sessionStorage.getItem(statsKey) || '{"init":0,"enable":0,"disconnect":0,"lastShowQrModal":null,"requests":{}}'),
    };

    window['@walletconnect/ethereum-provider'] = {
      EthereumProvider: {
        init: async (options = {}) => {
          const stats = readStats();
          stats.init += 1;
          stats.lastShowQrModal = !!options.showQrModal;
          writeStats(stats);
          return provider;
        },
      },
    };

    if (hasPersistedSession()) {
      localStorage.setItem('bitbi_wallet_connector_type', 'walletconnect');
      localStorage.setItem('bitbi_wallet_connector_id', 'walletconnect');
      localStorage.setItem('bitbi_wallet_address', account);
      localStorage.setItem('bitbi_wallet_chain_id', '1');
      localStorage.setItem('bitbi_wallet_updated_at', new Date().toISOString());
    }
  }, { persisted });
}

test.describe('Wallet navigation', () => {
  test('desktop wallet panel renders disconnected state with WalletConnect enabled', async ({ page }) => {
    await page.goto('/');

    const trigger = page.locator('[data-wallet-open="desktop"]');
    await expect(trigger).toBeVisible();

    await trigger.click();

    const modal = page.locator('#walletModal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Connect a wallet');
    await expect(modal).toContainText('No browser wallet detected');
    const walletConnectButton = modal.locator('[data-wallet-connect="true"]').first();
    await expect(walletConnectButton).toBeEnabled();
    await expect(modal).not.toContainText('Reown project ID');

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('mock injected wallet connects, handles wrong network, switches, and disconnects', async ({ page }) => {
    await injectMockInjectedWallet(page);
    await page.goto('/');

    await page.locator('[data-wallet-open="desktop"]').click();

    const providerButton = page.locator('[data-wallet-provider-id="mock-browser-wallet"]');
    await expect(providerButton).toBeVisible();
    await providerButton.click();

    const modal = page.locator('#walletModal');
    await expect(modal).toContainText('Mock Browser Wallet');
    await expect(modal).toContainText('0x1234567890abcdef1234567890abcdef12345678');
    await expect(modal).toContainText('Wrong network');
    await expect(page.locator('[data-wallet-switch="true"]')).toBeVisible();

    await page.locator('[data-wallet-switch="true"]').click();

    await expect(modal).toContainText('Ethereum Mainnet');
    await expect(modal).toContainText('1 ETH');
    await expect(page.locator('[data-wallet-switch="true"]')).toHaveCount(0);

    await page.locator('[data-wallet-disconnect="true"]').click();

    await expect(modal).toContainText('Connect a wallet');
    await expect(page.locator('[data-wallet-provider-id="mock-browser-wallet"]')).toBeVisible();
  });

  test('auth modal exposes Sign in with Ethereum and routes into the wallet panel', async ({ page }) => {
    await page.goto('/');

    await page.locator('.site-nav__cta').click();
    const authModal = page.locator('.auth-modal__overlay');
    await expect(authModal).toBeVisible();
    await expect(page.locator('#authWalletLoginBtn')).toContainText('Sign In with Ethereum');

    await page.locator('#authWalletLoginBtn').click();

    await expect(authModal).not.toHaveClass(/active/);
    await expect(page.locator('#walletModal')).toBeVisible();
    await expect(page.locator('#walletModal')).toContainText('Connect a wallet');
  });

  test('restores a connected injected wallet after reload without a new connect popup', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/');

    await page.locator('[data-wallet-open="desktop"]').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await expect(page.locator('#walletModal')).toContainText('Persistent Mock Wallet');
    await expect(page.locator('#walletModal')).toContainText('2 ETH');

    await page.reload();
    await page.locator('[data-wallet-open="desktop"]').click();

    await expect(page.locator('#walletModal')).toContainText('Persistent Mock Wallet');
    await expect(page.locator('#walletModal')).toContainText('0x1234567890abcdef1234567890abcdef12345678');

    const stats = await page.evaluate(() => window.__bitbiMockWalletStats.read());
    expect(stats.requestAccounts).toBe(1);
    expect(stats.accounts).toBeGreaterThanOrEqual(1);
  });

  test('wallet page navigation preserves the injected wallet connection without a new connect request', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/');

    await page.locator('[data-wallet-open="desktop"]').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await expect(page.locator('#walletModal')).toContainText('Persistent Mock Wallet');
    await page.locator('[data-wallet-close="panel"]').click();

    await page.locator('[data-wallet-page="desktop"]').click();
    await expect(page).toHaveURL(/\/account\/wallet(?:\.html)?$/);
    await expect(page.locator('#walletPageProviderLabel')).toHaveText('Persistent Mock Wallet');
    await expect(page.locator('#walletPageAddressFull')).toHaveText('0x1234567890abcdef1234567890abcdef12345678');

    const stats = await page.evaluate(() => window.__bitbiMockWalletStats.read());
    expect(stats.requestAccounts).toBe(1);
    expect(stats.accounts).toBeGreaterThanOrEqual(1);
  });

  test('restores a connected WalletConnect session after reload without a new enable request on desktop', async ({ page }) => {
    await injectMockWalletConnect(page);
    await page.goto('/');

    await page.locator('[data-wallet-open="desktop"]').click();
    await page.locator('#walletModal [data-wallet-connect="true"]').first().click();
    await expect(page.locator('#walletModal')).toContainText('Mock WalletConnect');
    await expect(page.locator('#walletModal')).toContainText('0x9999999999999999999999999999999999999999');

    await page.reload();
    await page.locator('[data-wallet-open="desktop"]').click();

    await expect(page.locator('#walletModal')).toContainText('Mock WalletConnect');
    await expect(page.locator('#walletModal')).toContainText('0x9999999999999999999999999999999999999999');

    const stats = await page.evaluate(() => window.__bitbiMockWalletConnectStats.read());
    expect(stats.init).toBeGreaterThanOrEqual(2);
    expect(stats.enable).toBe(1);
  });

  test('wallet trigger is available on shared subpage headers', async ({ page }) => {
    await page.goto('/legal/privacy.html');
    await expect(page.locator('[data-wallet-open="desktop"]')).toBeVisible();
    await expect(page.locator('[data-wallet-page="desktop"]')).toBeVisible();
  });

  test('desktop wallet header link opens the dedicated wallet page', async ({ page }) => {
    await page.goto('/');

    const walletPageLink = page.locator('[data-wallet-page="desktop"]');
    const walletPanelButton = page.locator('[data-wallet-open="desktop"]');
    await expect(walletPageLink).toBeVisible();
    await expect(walletPanelButton).toBeVisible();

    const walletPageBox = await walletPageLink.boundingBox();
    const walletPanelBox = await walletPanelButton.boundingBox();
    expect(walletPageBox).toBeTruthy();
    expect(walletPanelBox).toBeTruthy();
    expect(Math.abs(walletPageBox.y - walletPanelBox.y)).toBeLessThan(8);
    expect(walletPanelBox.x).toBeGreaterThan(walletPageBox.x);

    await walletPageLink.click();
    await expect(page).toHaveURL(/\/account\/wallet(?:\.html)?$/);
    await expect(page.locator('h1')).toContainText('Wallet');
  });
});

test.describe('Wallet navigation mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('wallet entry works from the mobile menu flow', async ({ page }) => {
    await page.goto('/');

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    const walletSection = page.locator('.mobile-nav__section--wallet');
    await expect(walletSection).toBeVisible();
    await expect(walletSection).not.toContainText('Connect, switch, or disconnect');
    await expect(walletSection.locator('[data-wallet-row="mobile"]')).toBeVisible();

    const walletPageBox = await walletSection.locator('[data-wallet-page="mobile"]').boundingBox();
    const walletPanelBox = await walletSection.locator('[data-wallet-open="mobile"]').boundingBox();
    expect(walletPageBox).toBeTruthy();
    expect(walletPanelBox).toBeTruthy();
    expect(Math.abs(walletPageBox.y - walletPanelBox.y)).toBeLessThan(10);
    expect(walletPanelBox.x).toBeGreaterThan(walletPageBox.x);

    const walletEntry = walletSection.locator('[data-wallet-open="mobile"]');
    await expect(walletEntry).toBeVisible();
    await walletEntry.click();

    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(page.locator('#walletModal')).toBeVisible();

    const scrollState = await page.locator('#walletModal').evaluate((modal) => {
      const panel = modal.querySelector('[data-wallet-scroll="panel"]');
      const body = modal.querySelector('[data-wallet-body="true"]');
      const panelStyle = panel ? window.getComputedStyle(panel) : null;
      const bodyStyle = body ? window.getComputedStyle(body) : null;
      return {
        panelOverflowY: panelStyle?.overflowY || '',
        bodyOverflowY: bodyStyle?.overflowY || '',
      };
    });
    expect(['auto', 'scroll']).toContain(scrollState.panelOverflowY);
    expect(['visible', 'clip']).toContain(scrollState.bodyOverflowY);

    await page.locator('[data-wallet-close="panel"]').click();
    await expect(page.locator('#walletModal')).toBeHidden();
  });

  test('mobile wallet link opens the wallet page from the real menu flow', async ({ page }) => {
    await page.goto('/');

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    const walletSection = page.locator('.mobile-nav__section--wallet');
    const walletPageLink = walletSection.locator('[data-wallet-page="mobile"]');
    await expect(walletPageLink).toBeVisible();
    await walletPageLink.click();

    await expect(page).toHaveURL(/\/account\/wallet(?:\.html)?$/);
    await expect(page.locator('h1')).toContainText('Wallet');
  });

  test('mobile wallet page load and reload do not passively initialize WalletConnect', async ({ page }) => {
    await injectMockWalletConnect(page, { persisted: true });
    await page.goto('/account/wallet.html');
    await page.waitForTimeout(700);

    let stats = await page.evaluate(() => window.__bitbiMockWalletConnectStats.read());
    expect(stats.init).toBe(0);
    expect(stats.enable).toBe(0);
    await expect(page.locator('#walletPageEmpty')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_connector_type'))).toBe('walletconnect');
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_address'))).toBe('0x9999999999999999999999999999999999999999');

    await page.reload();
    await page.waitForTimeout(700);

    stats = await page.evaluate(() => window.__bitbiMockWalletConnectStats.read());
    expect(stats.init).toBe(0);
    expect(stats.enable).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_connector_type'))).toBe('walletconnect');
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_address'))).toBe('0x9999999999999999999999999999999999999999');
  });

  test('mobile WalletConnect handoff only starts from an explicit wallet action', async ({ page }) => {
    await injectMockWalletConnect(page);
    await page.goto('/');

    await page.locator('#mobileMenuBtn').click();
    await page.locator('.mobile-nav__section--wallet [data-wallet-open="mobile"]').click();

    const modal = page.locator('#walletModal');
    const walletConnectButton = modal.locator('[data-wallet-connect="true"]').first();
    await expect(walletConnectButton).toBeEnabled();
    await walletConnectButton.click();

    await expect(modal).toContainText('Mock WalletConnect');
    await expect(modal).toContainText('0x9999999999999999999999999999999999999999');
    await expect(modal.locator('[data-wallet-disconnect="true"]')).toBeVisible();

    const stats = await page.evaluate(() => window.__bitbiMockWalletConnectStats.read());
    expect(stats.init).toBe(1);
    expect(stats.enable).toBe(1);
    expect(stats.lastShowQrModal).toBe(true);
  });

  test('connected wallet state keeps Wallet and shows the address beneath it in the mobile menu', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/');

    await page.locator('#mobileMenuBtn').click();
    await page.locator('.mobile-nav__section--wallet [data-wallet-open="mobile"]').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await page.locator('[data-wallet-close="panel"]').click();

    await page.locator('#mobileMenuBtn').click();

    const walletLink = page.locator('.mobile-nav__section--wallet [data-wallet-page="mobile"]');
    await expect(walletLink.locator('.wallet-nav__mobile-label')).toHaveText('Wallet');
    await expect(walletLink.locator('.wallet-nav__mobile-meta')).toHaveText('0x1234...5678');
    await expect(walletLink.locator('.wallet-nav__mobile-meta')).toHaveClass(/is-connected-address/);
  });
});

test.describe('Wallet page', () => {
  test('disconnected wallet page renders a connect-first state and reuses the wallet modal flow', async ({ page }) => {
    await page.goto('/account/wallet.html');

    await expect(page.locator('#walletSectionNav')).toBeVisible();
    await expect(page.locator('#walletSectionNav [data-wallet-tab-button]')).toHaveText([
      'Overview',
      'Send',
      'Receive',
      'Bitbi Account',
    ]);
    await expect(page.locator('#walletOverviewTab')).toHaveClass(/active/);
    await expect(page.locator('#walletPageEmpty')).toBeVisible();
    await expect(page.locator('#walletPageEmpty')).toContainText('Connect a wallet');
    await expect(page.locator('#walletPageDashboard')).toBeHidden();

    await page.locator('#walletSendTab').click();
    await expect(page.locator('#walletSendTab')).toHaveClass(/active/);
    await expect(page.locator('#walletPageEmpty')).toBeHidden();
    await expect(page.locator('#walletPageDashboard')).toBeVisible();
    await expect(page.locator('#wallet-send')).toBeVisible();
    await expect(page.locator('#wallet-overview')).toBeHidden();
    await expect(page.locator('#wallet-receive')).toBeHidden();
    await expect(page.locator('#wallet-account')).toBeHidden();

    await page.locator('#walletOverviewTab').click();
    await expect(page.locator('#walletOverviewTab')).toHaveClass(/active/);
    await expect(page.locator('#walletPageEmpty')).toBeVisible();
    await expect(page.locator('#walletPageDashboard')).toBeHidden();

    await page.locator('#walletPageConnectBtn').click();
    await expect(page.locator('#walletModal')).toBeVisible();
    await expect(page.locator('#walletModal')).toContainText('Connect a wallet');
  });

  test('connected wallet page renders details, receive QR, and validates the native send flow', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/account/wallet.html');

    await page.locator('#walletPageConnectBtn').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await page.locator('[data-wallet-close="panel"]').click();
    await expect(page.locator('#walletModal')).toBeHidden();

    await expect(page.locator('#walletSectionNav')).toBeVisible();
    await expect(page.locator('#walletSectionNav [data-wallet-tab-button]')).toHaveText([
      'Overview',
      'Send',
      'Receive',
      'Bitbi Account',
    ]);
    await expect(page.locator('#walletPageDashboard')).toBeVisible();
    await expect(page.locator('#walletOverviewTab')).toHaveClass(/active/);
    await expect(page.locator('#wallet-overview')).toBeVisible();
    await expect(page.locator('#wallet-send')).toBeHidden();
    await expect(page.locator('#wallet-receive')).toBeHidden();
    await expect(page.locator('#wallet-account')).toBeHidden();

    await expect(page.locator('#walletPageProviderLabel')).toHaveText('Persistent Mock Wallet');
    await expect(page.locator('#walletPageAddressFull')).toHaveText('0x1234567890abcdef1234567890abcdef12345678');
    await expect(page.locator('#walletPageBalanceValue')).toContainText('2 ETH');

    await page.locator('#walletSendTab').click();
    await expect(page.locator('#walletSendTab')).toHaveClass(/active/);
    await expect(page.locator('#wallet-overview')).toBeHidden();
    await expect(page.locator('#wallet-send')).toBeVisible();
    await expect(page.locator('#wallet-receive')).toBeHidden();
    await expect(page.locator('#wallet-account')).toBeHidden();

    await page.locator('#walletSendRecipient').fill('abc');
    await page.locator('#walletSendAmount').fill('0');
    await page.locator('#walletSendSubmit').click();
    await expect(page.locator('#walletSendMsg')).toContainText('Enter a valid Ethereum address.');

    await page.locator('#walletSendRecipient').fill('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    await page.locator('#walletSendAmount').fill('0');
    await page.locator('#walletSendSubmit').click();
    await expect(page.locator('#walletSendMsg')).toContainText('Enter an amount greater than 0.');

    await page.locator('#walletSendAmount').fill('0.25');
    await page.locator('#walletSendSubmit').click();
    await expect(page.locator('#walletSendMsg')).toContainText('Transaction submitted: 0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface');
    await expect(page.locator('#walletSendMsg')).toContainText('View transaction');

    await page.locator('#walletReceiveTab').click();
    await expect(page.locator('#walletReceiveTab')).toHaveClass(/active/);
    await expect(page.locator('#wallet-overview')).toBeHidden();
    await expect(page.locator('#wallet-send')).toBeHidden();
    await expect(page.locator('#wallet-receive')).toBeVisible();
    await expect(page.locator('#wallet-account')).toBeHidden();
    await expect(page.locator('#walletPageQrFrame')).toHaveAttribute('data-wallet-receive-qr', 'ready');

    await page.locator('#walletAccountTab').click();
    await expect(page.locator('#walletAccountTab')).toHaveClass(/active/);
    await expect(page.locator('#wallet-overview')).toBeHidden();
    await expect(page.locator('#wallet-send')).toBeHidden();
    await expect(page.locator('#wallet-receive')).toBeHidden();
    await expect(page.locator('#wallet-account')).toBeVisible();

    const lastTx = await page.evaluate(() => window.__bitbiMockWalletLastTx.read());
    expect(lastTx).toEqual({
      from: '0x1234567890abcdef1234567890abcdef12345678',
      to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '0x3782dace9d90000',
    });
  });

  test('mobile send success stays within the viewport after returning to the wallet page state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/account/wallet.html');

    await page.locator('#walletPageConnectBtn').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await page.locator('[data-wallet-close="panel"]').click();

    await page.locator('#walletSendTab').click();
    await page.locator('#walletSendRecipient').fill('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    await page.locator('#walletSendAmount').fill('0.25');
    await page.locator('#walletSendSubmit').click();

    await expect(page.locator('#walletSendMsg')).toContainText('Transaction submitted:');
    await expect(page.locator('#walletSendMsg .wallet-page__msg-hash')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const sendPanel = document.getElementById('wallet-send');
      const sendMsg = document.getElementById('walletSendMsg');
      return {
        pageOverflow: root.scrollWidth - root.clientWidth,
        panelOverflow: sendPanel ? sendPanel.scrollWidth - sendPanel.clientWidth : 0,
        messageOverflow: sendMsg ? sendMsg.scrollWidth - sendMsg.clientWidth : 0,
      };
    });

    expect(overflow.pageOverflow).toBeLessThanOrEqual(2);
    expect(overflow.panelOverflow).toBeLessThanOrEqual(2);
    expect(overflow.messageOverflow).toBeLessThanOrEqual(2);
  });

  test('transient empty-account and refresh failures do not disconnect the connected wallet', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);
    await page.goto('/account/wallet.html');

    await page.locator('#walletPageConnectBtn').click();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await page.locator('[data-wallet-close="panel"]').click();

    await expect(page.locator('#walletPageProviderLabel')).toHaveText('Persistent Mock Wallet');
    await page.evaluate(() => {
      window.__bitbiMockWalletControl.emitAccountsChanged([], { updateConnectionState: false });
    });
    await page.waitForTimeout(2300);

    await expect(page.locator('#walletPageProviderLabel')).toHaveText('Persistent Mock Wallet');
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_connector_type'))).toBe('injected');
    expect(await page.evaluate(() => localStorage.getItem('bitbi_wallet_address'))).toBe('0x1234567890abcdef1234567890abcdef12345678');

    await page.evaluate(() => {
      window.__bitbiMockWalletControl.failNextAccountReads(1, 'throw');
    });
    await page.locator('#walletPageRefreshBtn').click();

    await expect(page.locator('#walletPageBanner')).toContainText('The connected wallet could not be refreshed right now.');
    await expect(page.locator('#walletPageProviderLabel')).toHaveText('Persistent Mock Wallet');
    await expect(page.locator('#walletPageAddressFull')).toHaveText('0x1234567890abcdef1234567890abcdef12345678');
  });
});

test.describe('Wallet identity profile flow', () => {
  test('profile wallet section links and unlinks a connected wallet', async ({ page }) => {
    await injectPersistentMockInjectedWallet(page);

    let linkedWallet = null;
    await page.route('**/api/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          loggedIn: true,
          user: {
            id: 'profile-wallet-user',
            email: 'wallet@example.com',
            createdAt: '2026-04-01T00:00:00.000Z',
            status: 'active',
            role: 'member',
            verificationMethod: 'email_verified',
            display_name: 'Wallet Tester',
            has_avatar: false,
            avatar_url: null,
          },
        }),
      });
    });
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            profile: {
              display_name: 'Wallet Tester',
              bio: '',
              website: '',
              youtube_url: '',
            },
            account: {
              email: 'wallet@example.com',
              role: 'member',
              created_at: '2026-04-01T00:00:00.000Z',
              email_verified: true,
              verification_method: 'email_verified',
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route('**/api/favorites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, favorites: [] }),
      });
    });
    await page.route('**/api/wallet/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          authenticated: true,
          linked_wallet: linkedWallet,
        }),
      });
    });
    await page.route('**/api/wallet/siwe/nonce', async (route) => {
      const request = route.request();
      const body = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          challenge: {
            intent: body.intent,
            domain: 'bitbi.ai',
            uri: 'https://bitbi.ai',
            version: '1',
            chainId: 1,
            nonce: 'mocknonce12345678',
            issuedAt: '2026-04-14T10:00:00.000Z',
            expirationTime: '2026-04-14T10:10:00.000Z',
            statement: body.intent === 'link'
              ? 'Link this Ethereum wallet to your BITBI account.'
              : 'Sign in to BITBI with your linked Ethereum wallet.',
          },
        }),
      });
    });
    await page.route('**/api/wallet/siwe/verify', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      linkedWallet = {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        short_address: '0x1234...5678',
        chain_id: 1,
        linked_at: '2026-04-14T10:00:00.000Z',
        last_login_at: body.intent === 'login' ? '2026-04-14T10:01:00.000Z' : null,
        is_primary: true,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          linked_wallet: linkedWallet,
        }),
      });
    });
    await page.route('**/api/wallet/unlink', async (route) => {
      linkedWallet = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          linked_wallet: null,
        }),
      });
    });

    await page.goto('/account/profile.html');
    const acceptCookies = page.locator('#ckAcceptAll');
    if (await acceptCookies.count()) {
      await acceptCookies.click();
    }

    await expect(page.locator('#walletSectionCard')).toBeVisible();
    await expect(page.locator('#walletSectionCard')).toContainText('No wallet linked');

    await page.locator('#walletSectionActions .profile__wallet-btn').first().click();
    await expect(page.locator('#walletModal')).toBeVisible();
    await page.locator('[data-wallet-provider-id="persistent-mock-wallet"]').click();
    await expect(page.locator('#walletModal')).toContainText('Persistent Mock Wallet');

    await page.locator('[data-wallet-link="true"]').click();
    await expect(page.locator('#walletModal')).toContainText('already linked to your BITBI account');
    await expect(page.locator('#walletSectionCard')).toContainText('Linked and connected');
    await expect(page.locator('#walletSectionCard')).toContainText('0x1234567890abcdef1234567890abcdef12345678');
    await page.locator('[data-wallet-close="panel"]').click();

    await page.locator('#walletSectionActions [class*="--danger"]').click();
    await expect(page.locator('#walletSectionCard')).toContainText('Connected, not linked');
  });
});
