import { getAddress, recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";

import { logUserActivity } from "../lib/activity.js";
import { buildExpiredAdminMfaCookies, buildSessionCookie } from "../lib/cookies.js";
import {
  evaluateSharedRateLimit,
  getClientIp,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from "../lib/rate-limit.js";
import { readJsonBody } from "../lib/request.js";
import { json } from "../lib/response.js";
import { createSession, getSessionUser, requireUser } from "../lib/session.js";
import { addMinutesIso, nowIso, randomTokenHex } from "../lib/tokens.js";

const MAINNET_CHAIN_ID = 1;
const SIWE_VERSION = "1";
const SIWE_EXPIRY_MINUTES = 10;
const LOGIN_FAILURE_MESSAGE = "That wallet cannot sign in on BITBI.";
const LINK_FAILURE_MESSAGE = "That wallet cannot be linked to this account.";

async function evaluateSensitivePublicRateLimit(
  env,
  scope,
  key,
  maxRequests,
  windowMs,
  { correlationId = null, component = "wallet-auth", requestInfo = null } = {}
) {
  return evaluateSharedRateLimit(env, scope, key, maxRequests, windowMs, {
    backend: "durable_object",
    failClosedInProduction: true,
    logBlockedEvent: true,
    correlationId,
    component,
    requestInfo,
  });
}

function getWalletSiweContext(env) {
  const fallback = "https://bitbi.ai";
  try {
    const baseUrl = new URL(env.APP_BASE_URL || fallback);
    return {
      uri: baseUrl.origin,
      domain: baseUrl.host,
    };
  } catch {
    const baseUrl = new URL(fallback);
    return {
      uri: baseUrl.origin,
      domain: baseUrl.host,
    };
  }
}

function getIntentStatement(intent) {
  if (intent === "link") {
    return "Link this Ethereum wallet to your BITBI account.";
  }
  if (intent === "login") {
    return "Sign in to BITBI with your linked Ethereum wallet.";
  }
  return "";
}

function isValidIntent(intent) {
  return intent === "link" || intent === "login";
}

function shortenAddress(address) {
  if (typeof address !== "string" || address.length < 10) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function serializeLinkedWallet(row) {
  if (!row) return null;
  return {
    address: row.address_display,
    short_address: shortenAddress(row.address_display),
    chain_id: Number(row.chain_id) || MAINNET_CHAIN_ID,
    linked_at: row.linked_at,
    last_login_at: row.last_login_at || null,
    is_primary: !!row.is_primary,
  };
}

function normalizeWalletAddress(address) {
  const display = getAddress(String(address || "").trim());
  return {
    display,
    normalized: display.toLowerCase(),
  };
}

function isExpired(iso, currentTime = nowIso()) {
  return !iso || iso < currentTime;
}

function formatParsedIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

async function getLinkedWalletByUserId(env, userId) {
  return env.DB.prepare(
    `SELECT id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at
     FROM linked_wallets
     WHERE user_id = ?
     LIMIT 1`
  )
    .bind(userId)
    .first();
}

async function getLinkedWalletByAddress(env, addressNormalized) {
  return env.DB.prepare(
    `SELECT id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at
     FROM linked_wallets
     WHERE address_normalized = ?
     LIMIT 1`
  )
    .bind(addressNormalized)
    .first();
}

async function getChallengeByNonce(env, nonce) {
  return env.DB.prepare(
    `SELECT id, nonce, intent, user_id, address_normalized, domain, uri, chain_id, statement, issued_at, expires_at, used_at, requested_ip, created_at
     FROM siwe_challenges
     WHERE nonce = ?
     LIMIT 1`
  )
    .bind(nonce)
    .first();
}

async function consumeChallenge(env, challengeId, usedAt, addressNormalized) {
  return env.DB.prepare(
    `UPDATE siwe_challenges
     SET used_at = ?, address_normalized = ?
     WHERE id = ? AND used_at IS NULL`
  )
    .bind(usedAt, addressNormalized, challengeId)
    .run();
}

async function parseAndValidateSiwePayload(env, intent, message, signature) {
  const currentTime = nowIso();
  const { domain, uri } = getWalletSiweContext(env);

  if (!isValidIntent(intent)) {
    return { response: json({ ok: false, error: "Invalid wallet intent." }, { status: 400 }) };
  }

  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    return { response: json({ ok: false, error: "Invalid wallet message." }, { status: 400 }) };
  }

  if (typeof signature !== "string" || !signature.trim() || signature.length > 512) {
    return { response: json({ ok: false, error: "Invalid wallet signature." }, { status: 400 }) };
  }

  let parsedMessage;
  try {
    parsedMessage = parseSiweMessage(message.trim());
  } catch {
    return { response: json({ ok: false, error: "Invalid wallet message." }, { status: 400 }) };
  }

  const challenge = await getChallengeByNonce(env, parsedMessage.nonce);
  if (!challenge) {
    return { response: json({ ok: false, error: "This wallet request is no longer valid." }, { status: 400 }) };
  }

  if (challenge.intent !== intent) {
    return { response: json({ ok: false, error: "This wallet request does not match the requested action." }, { status: 400 }) };
  }

  if (challenge.used_at) {
    return { response: json({ ok: false, error: "This wallet request has already been used." }, { status: 409 }) };
  }

  if (isExpired(challenge.expires_at, currentTime)) {
    return { response: json({ ok: false, error: "This wallet request expired. Start again." }, { status: 400 }) };
  }

  if (challenge.domain !== domain || challenge.uri !== uri) {
    return { response: json({ ok: false, error: "Wallet sign-in is not configured correctly for this origin." }, { status: 400 }) };
  }

  if (parsedMessage.domain !== challenge.domain) {
    return { response: json({ ok: false, error: "Wallet message domain mismatch." }, { status: 400 }) };
  }

  if (parsedMessage.uri !== challenge.uri) {
    return { response: json({ ok: false, error: "Wallet message URI mismatch." }, { status: 400 }) };
  }

  if (String(parsedMessage.version || "") !== SIWE_VERSION) {
    return { response: json({ ok: false, error: "Wallet message version mismatch." }, { status: 400 }) };
  }

  if (Number(parsedMessage.chainId) !== MAINNET_CHAIN_ID || Number(challenge.chain_id) !== MAINNET_CHAIN_ID) {
    return { response: json({ ok: false, error: "Switch your wallet to Ethereum Mainnet and try again." }, { status: 400 }) };
  }

  if ((parsedMessage.statement || "") !== challenge.statement) {
    return { response: json({ ok: false, error: "Wallet message statement mismatch." }, { status: 400 }) };
  }

  const issuedAt = formatParsedIso(parsedMessage.issuedAt);
  const expirationTime = formatParsedIso(parsedMessage.expirationTime);
  if (issuedAt !== challenge.issued_at) {
    return { response: json({ ok: false, error: "Wallet message timestamp mismatch." }, { status: 400 }) };
  }

  if (expirationTime !== challenge.expires_at) {
    return { response: json({ ok: false, error: "Wallet message expiration mismatch." }, { status: 400 }) };
  }

  let parsedAddress;
  try {
    parsedAddress = normalizeWalletAddress(parsedMessage.address);
  } catch {
    return { response: json({ ok: false, error: "Invalid wallet address." }, { status: 400 }) };
  }

  let recoveredAddress;
  try {
    recoveredAddress = normalizeWalletAddress(await recoverMessageAddress({ message, signature }));
  } catch {
    return { response: json({ ok: false, error: "Invalid wallet signature." }, { status: 401 }) };
  }

  if (recoveredAddress.normalized !== parsedAddress.normalized) {
    return { response: json({ ok: false, error: "Invalid wallet signature." }, { status: 401 }) };
  }

  if (challenge.address_normalized && challenge.address_normalized !== parsedAddress.normalized) {
    return { response: json({ ok: false, error: "This wallet request is no longer valid." }, { status: 400 }) };
  }

  return {
    challenge,
    parsedAddress,
  };
}

async function getLinkedWalletLoginRow(env, addressNormalized) {
  return env.DB.prepare(
    `SELECT lw.id AS link_id, lw.user_id AS user_id, lw.address_normalized AS address_normalized,
            lw.address_display AS address_display, lw.chain_id AS chain_id, lw.is_primary AS is_primary,
            lw.linked_at AS linked_at, lw.last_login_at AS last_login_at,
            u.email AS email, u.created_at AS created_at, u.status AS status, u.role AS role, u.verification_method AS verification_method
     FROM linked_wallets lw
     INNER JOIN users u ON u.id = lw.user_id
     WHERE lw.address_normalized = ?
     LIMIT 1`
  )
    .bind(addressNormalized)
    .first();
}

export async function handleWalletStatus(ctx) {
  const { request, env } = ctx;
  const session = await getSessionUser(request, env);
  if (!session) {
    return json({
      ok: true,
      authenticated: false,
      linked_wallet: null,
    });
  }

  const linkedWallet = await getLinkedWalletByUserId(env, session.user.id);
  return json({
    ok: true,
    authenticated: true,
    linked_wallet: serializeLinkedWallet(linkedWallet),
  });
}

export async function handleWalletSiweNonce(ctx) {
  const { request, env, correlationId } = ctx;
  const body = await readJsonBody(request);
  if (!body) {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const intent = String(body.intent || "").trim().toLowerCase();
  if (!isValidIntent(intent)) {
    return json({ ok: false, error: "Invalid wallet intent." }, { status: 400 });
  }

  const ip = getClientIp(request);
  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    `wallet-siwe-nonce-${intent}-ip`,
    ip,
    12,
    15 * 60_000,
    { correlationId, component: "wallet-siwe-nonce", requestInfo: ctx }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  let session = null;
  if (intent === "link") {
    session = await requireUser(request, env);
    if (session instanceof Response) return session;
  }

  const { domain, uri } = getWalletSiweContext(env);
  const nonce = randomTokenHex(16);
  const issuedAt = nowIso();
  const expirationTime = addMinutesIso(SIWE_EXPIRY_MINUTES);
  const statement = getIntentStatement(intent);

  await env.DB.prepare(
    `INSERT INTO siwe_challenges (id, nonce, intent, user_id, address_normalized, domain, uri, chain_id, statement, issued_at, expires_at, used_at, requested_ip, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      nonce,
      intent,
      session?.user?.id || null,
      domain,
      uri,
      MAINNET_CHAIN_ID,
      statement,
      issuedAt,
      expirationTime,
      ip,
      issuedAt
    )
    .run();

  return json({
    ok: true,
    challenge: {
      intent,
      domain,
      uri,
      version: SIWE_VERSION,
      chainId: MAINNET_CHAIN_ID,
      nonce,
      issuedAt,
      expirationTime,
      statement,
    },
  });
}

export async function handleWalletSiweVerify(ctx) {
  const { request, env, isSecure, correlationId } = ctx;
  const body = await readJsonBody(request);
  if (!body) {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const intent = String(body.intent || "").trim().toLowerCase();
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const ip = getClientIp(request);

  const ipLimit = await evaluateSensitivePublicRateLimit(
    env,
    `wallet-siwe-verify-${intent || "unknown"}-ip`,
    ip,
    20,
    15 * 60_000,
    { correlationId, component: "wallet-siwe-verify", requestInfo: ctx }
  );
  if (ipLimit.unavailable) return rateLimitUnavailableResponse(correlationId);
  if (ipLimit.limited) return rateLimitResponse();

  const verification = await parseAndValidateSiwePayload(env, intent, message, signature);
  if (verification.response) {
    return verification.response;
  }

  const { challenge, parsedAddress } = verification;
  const consumedAt = nowIso();
  const consumeResult = await consumeChallenge(env, challenge.id, consumedAt, parsedAddress.normalized);
  if (!consumeResult?.meta?.changes) {
    return json({ ok: false, error: "This wallet request has already been used." }, { status: 409 });
  }

  if (intent === "link") {
    const session = await requireUser(request, env);
    if (session instanceof Response) return session;

    if (!challenge.user_id || challenge.user_id !== session.user.id) {
      return json({ ok: false, error: "This wallet request is no longer valid." }, { status: 400 });
    }

    const existingByAddress = await getLinkedWalletByAddress(env, parsedAddress.normalized);
    if (existingByAddress && existingByAddress.user_id !== session.user.id) {
      return json({ ok: false, error: LINK_FAILURE_MESSAGE }, { status: 409 });
    }

    const existingByUser = await getLinkedWalletByUserId(env, session.user.id);
    if (existingByUser && existingByUser.address_normalized !== parsedAddress.normalized) {
      return json({ ok: false, error: "Your BITBI account already has a linked wallet. Unlink it before linking a different wallet." }, { status: 409 });
    }

    if (existingByUser && existingByUser.address_normalized === parsedAddress.normalized) {
      await env.DB.prepare(
        `UPDATE linked_wallets
         SET address_display = ?, chain_id = ?, is_primary = 1, updated_at = ?
         WHERE id = ?`
      )
        .bind(parsedAddress.display, MAINNET_CHAIN_ID, consumedAt, existingByUser.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO linked_wallets (id, user_id, address_normalized, address_display, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          session.user.id,
          parsedAddress.normalized,
          parsedAddress.display,
          MAINNET_CHAIN_ID,
          consumedAt,
          consumedAt,
          consumedAt
        )
        .run();
    }

    const linkedWallet = await getLinkedWalletByUserId(env, session.user.id);
    ctx.execCtx.waitUntil(
      logUserActivity(env, session.user.id, "wallet_link", { address: parsedAddress.display, chain_id: MAINNET_CHAIN_ID }, ip)
        .catch((error) => console.error("activity log failed:", error))
    );

    return json({
      ok: true,
      message: "Wallet linked.",
      linked_wallet: serializeLinkedWallet(linkedWallet),
    });
  }

  const loginRow = await getLinkedWalletLoginRow(env, parsedAddress.normalized);
  if (!loginRow || loginRow.status !== "active") {
    return json({ ok: false, error: LOGIN_FAILURE_MESSAGE }, { status: 401 });
  }

  await env.DB.prepare(
    `UPDATE linked_wallets
     SET last_login_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(consumedAt, consumedAt, loginRow.link_id)
    .run();

  const { sessionToken } = await createSession(env, loginRow.user_id);
  const response = json({
    ok: true,
    message: "Wallet sign-in successful.",
    user: {
      id: loginRow.user_id,
      email: loginRow.email,
      createdAt: loginRow.created_at,
      status: loginRow.status,
      role: loginRow.role,
      verificationMethod: loginRow.verification_method ?? null,
    },
    linked_wallet: serializeLinkedWallet({
      address_display: loginRow.address_display,
      chain_id: loginRow.chain_id,
      is_primary: loginRow.is_primary,
      linked_at: loginRow.linked_at,
      last_login_at: consumedAt,
    }),
  });
  response.headers.append("Set-Cookie", buildSessionCookie(sessionToken, isSecure));
  for (const value of buildExpiredAdminMfaCookies(isSecure)) {
    response.headers.append("Set-Cookie", value);
  }

  ctx.execCtx.waitUntil(
    logUserActivity(env, loginRow.user_id, "wallet_login", { address: parsedAddress.display, chain_id: MAINNET_CHAIN_ID }, ip)
      .catch((error) => console.error("activity log failed:", error))
  );

  return response;
}

export async function handleWalletUnlink(ctx) {
  const { request, env } = ctx;
  const session = await requireUser(request, env);
  if (session instanceof Response) return session;

  const linkedWallet = await getLinkedWalletByUserId(env, session.user.id);
  if (!linkedWallet) {
    return json({
      ok: true,
      message: "No linked wallet to remove.",
      linked_wallet: null,
    });
  }

  await env.DB.prepare("DELETE FROM linked_wallets WHERE user_id = ?")
    .bind(session.user.id)
    .run();

  ctx.execCtx.waitUntil(
    logUserActivity(env, session.user.id, "wallet_unlink", { address: linkedWallet.address_display, chain_id: linkedWallet.chain_id }, getClientIp(request))
      .catch((error) => console.error("activity log failed:", error))
  );

  return json({
    ok: true,
    message: "Wallet unlinked.",
    linked_wallet: null,
  });
}
