import { readTextBodyLimited } from './request-body.mjs';

const textEncoder = new TextEncoder();

export const SERVICE_AUTH_TIMESTAMP_HEADER = 'x-bitbi-service-timestamp';
export const SERVICE_AUTH_SIGNATURE_HEADER = 'x-bitbi-service-signature';
export const SERVICE_AUTH_NONCE_HEADER = 'x-bitbi-service-nonce';
export const SERVICE_AUTH_VERSION = 'v1';
export const SERVICE_AUTH_REPLAY_WINDOW_MS = 5 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export class ServiceAuthError extends Error {
    constructor(message = 'Invalid service authentication.', { status = 401, code = 'service_auth_invalid', reason = 'invalid' } = {}) {
        super(message);
        this.name = 'ServiceAuthError';
        this.status = status;
        this.code = code;
        this.reason = reason;
    }
}

function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeSecret(secret) {
    const value = String(secret || '').trim();
    if (value.length < 16) {
        throw new ServiceAuthError('Service authentication is unavailable.', {
            status: 503,
            code: 'service_auth_unavailable',
            reason: 'secret_missing_or_short',
        });
    }
    return value;
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(String(value || '')));
    return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret, payload) {
    const key = await crypto.subtle.importKey(
        'raw',
        textEncoder.encode(normalizeSecret(secret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
    return bytesToHex(new Uint8Array(signature));
}

function safeEqual(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let index = 0; index < a.length; index += 1) {
        diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }
    return diff === 0;
}

function canonicalServicePayload({ method, path, timestamp, nonce, bodyHash }) {
    return [
        SERVICE_AUTH_VERSION,
        String(method || '').toUpperCase(),
        String(path || ''),
        String(timestamp || ''),
        String(nonce || ''),
        String(bodyHash || ''),
    ].join('\n');
}

function parseSignature(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.startsWith(`${SERVICE_AUTH_VERSION}=`) ? raw.slice(`${SERVICE_AUTH_VERSION}=`.length) : raw;
}

function createServiceNonce() {
    const cryptoApi = globalThis.crypto;
    return typeof cryptoApi?.randomUUID === 'function'
        ? cryptoApi.randomUUID()
        : bytesToHex(cryptoApi.getRandomValues(new Uint8Array(16)));
}

export async function buildServiceAuthHeaders({ secret, method, path, body = '', timestamp = Date.now(), nonce = null } = {}) {
    const normalizedTimestamp = String(Number(timestamp));
    if (!/^\d{13}$/.test(normalizedTimestamp)) {
        throw new ServiceAuthError('Invalid service authentication timestamp.', {
            reason: 'timestamp_invalid',
        });
    }
    const normalizedNonce = String(nonce || createServiceNonce()).trim();
    if (!NONCE_PATTERN.test(normalizedNonce)) {
        throw new ServiceAuthError('Invalid service authentication nonce.', {
            reason: 'nonce_malformed',
        });
    }
    const bodyHash = await sha256Hex(body);
    const signature = await hmacSha256Hex(secret, canonicalServicePayload({
        method,
        path,
        timestamp: normalizedTimestamp,
        nonce: normalizedNonce,
        bodyHash,
    }));
    return {
        [SERVICE_AUTH_TIMESTAMP_HEADER]: normalizedTimestamp,
        [SERVICE_AUTH_NONCE_HEADER]: normalizedNonce,
        [SERVICE_AUTH_SIGNATURE_HEADER]: `${SERVICE_AUTH_VERSION}=${signature}`,
    };
}

export async function assertValidServiceRequest(
    request,
    {
        secret,
        now = Date.now(),
        replayWindowMs = SERVICE_AUTH_REPLAY_WINDOW_MS,
        recordNonce = null,
        maxBodyBytes = null,
    } = {},
) {
    const timestampHeader = String(request.headers.get(SERVICE_AUTH_TIMESTAMP_HEADER) || '').trim();
    if (!/^\d{13}$/.test(timestampHeader)) {
        throw new ServiceAuthError('Missing service authentication timestamp.', {
            reason: 'timestamp_missing',
        });
    }
    const timestamp = Number(timestampHeader);
    if (Math.abs(Number(now) - timestamp) > replayWindowMs) {
        throw new ServiceAuthError('Expired service authentication timestamp.', {
            reason: 'timestamp_expired',
        });
    }

    const nonce = String(request.headers.get(SERVICE_AUTH_NONCE_HEADER) || '').trim();
    if (!nonce) {
        throw new ServiceAuthError('Missing service authentication nonce.', {
            reason: 'nonce_missing',
        });
    }
    if (!NONCE_PATTERN.test(nonce)) {
        throw new ServiceAuthError('Invalid service authentication nonce.', {
            reason: 'nonce_malformed',
        });
    }

    const providedSignature = parseSignature(request.headers.get(SERVICE_AUTH_SIGNATURE_HEADER));
    if (!/^[a-f0-9]{64}$/i.test(providedSignature)) {
        throw new ServiceAuthError('Missing service authentication signature.', {
            reason: 'signature_missing',
        });
    }

    const url = new URL(request.url);
    const body = Number.isSafeInteger(maxBodyBytes) && maxBodyBytes > 0
        ? await readTextBodyLimited(request.clone(), { maxBytes: maxBodyBytes })
        : await request.clone().text();
    const bodyHash = await sha256Hex(body);
    const expectedSignature = await hmacSha256Hex(secret, canonicalServicePayload({
        method: request.method,
        path: url.pathname,
        timestamp: String(timestamp),
        nonce,
        bodyHash,
    }));

    if (!safeEqual(providedSignature.toLowerCase(), expectedSignature.toLowerCase())) {
        throw new ServiceAuthError('Invalid service authentication signature.', {
            reason: 'signature_invalid',
        });
    }

    if (typeof recordNonce === 'function') {
        await recordNonce({ nonce, timestamp, replayWindowMs });
    }

    return true;
}
