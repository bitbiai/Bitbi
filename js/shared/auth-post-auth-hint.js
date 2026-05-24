import { scrubUnsafeAuthReturnParamsFromCurrentUrl } from './auth-return-context.js?v=__ASSET_VERSION__';

export function renderPostAuthHint({ mount, pageSource, signedIn = false, insert = 'prepend' } = {}) {
    const container = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!container) return null;

    const existing = container.querySelector('[data-auth-post-hint]');
    if (existing) existing.remove();

    scrubUnsafeAuthReturnParamsFromCurrentUrl();
    void pageSource;
    void signedIn;
    void insert;
    return null;
}
