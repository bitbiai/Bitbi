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

test.describe('Wallet navigation', () => {
  test('desktop wallet panel renders degraded disconnected state', async ({ page }) => {
    await page.goto('/');

    const trigger = page.locator('[data-wallet-open="desktop"]');
    await expect(trigger).toBeVisible();

    await trigger.click();

    const modal = page.locator('#walletModal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Connect a wallet');
    await expect(modal).toContainText('No browser wallet detected');
    await expect(page.locator('[data-wallet-connect="true"]')).toBeDisabled();
    await expect(modal).toContainText('Reown project ID');

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

  test('wallet trigger is available on shared subpage headers', async ({ page }) => {
    await page.goto('/legal/privacy.html');
    await expect(page.locator('[data-wallet-open="desktop"]')).toBeVisible();
  });
});

test.describe('Wallet navigation mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('wallet entry works from the mobile menu flow', async ({ page }) => {
    await page.goto('/');

    await page.locator('#mobileMenuBtn').click();
    await expect(page.locator('#mobileNav')).toHaveClass(/open/);

    const walletEntry = page.locator('[data-wallet-open="mobile"]');
    await expect(walletEntry).toBeVisible();
    await walletEntry.click();

    await expect(page.locator('#mobileNav')).not.toHaveClass(/open/);
    await expect(page.locator('#walletModal')).toBeVisible();

    await page.locator('[data-wallet-close="panel"]').click();
    await expect(page.locator('#walletModal')).toBeHidden();
  });
});
