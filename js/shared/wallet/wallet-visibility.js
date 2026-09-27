// Presentation gate only. It must never mutate wallet/account identity or data.
export function isWalletVisible() {
    return document.documentElement.dataset.walletVisible === 'true';
}
