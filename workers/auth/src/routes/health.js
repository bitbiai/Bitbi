import { json } from "../lib/response.js";

export function handleHealth() {
  return json({
    ok: true,
    service: "bitbi-auth",
    message: "Auth worker is live",
  });
}
