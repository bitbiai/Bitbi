/* ============================================================
   BITBI — Wallet QR helper
   Lazy-loads a small local QR generator and returns SVG markup.
   ============================================================ */

const QR_BUNDLE_URL = new URL('../../vendor/qrcode-generator-1.4.4.js?v=__ASSET_VERSION__', import.meta.url).toString();

let qrLibraryPromise = null;
let qrId = 0;

function getQrFactory() {
    return typeof globalThis.qrcode === 'function' ? globalThis.qrcode : null;
}

async function loadQrLibrary() {
    if (getQrFactory()) return getQrFactory();

    if (!qrLibraryPromise) {
        qrLibraryPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-wallet-qr-bundle="true"]');
            if (existing) {
                existing.addEventListener('load', () => {
                    const factory = getQrFactory();
                    if (factory) resolve(factory);
                    else reject(new Error('QR bundle loaded without a qrcode factory.'));
                }, { once: true });
                existing.addEventListener('error', () => reject(new Error('QR bundle failed to load.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = QR_BUNDLE_URL;
            script.async = true;
            script.dataset.walletQrBundle = 'true';
            script.addEventListener('load', () => {
                const factory = getQrFactory();
                if (factory) resolve(factory);
                else reject(new Error('QR bundle loaded without a qrcode factory.'));
            }, { once: true });
            script.addEventListener('error', () => reject(new Error('QR bundle failed to load.')), { once: true });
            document.head.appendChild(script);
        }).catch((error) => {
            qrLibraryPromise = null;
            throw error;
        });
    }

    return qrLibraryPromise;
}

export async function renderWalletQrSvg(text, { cellSize = 8, margin = 0, title = '', description = '' } = {}) {
    const payload = typeof text === 'string' ? text.trim() : '';
    if (!payload) {
        throw new Error('QR content is required.');
    }

    const qrcode = await loadQrLibrary();
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();

    qrId += 1;
    return qr.createSvgTag({
        cellSize,
        margin,
        scalable: true,
        title: title ? { id: `walletQrTitle${qrId}`, text: title } : null,
        alt: description ? { id: `walletQrDesc${qrId}`, text: description } : null,
    });
}
