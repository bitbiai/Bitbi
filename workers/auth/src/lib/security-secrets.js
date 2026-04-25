export const LEGACY_SECURITY_SECRET_FALLBACK_ENV = "ALLOW_LEGACY_SECURITY_SECRET_FALLBACK";

export const AUTH_PURPOSE_SECRET_NAMES = Object.freeze({
  sessionHash: "SESSION_HASH_SECRET",
  paginationSigning: "PAGINATION_SIGNING_SECRET",
  adminMfaEncryption: "ADMIN_MFA_ENCRYPTION_KEY",
  adminMfaProof: "ADMIN_MFA_PROOF_SECRET",
  adminMfaRecoveryHash: "ADMIN_MFA_RECOVERY_HASH_SECRET",
  aiSaveReferenceSigning: "AI_SAVE_REFERENCE_SIGNING_SECRET",
});

export const LEGACY_SESSION_SECRET_NAME = "SESSION_SECRET";
export const AUTH_PURPOSE_SECRET_MIN_LENGTH = 32;
export const LEGACY_SECURITY_SECRET_MIN_LENGTH = 16;

export function normalizeSecretValue(env, name, { minLength = LEGACY_SECURITY_SECRET_MIN_LENGTH } = {}) {
  const value = String(env?.[name] || "").trim();
  return value.length >= minLength ? value : null;
}

export function legacySecuritySecretFallbackEnabled(env) {
  const raw = env?.[LEGACY_SECURITY_SECRET_FALLBACK_ENV];
  if (raw === undefined || raw === null || raw === "") {
    return true;
  }
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

export function requireSecuritySecret(env, name, { minLength = AUTH_PURPOSE_SECRET_MIN_LENGTH } = {}) {
  const value = normalizeSecretValue(env, name, { minLength });
  if (!value) {
    throw new Error(`Required worker secret ${name} is missing or invalid.`);
  }
  return value;
}

function getLegacySessionSecret(env) {
  if (!legacySecuritySecretFallbackEnabled(env)) {
    return null;
  }
  return normalizeSecretValue(env, LEGACY_SESSION_SECRET_NAME, {
    minLength: LEGACY_SECURITY_SECRET_MIN_LENGTH,
  });
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate?.secret || seen.has(candidate.secret)) {
      return false;
    }
    seen.add(candidate.secret);
    return true;
  });
}

export function getSecretCandidates(env, currentName, {
  legacy = true,
  minLength = AUTH_PURPOSE_SECRET_MIN_LENGTH,
} = {}) {
  const current = requireSecuritySecret(env, currentName, { minLength });
  return uniqueCandidates([
    { name: currentName, secret: current, legacy: false },
    ...(legacy ? [{ name: LEGACY_SESSION_SECRET_NAME, secret: getLegacySessionSecret(env), legacy: true }] : []),
  ]);
}

export function getSessionHashSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.sessionHash, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getSessionHashSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.sessionHash);
}

export function getPaginationSigningSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.paginationSigning, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getPaginationSigningSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.paginationSigning);
}

export function getAdminMfaEncryptionSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaEncryption, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getAdminMfaEncryptionSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaEncryption);
}

export function getAdminMfaProofSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaProof, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getAdminMfaProofSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaProof);
}

export function getAdminMfaRecoveryHashSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaRecoveryHash, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getAdminMfaRecoveryHashSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.adminMfaRecoveryHash);
}

export function getAiSaveReferenceSigningSecret(env) {
  return requireSecuritySecret(env, AUTH_PURPOSE_SECRET_NAMES.aiSaveReferenceSigning, {
    minLength: AUTH_PURPOSE_SECRET_MIN_LENGTH,
  });
}

export function getAiSaveReferenceSigningSecretCandidates(env) {
  return getSecretCandidates(env, AUTH_PURPOSE_SECRET_NAMES.aiSaveReferenceSigning);
}
