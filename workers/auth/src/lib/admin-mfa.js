import {
  buildAdminMfaCookie,
  buildExpiredAdminMfaCookies,
  getAdminMfaTokenFromCookies,
  parseCookies,
} from "./cookies.js";
import { addMinutesIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { json } from "./response.js";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
  withCorrelationId,
} from "../../../../js/shared/worker-observability.mjs";
import {
  getAdminMfaEncryptionSecret,
  getAdminMfaEncryptionSecretCandidates,
  getAdminMfaProofSecret,
  getAdminMfaProofSecretCandidates,
  getAdminMfaRecoveryHashSecret,
  getAdminMfaRecoveryHashSecretCandidates,
} from "./security-secrets.js";

export const ADMIN_MFA_ISSUER = "BITBI";
export const ADMIN_MFA_PERIOD_SECONDS = 30;
export const ADMIN_MFA_DIGITS = 6;
export const ADMIN_MFA_TOTP_WINDOW_STEPS = 1;
export const ADMIN_MFA_PROOF_TTL_MINUTES = 12 * 60;
export const ADMIN_MFA_PROOF_TTL_SECONDS = ADMIN_MFA_PROOF_TTL_MINUTES * 60;
export const ADMIN_MFA_PROOF_MAX_CLOCK_SKEW_MS = 60_000;
export const ADMIN_MFA_RECOVERY_CODE_COUNT = 10;
export const ADMIN_MFA_REQUIRED_CODE = "admin_mfa_required";
export const ADMIN_MFA_ENROLLMENT_REQUIRED_CODE = "admin_mfa_enrollment_required";
export const ADMIN_MFA_INVALID_OR_EXPIRED_CODE = "admin_mfa_invalid_or_expired";
export const ADMIN_MFA_FAILED_ATTEMPT_THRESHOLD = 5;
export const ADMIN_MFA_FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_MFA_LOCKOUT_MS = 15 * 60 * 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hmacKeyCache = new Map();
const aesKeyCache = new Map();
const infraReadinessCache = new WeakMap();

export class AdminMfaError extends Error {
  constructor(
    message = "Admin MFA request failed.",
    { status = 400, code = "ADMIN_MFA_ERROR", reason = "invalid_request" } = {}
  ) {
    super(message);
    this.name = "AdminMfaError";
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}

function normalizeRecoveryCodeInput(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatRecoveryCode(value) {
  const normalized = normalizeRecoveryCodeInput(value);
  return normalized.match(/.{1,4}/g)?.join("-") || normalized;
}

function normalizeTotpCode(value) {
  return String(value || "").replace(/\D/g, "");
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder === 1) {
    throw new AdminMfaError("Invalid admin MFA proof.", {
      status: 403,
      code: ADMIN_MFA_INVALID_OR_EXPIRED_CODE,
      reason: "malformed_proof",
    });
  }
  if (remainder === 0) return normalized;
  return normalized + "=".repeat(4 - remainder);
}

function stableStringify(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => [key, value[key]]);
  return JSON.stringify(Object.fromEntries(entries));
}

function deriveCacheKey(secret, label) {
  const normalizedSecret = String(secret || "");
  if (!normalizedSecret) {
    throw new Error("Missing admin MFA security secret.");
  }
  return `${label}:${normalizedSecret}`;
}

async function getHmacKey(secret) {
  const cacheKey = deriveCacheKey(secret, "admin-mfa-proof");
  if (!hmacKeyCache.has(cacheKey)) {
    hmacKeyCache.set(
      cacheKey,
      crypto.subtle.importKey(
        "raw",
        textEncoder.encode(cacheKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      )
    );
  }
  return hmacKeyCache.get(cacheKey);
}

async function getEncryptionKey(secret) {
  const cacheKey = deriveCacheKey(secret, "admin-mfa-secret");
  if (!aesKeyCache.has(cacheKey)) {
    const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(cacheKey));
    aesKeyCache.set(
      cacheKey,
      crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
    );
  }
  return aesKeyCache.get(cacheKey);
}

async function signProofBody(secret, body) {
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(stableStringify(body)));
  return toBase64Url(bytesToBase64(new Uint8Array(signature)));
}

async function encryptSecret(env, plaintext) {
  const key = await getEncryptionKey(getAdminMfaEncryptionSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(String(plaintext || ""))
  );
  return {
    ciphertext: toBase64Url(bytesToBase64(new Uint8Array(ciphertext))),
    iv: toBase64Url(bytesToBase64(iv)),
  };
}

async function decryptSecret(env, ciphertext, iv) {
  if (!ciphertext || !iv) {
    throw new AdminMfaError("Admin MFA secret is unavailable.", {
      status: 503,
      code: "ADMIN_MFA_UNAVAILABLE",
      reason: "missing_secret_material",
    });
  }
  const ivBytes = base64ToBytes(fromBase64Url(iv));
  const ciphertextBytes = base64ToBytes(fromBase64Url(ciphertext));
  for (const candidate of getAdminMfaEncryptionSecretCandidates(env)) {
    const key = await getEncryptionKey(candidate.secret);
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        key,
        ciphertextBytes
      );
      return textDecoder.decode(plaintext);
    } catch {
      // Try the explicit legacy SESSION_SECRET fallback during the compatibility window.
    }
  }
  throw new AdminMfaError("Admin MFA secret is unavailable.", {
    status: 503,
    code: "ADMIN_MFA_UNAVAILABLE",
    reason: "decrypt_failed",
  });
}

function base32AlphabetIndex(char) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return alphabet.indexOf(char);
}

function encodeBase32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(secret) {
  const normalized = String(secret || "")
    .trim()
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/\s+/g, "");
  if (!normalized) {
    throw new AdminMfaError("Invalid admin MFA secret.", {
      status: 400,
      code: "ADMIN_MFA_INVALID_SECRET",
      reason: "empty_secret",
    });
  }
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = base32AlphabetIndex(char);
    if (index === -1) {
      throw new AdminMfaError("Invalid admin MFA secret.", {
        status: 400,
        code: "ADMIN_MFA_INVALID_SECRET",
        reason: "malformed_secret",
      });
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function createHmacSha1(secretBytes, counterBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, counterBytes);
  return new Uint8Array(digest);
}

function createCounterBytes(counter) {
  const bytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export async function generateTotpCode(secret, { timeMs = Date.now(), step = null } = {}) {
  const timestep = step == null
    ? Math.floor(Number(timeMs) / 1000 / ADMIN_MFA_PERIOD_SECONDS)
    : Number(step);
  const secretBytes = decodeBase32(secret);
  const hmac = await createHmacSha1(secretBytes, createCounterBytes(timestep));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  );
  return String(truncated % (10 ** ADMIN_MFA_DIGITS)).padStart(ADMIN_MFA_DIGITS, "0");
}

function createTotpSetupSecret() {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
}

function createRecoveryCodes() {
  return Array.from({ length: ADMIN_MFA_RECOVERY_CODE_COUNT }, () => (
    formatRecoveryCode(randomTokenHex(10).toUpperCase())
  ));
}

async function hashRecoveryCode(env, code) {
  return sha256Hex(`admin-mfa-recovery:${getAdminMfaRecoveryHashSecret(env)}:${normalizeRecoveryCodeInput(code)}`);
}

async function hashRecoveryCodeCandidates(env, code) {
  const normalized = normalizeRecoveryCodeInput(code);
  const candidates = [];
  for (const candidate of getAdminMfaRecoveryHashSecretCandidates(env)) {
    candidates.push({
      ...candidate,
      codeHash: await sha256Hex(`admin-mfa-recovery:${candidate.secret}:${normalized}`),
    });
  }
  return candidates;
}

function getProofExpiryIso() {
  return addMinutesIso(ADMIN_MFA_PROOF_TTL_MINUTES);
}

function formatProofCookiePayload({
  userId,
  sessionId,
  expiresAt,
}) {
  return {
    v: 1,
    t: "admin_mfa_proof",
    uid: String(userId || ""),
    sid: String(sessionId || ""),
    exp: Date.parse(String(expiresAt || "")),
  };
}

export async function encodeAdminMfaProofToken(env, { userId, sessionId, expiresAt = getProofExpiryIso() } = {}) {
  const payload = formatProofCookiePayload({ userId, sessionId, expiresAt });
  if (!payload.uid || !payload.sid || !Number.isFinite(payload.exp)) {
    throw new Error("Invalid admin MFA proof payload.");
  }
  const signed = {
    ...payload,
    sig: await signProofBody(getAdminMfaProofSecret(env), payload),
  };
  return toBase64Url(bytesToBase64(textEncoder.encode(JSON.stringify(signed))));
}

async function decodeAdminMfaProofToken(env, token, { sessionId, userId, now = Date.now() } = {}) {
  if (typeof token !== "string" || !token || token.length > 500) {
    return { valid: false, reason: "missing" };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(textDecoder.decode(base64ToBytes(fromBase64Url(token))));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.t !== "admin_mfa_proof" || parsed.v !== 1) {
    return { valid: false, reason: "malformed" };
  }
  const { sig, ...unsignedBody } = parsed;
  if (typeof sig !== "string" || !sig) {
    return { valid: false, reason: "malformed" };
  }
  let signatureMatched = false;
  for (const candidate of getAdminMfaProofSecretCandidates(env)) {
    const expected = await signProofBody(candidate.secret, unsignedBody);
    if (sig === expected) {
      signatureMatched = true;
      break;
    }
  }
  if (!signatureMatched) {
    return { valid: false, reason: "malformed" };
  }
  if (unsignedBody.uid !== String(userId || "") || unsignedBody.sid !== String(sessionId || "")) {
    return { valid: false, reason: "session_mismatch" };
  }
  if (!Number.isFinite(unsignedBody.exp) || unsignedBody.exp <= Number(now)) {
    return { valid: false, reason: "expired" };
  }
  const maxAllowedExpiry = Number(now) + (ADMIN_MFA_PROOF_TTL_SECONDS * 1000) + ADMIN_MFA_PROOF_MAX_CLOCK_SKEW_MS;
  if (unsignedBody.exp > maxAllowedExpiry) {
    return { valid: false, reason: "expired" };
  }
  return {
    valid: true,
    expiresAt: new Date(unsignedBody.exp).toISOString(),
  };
}

async function readProofCookieState(request, env, session) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const proofToken = getAdminMfaTokenFromCookies(cookies);
  if (!proofToken) {
    return { valid: false, reason: "missing", expiresAt: null };
  }
  const result = await decodeAdminMfaProofToken(env, proofToken, {
    userId: session?.user?.id,
    sessionId: session?.sessionId,
  });
  if (!result.valid) {
    return {
      valid: false,
      reason: result.reason === "missing" ? "missing" : "invalid_or_expired",
      expiresAt: null,
    };
  }
  return {
    valid: true,
    reason: null,
    expiresAt: result.expiresAt,
  };
}

export async function assertAdminMfaInfraReady(env) {
  if (!env?.DB) {
    throw new AdminMfaError("Admin MFA infrastructure is unavailable.", {
      status: 503,
      code: "ADMIN_MFA_UNAVAILABLE",
      reason: "db_binding_missing",
    });
  }
  let readinessPromise = infraReadinessCache.get(env);
  if (!readinessPromise) {
    readinessPromise = (async () => {
      await env.DB.prepare("SELECT 1 FROM admin_mfa_credentials LIMIT 1").first();
      await env.DB.prepare("SELECT 1 FROM admin_mfa_recovery_codes LIMIT 1").first();
      await env.DB.prepare("SELECT 1 FROM admin_mfa_failed_attempts LIMIT 1").first();
      return true;
    })();
    infraReadinessCache.set(env, readinessPromise);
  }
  try {
    await readinessPromise;
  } catch (error) {
    throw new AdminMfaError("Admin MFA infrastructure is unavailable.", {
      status: 503,
      code: "ADMIN_MFA_UNAVAILABLE",
      reason: "schema_unavailable",
    });
  }
}

export async function loadAdminMfaCredential(env, adminUserId) {
  await assertAdminMfaInfraReady(env);
  return env.DB.prepare(
    `SELECT admin_user_id, secret_ciphertext, secret_iv, pending_secret_ciphertext, pending_secret_iv,
            enabled_at, last_accepted_timestep, created_at, updated_at
       FROM admin_mfa_credentials
      WHERE admin_user_id = ?
      LIMIT 1`
  )
    .bind(adminUserId)
    .first();
}

async function countUnusedRecoveryCodes(env, adminUserId) {
  await assertAdminMfaInfraReady(env);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS unused_count
       FROM admin_mfa_recovery_codes
      WHERE admin_user_id = ?
        AND used_at IS NULL`
  )
    .bind(adminUserId)
    .first();
  return Number(row?.unused_count || 0);
}

function credentialIsEnabled(credential) {
  return !!(
    credential?.enabled_at &&
    credential?.secret_ciphertext &&
    credential?.secret_iv
  );
}

function credentialHasPendingSetup(credential) {
  return !!(credential?.pending_secret_ciphertext && credential?.pending_secret_iv);
}

export async function getAdminMfaStatus(env, session, request = null) {
  const credential = await loadAdminMfaCredential(env, session.user.id);
  const proof = credentialIsEnabled(credential)
    ? await readProofCookieState(request || session.request, env, session)
    : { valid: false, reason: "missing", expiresAt: null };
  return {
    enrolled: credentialIsEnabled(credential),
    verified: credentialIsEnabled(credential) ? proof.valid : false,
    setupPending: credentialHasPendingSetup(credential),
    recoveryCodesRemaining: credentialIsEnabled(credential)
      ? await countUnusedRecoveryCodes(env, session.user.id)
      : 0,
    proofExpiresAt: proof.valid ? proof.expiresAt : null,
    proofReason: proof.reason,
    method: "totp",
    credential,
  };
}

export async function getAdminMfaAccessState(request, env, session) {
  const status = await getAdminMfaStatus(env, { ...session, request }, request);
  if (!status.enrolled) {
    return {
      ...status,
      enforcementRequired: true,
      failureCode: ADMIN_MFA_ENROLLMENT_REQUIRED_CODE,
      failureReason: "enrollment_required",
      clearProofCookie: true,
    };
  }
  if (!status.verified) {
    return {
      ...status,
      enforcementRequired: true,
      failureCode: status.proofReason === "invalid_or_expired"
        ? ADMIN_MFA_INVALID_OR_EXPIRED_CODE
        : ADMIN_MFA_REQUIRED_CODE,
      failureReason: status.proofReason === "invalid_or_expired"
        ? "invalid_or_expired"
        : "mfa_required",
      clearProofCookie: status.proofReason === "invalid_or_expired",
    };
  }
  return {
    ...status,
    enforcementRequired: false,
    failureCode: null,
    failureReason: null,
    clearProofCookie: false,
  };
}

function appendAdminMfaClearCookies(headers, isSecure) {
  for (const cookie of buildExpiredAdminMfaCookies(isSecure)) {
    headers.append("Set-Cookie", cookie);
  }
}

export function buildAdminMfaDeniedResponse({
  session,
  mfaState,
  correlationId = null,
  includeUser = false,
  isSecure = false,
}) {
  const message = mfaState.failureCode === ADMIN_MFA_ENROLLMENT_REQUIRED_CODE
    ? "Admin MFA enrollment required."
    : mfaState.failureCode === ADMIN_MFA_INVALID_OR_EXPIRED_CODE
      ? "Admin MFA proof is invalid or expired."
      : "Admin MFA verification required.";

  const headers = new Headers();
  if (mfaState.clearProofCookie) {
    appendAdminMfaClearCookies(headers, isSecure);
  }
  const response = json({
    ok: false,
    error: message,
    code: mfaState.failureCode,
    ...(includeUser ? { user: session?.user || null } : {}),
    mfa: {
      enrolled: !!mfaState.enrolled,
      verified: false,
      setupPending: !!mfaState.setupPending,
      method: "totp",
      recoveryCodesRemaining: Number(mfaState.recoveryCodesRemaining || 0),
    },
  }, {
    status: 403,
    headers,
  });
  return withCorrelationId(response, correlationId);
}

function buildOtpAuthUri(secret, adminEmail) {
  const label = encodeURIComponent(`${ADMIN_MFA_ISSUER}:${adminEmail}`);
  const issuer = encodeURIComponent(ADMIN_MFA_ISSUER);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${ADMIN_MFA_DIGITS}&period=${ADMIN_MFA_PERIOD_SECONDS}`;
}

function buildProofCookieHeaders(env, session, isSecure) {
  const expiresAt = getProofExpiryIso();
  return encodeAdminMfaProofToken(env, {
    userId: session.user.id,
    sessionId: session.sessionId,
    expiresAt,
  }).then((token) => ({
    expiresAt,
    cookies: [buildAdminMfaCookie(token, isSecure, ADMIN_MFA_PROOF_TTL_SECONDS)],
  }));
}

async function replaceRecoveryCodes(env, adminUserId, codes, createdAt) {
  const statements = [
    env.DB.prepare("DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = ?").bind(adminUserId),
  ];
  for (const code of codes) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO admin_mfa_recovery_codes (id, admin_user_id, code_hash, created_at, used_at)
         VALUES (?, ?, ?, ?, NULL)`
      ).bind(crypto.randomUUID(), adminUserId, await hashRecoveryCode(env, code), createdAt)
    );
  }
  await env.DB.batch(statements);
}

export async function createAdminMfaSetup(env, adminUser) {
  const now = nowIso();
  const existing = await loadAdminMfaCredential(env, adminUser.id);
  if (credentialIsEnabled(existing)) {
    throw new AdminMfaError("Admin MFA is already enabled.", {
      status: 409,
      code: "ADMIN_MFA_ALREADY_ENABLED",
      reason: "already_enabled",
    });
  }

  const secret = createTotpSetupSecret();
  const encrypted = await encryptSecret(env, secret);
  const recoveryCodes = createRecoveryCodes();

  if (existing) {
    await env.DB.prepare(
      `UPDATE admin_mfa_credentials
          SET pending_secret_ciphertext = ?, pending_secret_iv = ?, updated_at = ?
        WHERE admin_user_id = ?`
    )
      .bind(encrypted.ciphertext, encrypted.iv, now, adminUser.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO admin_mfa_credentials (
         admin_user_id,
         secret_ciphertext,
         secret_iv,
         pending_secret_ciphertext,
         pending_secret_iv,
         enabled_at,
         last_accepted_timestep,
         created_at,
         updated_at
       ) VALUES (?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`
    )
      .bind(adminUser.id, encrypted.ciphertext, encrypted.iv, now, now)
      .run();
  }

  await replaceRecoveryCodes(env, adminUser.id, recoveryCodes, now);

  return {
    secret,
    otpauthUri: buildOtpAuthUri(secret, adminUser.email),
    recoveryCodes,
    setupPending: true,
  };
}

async function validateTotpAgainstCredential(env, credential, code, { requirePending = false } = {}) {
  const normalizedCode = normalizeTotpCode(code);
  if (normalizedCode.length !== ADMIN_MFA_DIGITS) {
    throw new AdminMfaError("Invalid MFA code.", {
      status: 400,
      code: "ADMIN_MFA_INVALID_CODE",
      reason: "invalid_code_format",
    });
  }
  const secret = await decryptSecret(
    env,
    requirePending ? credential?.pending_secret_ciphertext : credential?.secret_ciphertext,
    requirePending ? credential?.pending_secret_iv : credential?.secret_iv
  );
  const currentStep = Math.floor(Date.now() / 1000 / ADMIN_MFA_PERIOD_SECONDS);
  let matchedStep = null;
  let replayed = false;
  for (let offset = -ADMIN_MFA_TOTP_WINDOW_STEPS; offset <= ADMIN_MFA_TOTP_WINDOW_STEPS; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const candidate = await generateTotpCode(secret, { step });
    if (candidate === normalizedCode) {
      if (!requirePending && Number.isInteger(credential?.last_accepted_timestep) && step <= credential.last_accepted_timestep) {
        replayed = true;
        continue;
      }
      matchedStep = step;
      break;
    }
  }
  if (!Number.isInteger(matchedStep)) {
    throw new AdminMfaError(replayed ? "MFA code has already been used." : "Invalid MFA code.", {
      status: 400,
      code: replayed ? "ADMIN_MFA_CODE_REPLAYED" : "ADMIN_MFA_INVALID_CODE",
      reason: replayed ? "replayed_code" : "invalid_code",
    });
  }
  return { step: matchedStep };
}

async function consumeRecoveryCode(env, adminUserId, recoveryCode) {
  const normalized = normalizeRecoveryCodeInput(recoveryCode);
  if (normalized.length !== 20) {
    throw new AdminMfaError("Invalid recovery code.", {
      status: 400,
      code: "ADMIN_MFA_INVALID_RECOVERY_CODE",
      reason: "invalid_recovery_code_format",
    });
  }
  const expectedHashes = new Set(
    (await hashRecoveryCodeCandidates(env, normalized)).map((candidate) => candidate.codeHash)
  );
  const rows = await env.DB.prepare(
    `SELECT id, code_hash, used_at
       FROM admin_mfa_recovery_codes
      WHERE admin_user_id = ?`
  )
    .bind(adminUserId)
    .all();
  const match = (rows?.results || []).find(
    (row) => expectedHashes.has(row.code_hash) && row.used_at == null
  );
  if (!match) {
    throw new AdminMfaError("Invalid recovery code.", {
      status: 400,
      code: "ADMIN_MFA_INVALID_RECOVERY_CODE",
      reason: "invalid_recovery_code",
    });
  }
  await env.DB.prepare(
    "UPDATE admin_mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL"
  )
    .bind(nowIso(), match.id)
    .run();
  return match.id;
}

async function loadAdminMfaFailedAttemptState(env, adminUserId) {
  await assertAdminMfaInfraReady(env);
  return env.DB.prepare(
    `SELECT admin_user_id, failed_count, first_failed_at, last_failed_at, locked_until, updated_at
       FROM admin_mfa_failed_attempts
      WHERE admin_user_id = ?
      LIMIT 1`
  )
    .bind(adminUserId)
    .first();
}

function isAdminMfaLocked(state, nowMs = Date.now()) {
  return !!(state?.locked_until && Date.parse(state.locked_until) > nowMs);
}

function adminMfaLockedError() {
  return new AdminMfaError("Too many MFA attempts. Please try again later.", {
    status: 429,
    code: "ADMIN_MFA_LOCKED",
    reason: "failed_attempt_lockout",
  });
}

async function assertAdminMfaNotFailedAttemptLocked(env, adminUserId) {
  const state = await loadAdminMfaFailedAttemptState(env, adminUserId);
  if (isAdminMfaLocked(state)) {
    throw adminMfaLockedError();
  }
}

function shouldCountAdminMfaFailure(error) {
  return error instanceof AdminMfaError && new Set([
    "ADMIN_MFA_INVALID_CODE",
    "ADMIN_MFA_CODE_REPLAYED",
    "ADMIN_MFA_INVALID_RECOVERY_CODE",
  ]).has(error.code);
}

async function recordAdminMfaFailedAttempt(env, adminUserId) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const existing = await loadAdminMfaFailedAttemptState(env, adminUserId);
  const existingFirstMs = Date.parse(existing?.first_failed_at || "");
  const withinWindow = Number.isFinite(existingFirstMs)
    && nowMs - existingFirstMs <= ADMIN_MFA_FAILED_ATTEMPT_WINDOW_MS;
  const failedCount = withinWindow ? Number(existing?.failed_count || 0) + 1 : 1;
  const firstFailedAt = withinWindow && existing?.first_failed_at ? existing.first_failed_at : now;
  const lockedUntil = failedCount >= ADMIN_MFA_FAILED_ATTEMPT_THRESHOLD
    ? new Date(nowMs + ADMIN_MFA_LOCKOUT_MS).toISOString()
    : null;

  await env.DB.prepare(
    `INSERT INTO admin_mfa_failed_attempts (
       admin_user_id, failed_count, first_failed_at, last_failed_at, locked_until, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(admin_user_id) DO UPDATE SET
       failed_count = excluded.failed_count,
       first_failed_at = excluded.first_failed_at,
       last_failed_at = excluded.last_failed_at,
       locked_until = excluded.locked_until,
       updated_at = excluded.updated_at`
  )
    .bind(adminUserId, failedCount, firstFailedAt, now, lockedUntil, now)
    .run();
}

async function resetAdminMfaFailedAttemptState(env, adminUserId) {
  await assertAdminMfaInfraReady(env);
  await env.DB.prepare(
    "DELETE FROM admin_mfa_failed_attempts WHERE admin_user_id = ?"
  )
    .bind(adminUserId)
    .run();
}

function validateProofRequestBody(body) {
  const code = normalizeTotpCode(body?.code);
  const recoveryCode = normalizeRecoveryCodeInput(body?.recovery_code);
  if (code && recoveryCode) {
    throw new AdminMfaError("Provide either an MFA code or a recovery code, not both.", {
      status: 400,
      code: "ADMIN_MFA_AMBIGUOUS_PROOF",
      reason: "ambiguous_proof",
    });
  }
  if (!code && !recoveryCode) {
    throw new AdminMfaError("A current MFA code or recovery code is required.", {
      status: 400,
      code: "ADMIN_MFA_PROOF_REQUIRED",
      reason: "missing_proof",
    });
  }
  return { code, recoveryCode };
}

async function verifyAdminMfaProof(env, session, credential, body) {
  await assertAdminMfaNotFailedAttemptLocked(env, session.user.id);
  let verificationMethod = "totp";
  try {
    const { code, recoveryCode } = validateProofRequestBody(body);
    if (recoveryCode) {
      await consumeRecoveryCode(env, session.user.id, recoveryCode);
      verificationMethod = "recovery_code";
    } else {
      const { step } = await validateTotpAgainstCredential(env, credential, code, { requirePending: false });
      await env.DB.prepare(
        "UPDATE admin_mfa_credentials SET last_accepted_timestep = ?, updated_at = ? WHERE admin_user_id = ?"
      )
        .bind(step, nowIso(), session.user.id)
        .run();
    }
  } catch (error) {
    if (shouldCountAdminMfaFailure(error)) {
      await recordAdminMfaFailedAttempt(env, session.user.id);
    }
    throw error;
  }
  await resetAdminMfaFailedAttemptState(env, session.user.id);
  return { verificationMethod };
}

export async function enableAdminMfa(env, session, body, { isSecure = false } = {}) {
  const credential = await loadAdminMfaCredential(env, session.user.id);
  if (!credentialHasPendingSetup(credential)) {
    throw new AdminMfaError("Admin MFA setup is required before enabling MFA.", {
      status: 409,
      code: "ADMIN_MFA_SETUP_REQUIRED",
      reason: "setup_required",
    });
  }
  const { step } = await validateTotpAgainstCredential(env, credential, body?.code, {
    requirePending: true,
  });
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE admin_mfa_credentials
        SET secret_ciphertext = pending_secret_ciphertext,
            secret_iv = pending_secret_iv,
            pending_secret_ciphertext = NULL,
            pending_secret_iv = NULL,
            enabled_at = ?,
            last_accepted_timestep = ?,
            updated_at = ?
      WHERE admin_user_id = ?`
  )
    .bind(now, step, now, session.user.id)
    .run();
  await resetAdminMfaFailedAttemptState(env, session.user.id);
  const proof = await buildProofCookieHeaders(env, session, isSecure);
  return {
    proof,
    status: {
      enrolled: true,
      verified: true,
      setupPending: false,
      recoveryCodesRemaining: await countUnusedRecoveryCodes(env, session.user.id),
      proofExpiresAt: proof.expiresAt,
      method: "totp",
    },
  };
}

export async function verifyAdminMfa(env, session, body, { isSecure = false } = {}) {
  const credential = await loadAdminMfaCredential(env, session.user.id);
  if (!credentialIsEnabled(credential)) {
    throw new AdminMfaError("Admin MFA enrollment is required.", {
      status: 409,
      code: ADMIN_MFA_ENROLLMENT_REQUIRED_CODE,
      reason: "enrollment_required",
    });
  }
  const { verificationMethod } = await verifyAdminMfaProof(env, session, credential, body);
  const proof = await buildProofCookieHeaders(env, session, isSecure);
  return {
    proof,
    verificationMethod,
    status: {
      enrolled: true,
      verified: true,
      setupPending: false,
      recoveryCodesRemaining: await countUnusedRecoveryCodes(env, session.user.id),
      proofExpiresAt: proof.expiresAt,
      method: "totp",
    },
  };
}

export async function disableAdminMfa(env, session, body, { isSecure = false } = {}) {
  const credential = await loadAdminMfaCredential(env, session.user.id);
  if (!credentialIsEnabled(credential)) {
    throw new AdminMfaError("Admin MFA is not enabled.", {
      status: 409,
      code: "ADMIN_MFA_NOT_ENABLED",
      reason: "not_enabled",
    });
  }
  await verifyAdminMfaProof(env, session, credential, body);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = ?").bind(session.user.id),
    env.DB.prepare("DELETE FROM admin_mfa_credentials WHERE admin_user_id = ?").bind(session.user.id),
  ]);
  return {
    clearCookies: buildExpiredAdminMfaCookies(isSecure),
  };
}

export async function regenerateAdminMfaRecoveryCodes(env, session, body, { isSecure = false } = {}) {
  const credential = await loadAdminMfaCredential(env, session.user.id);
  if (!credentialIsEnabled(credential)) {
    throw new AdminMfaError("Admin MFA enrollment is required.", {
      status: 409,
      code: ADMIN_MFA_ENROLLMENT_REQUIRED_CODE,
      reason: "enrollment_required",
    });
  }
  const { verificationMethod } = await verifyAdminMfaProof(env, session, credential, body);
  const recoveryCodes = createRecoveryCodes();
  await replaceRecoveryCodes(env, session.user.id, recoveryCodes, nowIso());
  const proof = await buildProofCookieHeaders(env, session, isSecure);
  return {
    recoveryCodes,
    verificationMethod,
    proof,
    status: {
      enrolled: true,
      verified: true,
      setupPending: false,
      recoveryCodesRemaining: recoveryCodes.length,
      proofExpiresAt: proof.expiresAt,
      method: "totp",
    },
  };
}

export function isAdminMfaBootstrapRoute(pathname) {
  return pathname === "/api/admin/me" || pathname.startsWith("/api/admin/mfa/");
}

export function logAdminMfaDiagnostic({
  request,
  correlationId = null,
  adminUserId = null,
  event,
  level = "info",
  failureReason = null,
  status = null,
  verificationMethod = null,
  setupPending = null,
  recoveryCodesRemaining = null,
  extra = {},
}) {
  return logDiagnostic({
    service: "bitbi-auth",
    component: "admin-mfa",
    event,
    level,
    correlationId,
    admin_user_id: adminUserId,
    failure_reason: failureReason,
    status,
    verification_method: verificationMethod,
    setup_pending: setupPending,
    recovery_codes_remaining: recoveryCodesRemaining,
    ...getRequestLogFields(request),
    ...extra,
  });
}

export function adminMfaErrorResponse(error, correlationId = null) {
  return withCorrelationId(json({
    ok: false,
    error: error.message,
    code: error.code || "ADMIN_MFA_ERROR",
  }, {
    status: error.status || 400,
  }), correlationId);
}

export function appendCookies(response, cookies) {
  if (!(response instanceof Response) || !Array.isArray(cookies) || cookies.length === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildAdminMfaStatusPayload(status) {
  return {
    enrolled: !!status.enrolled,
    verified: !!status.verified,
    setupPending: !!status.setupPending,
    recoveryCodesRemaining: Number(status.recoveryCodesRemaining || 0),
    proofExpiresAt: status.proofExpiresAt || null,
    method: "totp",
  };
}

export function logAdminMfaUnhandledFailure(request, correlationId, adminUserId, error) {
  logAdminMfaDiagnostic({
    request,
    correlationId,
    adminUserId,
    event: "admin_mfa_internal_failure",
    level: "error",
    failureReason: error?.reason || "internal_error",
    status: error?.status || 500,
    extra: getErrorFields(error, { includeMessage: false }),
  });
}
