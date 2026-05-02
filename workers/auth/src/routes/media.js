import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";

const VALID_MUSIC_SLUGS = [
  "exclusive-track-01",
  "burning-slow",
  "feel-it-all",
  "the-ones-who-made-the-light",
  "rooms-i'll-never-live-in",
];

const VALID_SOUNDLAB_THUMBS = [
  "thumb-bitbi",
  "thumb-burning",
  "thumb-feel",
  "thumb-ones",
  "thumb-rooms",
];

export async function handleMedia(ctx) {
  const { request, env, pathname } = ctx;

  // GET /api/music/:slug (legacy Sound Lab Exclusive import-source tracks)
  if (pathname.startsWith("/api/music/")) {
    const slug = pathname.replace("/api/music/", "");
    if (!VALID_MUSIC_SLUGS.includes(slug)) {
      return json(
        { ok: false, error: "Track not found." },
        { status: 404 }
      );
    }

    const result = await requireUser(request, env);

    if (result instanceof Response) {
      return result;
    }

    const object = await env.PRIVATE_MEDIA.get(`audio/sound-lab/${slug}.mp3`);

    if (!object) {
      return json(
        { ok: false, error: "Track not found." },
        { status: 404 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "audio/mpeg");
    if (object.size) {
      headers.set("Content-Length", String(object.size));
    }
    headers.set("Cache-Control", "private, no-store");
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  }

  // GET /api/soundlab-thumbs/:slug (legacy Sound Lab Exclusive import-source thumbnails)
  if (pathname.startsWith("/api/soundlab-thumbs/")) {
    const slug = pathname.replace("/api/soundlab-thumbs/", "");
    if (!VALID_SOUNDLAB_THUMBS.includes(slug)) {
      return json(
        { ok: false, error: "Thumbnail not found." },
        { status: 404 }
      );
    }

    const result = await requireUser(request, env);

    if (result instanceof Response) {
      return result;
    }

    const object = await env.PRIVATE_MEDIA.get(`sound-lab/thumbs/${slug}.webp`);

    if (!object) {
      return json(
        { ok: false, error: "Thumbnail not found." },
        { status: 404 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/webp");
    if (object.size) {
      headers.set("Content-Length", String(object.size));
    }
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  }

  return null;
}
