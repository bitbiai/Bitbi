# Sound Lab Free / Exclusive Cleanup Note

> Historical cleanup note / not current source of truth.
>
> Do not perform deletion from this note without fresh live R2 verification,
> owner approval, and a current cleanup plan.

This note documents the safe cleanup path for the retired bundled Sound Lab Free and Exclusive catalogs.
The old bundled tracks are no longer imported or migrated into Saved Assets.

Current Sound Lab behavior:

- Sound Lab Explore lists published member music directly from `/api/gallery/memtracks`.
- Member Music 2.6 generation, generated music saving, cover thumbnails, Saved Assets playback, publish/unpublish, and public Memtracks remain active.
- Private/unpublished member music remains private.
- The old bundled Free and Exclusive Sound Lab categories are retired.
- No runtime route or script should serve or import the old bundled tracks.

## Manual R2 Cleanup Gate

Do not delete R2 objects as part of a code release. Verify every exact key in Cloudflare R2 first.
Some candidate keys may not exist in production.

Never broad-delete `audio/sound-lab/` or `sound-lab/thumbs/` unless a bucket listing proves those prefixes contain only the retired objects below.

### Old Free Bundled Objects

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

### Old Exclusive Bundled Objects

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

## Verification Before Deletion

Before manual deletion, confirm that no live favorites still point at the old bundled paths:

```sql
SELECT item_type, item_id, thumb_url, COUNT(*) AS count
FROM favorites
WHERE (item_type = 'soundlab' AND item_id IN (
  'cosmic-sea',
  'zufall-und-notwendigkeit',
  'relativity',
  'tiny-hearts',
  'grok',
  'exclusive-track-01',
  'burning-slow',
  'feel-it-all',
  'the-ones-who-made-the-light',
  'rooms-i''ll-never-live-in'
))
   OR thumb_url LIKE 'https://pub.bitbi.ai/audio/sound-lab/%'
   OR thumb_url LIKE 'https://pub.bitbi.ai/sound-lab/thumbs/%'
   OR thumb_url LIKE '/api/music/%'
   OR thumb_url LIKE '/api/soundlab-thumbs/%'
GROUP BY item_type, item_id, thumb_url;
```

If this query returns rows, clean or migrate those stale favorites in a separate reviewed D1 cleanup before deleting R2 objects.

## Do Not Delete

Do not delete generated Music 2.6 assets, member Saved Assets, public Memtracks, Mempics, Memvids, avatars, `USER_IMAGES`, or unrelated protected media.
