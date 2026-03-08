export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "bitbi-auth",
          message: "Auth worker is live"
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }

    return new Response("Not found", { status: 404 });
  }
};