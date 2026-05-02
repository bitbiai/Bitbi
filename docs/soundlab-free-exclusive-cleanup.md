# Sound Lab Free / Exclusive Cleanup Note

This note documents the safe cleanup path for the retired bundled Sound Lab Free catalog and the old Sound Lab Exclusive catalog.
Do not delete R2 objects in this release. Published member music now appears through public Memtracks (`/api/gallery/memtracks`).

## Current Product State

- Sound Lab Explore no longer renders Free or Exclusive category surfaces.
- Published member music is listed directly from `ai_text_assets` rows with `source_module = 'music'` and `visibility = 'public'`.
- Old Exclusive tracks must be imported into one owner account's Saved Assets before any legacy private-media cleanup.
- Old Exclusive imports should be private/unpublished by default, then published manually if they should appear in Memtracks.

## Legacy Free Track References

The old Free tracks were public R2 objects behind `https://pub.bitbi.ai`. The repository does not declare the Cloudflare R2 bucket name for that custom domain; verify the `pub.bitbi.ai` custom-domain bucket in Cloudflare before deletion.

Live D1/favorites verification before deleting Free objects:

```sql
SELECT item_type, item_id, thumb_url, COUNT(*) AS count
FROM favorites
WHERE (item_type = 'soundlab' AND item_id IN (
  'cosmic-sea',
  'zufall-und-notwendigkeit',
  'relativity',
  'tiny-hearts',
  'grok'
))
   OR thumb_url LIKE 'https://pub.bitbi.ai/audio/sound-lab/%'
   OR thumb_url LIKE 'https://pub.bitbi.ai/sound-lab/thumbs/%'
GROUP BY item_type, item_id, thumb_url;
```

If this query returns rows, stale favorites must be cleaned or migrated in a separate reviewed D1 cleanup before deleting the Free objects.

Free-track R2 deletion manifest, only after the live query returns zero rows:

```text
audio/sound-lab/cosmic-sea.mp3
audio/sound-lab/zufall-und-notwendigkeit.mp3
audio/sound-lab/relativity.mp3
audio/sound-lab/tiny-hearts.mp3
audio/sound-lab/grok.mp3
sound-lab/thumbs/thumb-cosmic.webp
sound-lab/thumbs/thumb-zufall.webp
sound-lab/thumbs/thumb-relativity.webp
sound-lab/thumbs/thumb-tiny.webp
sound-lab/thumbs/thumb-grok.webp
```

## Legacy Exclusive Import

Run the import as an explicit operator step with a reviewed owner user id. Do not hardcode the owner id in runtime code.

Source bucket: `bitbi-private-media` (`PRIVATE_MEDIA`)
Target bucket: `bitbi-user-images` (`USER_IMAGES`)

Exclusive source objects:

```text
audio/sound-lab/exclusive-track-01.mp3
audio/sound-lab/burning-slow.mp3
audio/sound-lab/feel-it-all.mp3
audio/sound-lab/the-ones-who-made-the-light.mp3
audio/sound-lab/rooms-i'll-never-live-in.mp3
sound-lab/thumbs/thumb-bitbi.webp
sound-lab/thumbs/thumb-burning.webp
sound-lab/thumbs/thumb-feel.webp
sound-lab/thumbs/thumb-ones.webp
sound-lab/thumbs/thumb-rooms.webp
```

Use `scripts/soundlab-exclusive-import-plan.mjs` to generate a deterministic copy manifest and D1 insert SQL after choosing the owner user id and measuring live source object sizes.

Required verification before removing any legacy Exclusive route/object:

```sql
SELECT source_module, visibility, COUNT(*) AS count
FROM ai_text_assets
WHERE source_module = 'music'
  AND json_extract(metadata_json, '$.imported_from') = 'legacy_soundlab_exclusive'
GROUP BY source_module, visibility;
```

Expected result after import: five `music` rows with `visibility = 'private'`, each with a `poster_r2_key`. Publish/unpublish then uses the existing Saved Assets music publication controls.

## Rollback

Keep the source R2 objects until the imported Saved Assets have been verified in production and any stale favorites have been handled. If a problem is found, leave the legacy R2 objects and routes in place, delete only the newly inserted `ai_text_assets` rows and their copied `USER_IMAGES` objects from the reviewed import manifest, then rerun the import after correction.

Do not delete generated Music 2.6 assets, Memtracks, Mempics, Memvids, avatars, `USER_IMAGES` user media outside the import manifest, or Sound Lab member-generated tracks.
