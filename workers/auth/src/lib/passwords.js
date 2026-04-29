// Cloudflare Workers caps PBKDF2 at 100,000 iterations (runtime limit).
const MAX_ITERATIONS = 100_000;
const DEFAULT_TARGET_ITERATIONS = 100_000;
const MAX_LEGACY_VERIFY_ITERATIONS = 500_000;
const SHA256_BLOCK_SIZE = 64;
const SHA256_DIGEST_SIZE = 32;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function getTargetIterations(env) {
  const envVal = parseInt(env?.PBKDF2_ITERATIONS, 10);
  const target = envVal > 0 ? envVal : DEFAULT_TARGET_ITERATIONS;
  return Math.min(target, MAX_ITERATIONS);
}

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

function rightRotate(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / SHA256_BLOCK_SIZE) * SHA256_BLOCK_SIZE;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high);
  view.setUint32(paddedLength - 4, low);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += SHA256_BLOCK_SIZE) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(SHA256_DIGEST_SIZE);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, h0);
  digestView.setUint32(4, h1);
  digestView.setUint32(8, h2);
  digestView.setUint32(12, h3);
  digestView.setUint32(16, h4);
  digestView.setUint32(20, h5);
  digestView.setUint32(24, h6);
  digestView.setUint32(28, h7);
  return digest;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, array) => sum + array.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    combined.set(array, offset);
    offset += array.length;
  }
  return combined;
}

function hmacSha256(keyBytes, messageBytes) {
  let key = keyBytes;
  if (key.length > SHA256_BLOCK_SIZE) key = sha256(key);

  const innerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  const outerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  for (let i = 0; i < SHA256_BLOCK_SIZE; i++) {
    const value = key[i] || 0;
    innerPad[i] = value ^ 0x36;
    outerPad[i] = value ^ 0x5c;
  }

  return sha256(concatBytes(outerPad, sha256(concatBytes(innerPad, messageBytes))));
}

function pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations) {
  const block = concatBytes(saltBytes, new Uint8Array([0, 0, 0, 1]));
  let u = hmacSha256(passwordBytes, block);
  const output = new Uint8Array(u);

  for (let i = 1; i < iterations; i++) {
    u = hmacSha256(passwordBytes, u);
    for (let j = 0; j < SHA256_DIGEST_SIZE; j++) {
      output[j] ^= u[j];
    }
  }

  return output;
}

async function derivePbkdf2Sha256(passwordBytes, saltBytes, iterations) {
  if (!Number.isSafeInteger(iterations) || iterations <= 0 || iterations > MAX_LEGACY_VERIFY_ITERATIONS) {
    return null;
  }

  if (iterations > MAX_ITERATIONS) {
    // A short-lived historical build produced 310k-iteration hashes. Workers
    // WebCrypto rejects those, so verify them once in JS and rehash on success.
    return pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations);
  }

  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    return new Uint8Array(derivedBits);
  } catch {
    return pbkdf2Sha256Fallback(passwordBytes, saltBytes, iterations);
  }
}

export async function hashPassword(password, env) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = getTargetIterations(env);

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

export async function verifyPassword(password, storedHash, env) {
  try {
    const [algo, iterationsStr, saltB64, expectedHashB64] = String(storedHash).split("$");

    if (algo !== "pbkdf2_sha256") return { valid: false, needsRehash: false };

    const iterations = Number(iterationsStr);
    if (!Number.isSafeInteger(iterations) || iterations <= 0 || !saltB64 || !expectedHashB64) {
      return { valid: false, needsRehash: false };
    }

    const encoder = new TextEncoder();
    const salt = base64ToBytes(saltB64);
    const derivedBytes = await derivePbkdf2Sha256(encoder.encode(password), salt, iterations);
    if (!derivedBytes) return { valid: false, needsRehash: false };
    const actualHashB64 = bytesToBase64(derivedBytes);
    const valid = timingSafeEqual(actualHashB64, expectedHashB64);
    return {
      valid,
      needsRehash: valid && (iterations > MAX_ITERATIONS || iterations < getTargetIterations(env)),
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
