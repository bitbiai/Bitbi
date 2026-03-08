function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
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
      return json(
        {
          ok: false,
          message: "Register endpoint scaffolded, not implemented yet",
        },
        { status: 501 }
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