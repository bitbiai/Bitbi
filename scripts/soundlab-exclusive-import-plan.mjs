#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const EXCLUSIVE_TRACKS = [
  {
    slug: "exclusive-track-01",
    title: "Exclusive Track 01",
    audioKey: "audio/sound-lab/exclusive-track-01.mp3",
    posterKey: "sound-lab/thumbs/thumb-bitbi.webp",
  },
  {
    slug: "burning-slow",
    title: "Burning Slow",
    audioKey: "audio/sound-lab/burning-slow.mp3",
    posterKey: "sound-lab/thumbs/thumb-burning.webp",
  },
  {
    slug: "feel-it-all",
    title: "Feel It All",
    audioKey: "audio/sound-lab/feel-it-all.mp3",
    posterKey: "sound-lab/thumbs/thumb-feel.webp",
  },
  {
    slug: "the-ones-who-made-the-light",
    title: "The Ones Who Made the Light",
    audioKey: "audio/sound-lab/the-ones-who-made-the-light.mp3",
    posterKey: "sound-lab/thumbs/thumb-ones.webp",
  },
  {
    slug: "rooms-i'll-never-live-in",
    title: "Rooms I'll Never Live In",
    audioKey: "audio/sound-lab/rooms-i'll-never-live-in.mp3",
    posterKey: "sound-lab/thumbs/thumb-rooms.webp",
  },
];

function usage() {
  return [
    "Usage:",
    "  node scripts/soundlab-exclusive-import-plan.mjs --owner-user-id <uuid> [--sizes-json <path>] [--created-at <iso>]",
    "",
    "sizes-json shape:",
    '  { "exclusive-track-01": 1234567, "burning-slow": 1234567, ... }',
  ].join("\n");
}

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    args[key] = value;
    if (value !== "true") index += 1;
  }
  return args;
}

function quoteSql(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function makeAssetId(slug) {
  return crypto
    .createHash("sha256")
    .update(`bitbi:soundlab-exclusive:${slug}`)
    .digest("hex")
    .slice(0, 32);
}

function readSizes(path) {
  if (!path) return null;
  const raw = fs.readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

const args = readArgs(process.argv.slice(2));
const ownerUserId = String(args["owner-user-id"] || "").trim();
if (!ownerUserId) {
  console.error(usage());
  process.exit(1);
}

const createdAt = args["created-at"] ? new Date(args["created-at"]).toISOString() : new Date().toISOString();
const timestamp = Date.parse(createdAt);
const sizes = readSizes(args["sizes-json"]);
const rows = EXCLUSIVE_TRACKS.map((track, index) => {
  const assetId = makeAssetId(track.slug);
  const audioTargetKey = `users/${ownerUserId}/folders/unsorted/audio/${timestamp + index}-legacy-${track.slug}.mp3`;
  const posterTargetKey = `users/${ownerUserId}/derivatives/v1/${assetId}/poster.webp`;
  return {
    ...track,
    assetId,
    audioTargetKey,
    posterTargetKey,
    fileName: `${track.slug}.mp3`,
    sizeBytes: sizes?.[track.slug],
    metadataJson: {
      source_module: "music",
      imported_from: "legacy_soundlab_exclusive",
      legacy_slug: track.slug,
      legacy_audio_key: track.audioKey,
      legacy_poster_key: track.posterKey,
      imported_at: createdAt,
    },
  };
});

const copyManifest = rows.flatMap((row) => [
  {
    source_bucket: "bitbi-private-media",
    source_key: row.audioKey,
    target_bucket: "bitbi-user-images",
    target_key: row.audioTargetKey,
    content_type: "audio/mpeg",
  },
  {
    source_bucket: "bitbi-private-media",
    source_key: row.posterKey,
    target_bucket: "bitbi-user-images",
    target_key: row.posterTargetKey,
    content_type: "image/webp",
  },
]);

const plan = {
  owner_user_id: ownerUserId,
  created_at: createdAt,
  copy_manifest: copyManifest,
  rows: rows.map((row) => ({
    asset_id: row.assetId,
    title: row.title,
    source_slug: row.slug,
    r2_key: row.audioTargetKey,
    poster_r2_key: row.posterTargetKey,
    size_bytes: row.sizeBytes ?? null,
    visibility: "private",
  })),
};

console.log(JSON.stringify(plan, null, 2));

if (!sizes) {
  console.error("\nNo --sizes-json provided, so executable SQL was not emitted.");
  console.error("Measure live MP3 object sizes first, then rerun with --sizes-json.");
  process.exit(0);
}

console.log("\n-- D1 insert SQL. Apply only after the copy_manifest has completed successfully.");
console.log("BEGIN TRANSACTION;");
for (const row of rows) {
  const sizeBytes = Number(row.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error(`Missing positive size for ${row.slug}`);
  }
  const metadataJson = JSON.stringify(row.metadataJson);
  console.log(
    `INSERT INTO ai_text_assets (id, user_id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes, preview_text, metadata_json, created_at, visibility, published_at, poster_r2_key, poster_width, poster_height) VALUES (` +
      [
        quoteSql(row.assetId),
        quoteSql(ownerUserId),
        "NULL",
        quoteSql(row.audioTargetKey),
        quoteSql(row.title),
        quoteSql(row.fileName),
        quoteSql("music"),
        quoteSql("audio/mpeg"),
        String(sizeBytes),
        quoteSql("Imported legacy Sound Lab exclusive track."),
        quoteSql(metadataJson),
        quoteSql(createdAt),
        quoteSql("private"),
        "NULL",
        quoteSql(row.posterTargetKey),
        "320",
        "320",
      ].join(", ") +
      `);`
  );
}
console.log("COMMIT;");
