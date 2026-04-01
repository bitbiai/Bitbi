import { json } from "../lib/response.js";
import { requireUser } from "../lib/session.js";
import { VALID_MONSTER_IDS } from "../lib/constants.js";

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

  // GET /api/thumbnails/little-monster-NN (01–15)
  if (pathname.startsWith("/api/thumbnails/little-monster-")) {
    const result = await requireUser(request, env);

    if (result instanceof Response) {
      return result;
    }

    const num = pathname.replace("/api/thumbnails/little-monster-", "");
    if (!VALID_MONSTER_IDS.includes(num)) {
      return json(
        { ok: false, error: "Image not found." },
        { status: 404 }
      );
    }

    const object = await env.PRIVATE_MEDIA.get(`images/Little_Monster/thumbnails/little-monster_${num}.webp`);

    if (!object) {
      return json(
        { ok: false, error: "Image not found." },
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

  // GET /api/images/little-monster-NN (01–15)
  if (pathname.startsWith("/api/images/little-monster-")) {
    const result = await requireUser(request, env);

    if (result instanceof Response) {
      return result;
    }

    const num = pathname.replace("/api/images/little-monster-", "");
    if (!VALID_MONSTER_IDS.includes(num)) {
      return json(
        { ok: false, error: "Image not found." },
        { status: 404 }
      );
    }

    const object = await env.PRIVATE_MEDIA.get(`images/Little_Monster/little-monster_${num}.png`);

    if (!object) {
      return json(
        { ok: false, error: "Image not found." },
        { status: 404 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "image/png");
    if (object.size) {
      headers.set("Content-Length", String(object.size));
    }
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  }

  // GET /api/music/:slug (exclusive tracks)
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

  // GET /api/soundlab-thumbs/:slug (exclusive track thumbnails)
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
