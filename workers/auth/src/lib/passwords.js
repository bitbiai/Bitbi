function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let result = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const hashBytes = new Uint8Array(derivedBits);

  return `pbkdf2_sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hashBytes)}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const [algo, iterationsStr, saltB64, expectedHashB64] = String(storedHash).split("$");

    if (algo !== "pbkdf2_sha256") return false;

    const iterations = Number(iterationsStr);
    if (!iterations || !saltB64 || !expectedHashB64) return false;

    const encoder = new TextEncoder();
    const salt = base64ToBytes(saltB64);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    const actualHashB64 = bytesToBase64(new Uint8Array(derivedBits));
    return timingSafeEqual(actualHashB64, expectedHashB64);
  } catch {
    return false;
  }
}
