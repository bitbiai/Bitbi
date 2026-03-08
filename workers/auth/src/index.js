function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210000;

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

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (pathname === "/api/health" && method === "GET") {
      return json({
        ok: true,
        service: "bitbi-auth",
        message: "Auth worker is live",
      });
    }

    if (pathname === "/api/me" && method === "GET") {
      return json({
        loggedIn: false,
        user: null,
      });
    }

    if (pathname === "/api/register" && method === "POST") {
      const body = await readJsonBody(request);

      if (!body) {
        return json(
          {
            ok: false,
            error: "Ungültiger JSON-Body.",
          },
          { status: 400 }
        );
      }

      const email = normalizeEmail(body.email);
      const password = String(body.password || "");

      if (!email || !password) {
        return json(
          {
            ok: false,
            error: "E-Mail und Passwort sind erforderlich.",
          },
          { status: 400 }
        );
      }

      if (!isValidEmail(email)) {
        return json(
          {
            ok: false,
            error: "Bitte eine gültige E-Mail-Adresse angeben.",
          },
          { status: 400 }
        );
      }

      if (password.length < 10) {
        return json(
          {
            ok: false,
            error: "Das Passwort muss mindestens 10 Zeichen lang sein.",
          },
          { status: 400 }
        );
      }

      const existingUser = await env.DB.prepare(
        "SELECT id FROM users WHERE email = ? LIMIT 1"
      )
        .bind(email)
        .first();

      if (existingUser) {
        return json(
          {
            ok: false,
            error: "Diese E-Mail ist bereits registriert.",
          },
          { status: 409 }
        );
      }

      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const createdAt = new Date().toISOString();

      await env.DB.prepare(
        `
        INSERT INTO users (id, email, password_hash, created_at, status)
        VALUES (?, ?, ?, ?, 'active')
        `
      )
        .bind(userId, email, passwordHash, createdAt)
        .run();

      return json(
        {
          ok: true,
          message: "Registrierung erfolgreich.",
          user: {
            id: userId,
            email,
            createdAt,
            status: "active",
          },
        },
        { status: 201 }
      );
    }

    if (pathname === "/api/login" && method === "POST") {
      return json(
        {
          ok: false,
          message: "Login endpoint scaffolded, not implemented yet",
        },
        { status: 501 }
      );
    }

    if (pathname === "/api/logout" && method === "POST") {
      return json({
        ok: true,
        message: "Logout endpoint scaffolded",
      });
    }

    return json(
      {
        ok: false,
        error: "Not found",
      },
      { status: 404 }
    );
  },
};