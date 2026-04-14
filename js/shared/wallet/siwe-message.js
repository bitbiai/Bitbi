/* ============================================================
   BITBI — SIWE message builder
   Shared EIP-4361 message formatting for the static frontend.
   ============================================================ */

export function buildSiweMessage(fields = {}) {
    const domain = String(fields.domain || '').trim();
    const address = String(fields.address || '').trim();
    const statement = String(fields.statement || '').trim();
    const uri = String(fields.uri || '').trim();
    const version = String(fields.version || '1').trim() || '1';
    const chainId = Number(fields.chainId);
    const nonce = String(fields.nonce || '').trim();
    const issuedAt = String(fields.issuedAt || '').trim();
    const expirationTime = String(fields.expirationTime || '').trim();

    if (!domain || !address || !uri || !nonce || !issuedAt || !Number.isFinite(chainId)) {
        throw new Error('Incomplete SIWE message fields.');
    }

    const lines = [
        `${domain} wants you to sign in with your Ethereum account:`,
        address,
        '',
    ];

    if (statement) {
        lines.push(statement, '');
    }

    lines.push(
        `URI: ${uri}`,
        `Version: ${version}`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
    );

    if (expirationTime) {
        lines.push(`Expiration Time: ${expirationTime}`);
    }

    return lines.join('\n');
}

export function utf8ToHex(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
