import { ServiceAuthError } from "../../../../js/shared/service-auth.mjs";

const SERVICE_AUTH_REPLAY_BINDING = "SERVICE_AUTH_REPLAY";

function serviceAuthUnavailable(reason = "nonce_backend_unavailable") {
  return new ServiceAuthError("Service authentication replay protection is unavailable.", {
    status: 503,
    code: "service_auth_unavailable",
    reason,
  });
}

export async function recordServiceAuthNonce(env, { nonce, replayWindowMs }) {
  const namespace = env?.[SERVICE_AUTH_REPLAY_BINDING];
  if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
    throw serviceAuthUnavailable("nonce_backend_missing");
  }

  try {
    const id = namespace.idFromName(`service-auth:${nonce}`);
    const stub = namespace.get(id);
    const response = await stub.fetch("https://service-auth-replay.internal/nonce", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttlMs: replayWindowMs }),
    });
    if (!response?.ok) {
      throw serviceAuthUnavailable("nonce_backend_invalid_response");
    }
    const body = await response.json();
    if (body?.replayed === true) {
      throw new ServiceAuthError("Replayed service authentication nonce.", {
        status: 401,
        code: "service_auth_replay",
        reason: "nonce_reused",
      });
    }
    if (body?.replayed !== false) {
      throw serviceAuthUnavailable("nonce_backend_invalid_response");
    }
    return true;
  } catch (error) {
    if (error instanceof ServiceAuthError) throw error;
    throw serviceAuthUnavailable("nonce_backend_request_failed");
  }
}
