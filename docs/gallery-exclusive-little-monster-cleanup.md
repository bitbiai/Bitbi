# Gallery Exclusive / Little Monster Cleanup Note

> Historical cleanup note / not current source of truth.
>
> Do not perform deletion from this note without fresh live D1/R2 verification,
> owner approval, and a current cleanup plan.

This note documents the manual cleanup gate for the retired Gallery Exclusive / Little Monster media.
Do not delete R2 objects until the live D1 verification query returns zero rows.
Retired bundled Sound Lab Free / Exclusive cleanup is tracked separately in `docs/soundlab-free-exclusive-cleanup.md`.

## Live D1 Verification

Run this query against the live auth D1 database before deleting any R2 objects:

```sql
SELECT item_type, item_id, COUNT(*) AS count
FROM favorites
WHERE (item_type = 'gallery' AND item_id LIKE 'little-monster-%')
   OR thumb_url LIKE '/api/thumbnails/little-monster-%'
   OR thumb_url LIKE '/api/images/little-monster-%'
GROUP BY item_type, item_id;
```

If the query returns rows, stale favorites must be cleaned or migrated in a separate reviewed D1 cleanup before deleting R2 objects.

## R2 Deletion Manifest

Only if the live D1 query returns zero rows, delete these objects from the private media bucket:

Bucket: `bitbi-private-media`

```text
images/Little_Monster/little-monster_01.png
images/Little_Monster/little-monster_02.png
images/Little_Monster/little-monster_03.png
images/Little_Monster/little-monster_04.png
images/Little_Monster/little-monster_05.png
images/Little_Monster/little-monster_06.png
images/Little_Monster/little-monster_07.png
images/Little_Monster/little-monster_08.png
images/Little_Monster/little-monster_09.png
images/Little_Monster/little-monster_10.png
images/Little_Monster/little-monster_11.png
images/Little_Monster/little-monster_12.png
images/Little_Monster/little-monster_13.png
images/Little_Monster/little-monster_14.png
images/Little_Monster/little-monster_15.png
images/Little_Monster/thumbnails/little-monster_01.webp
images/Little_Monster/thumbnails/little-monster_02.webp
images/Little_Monster/thumbnails/little-monster_03.webp
images/Little_Monster/thumbnails/little-monster_04.webp
images/Little_Monster/thumbnails/little-monster_05.webp
images/Little_Monster/thumbnails/little-monster_06.webp
images/Little_Monster/thumbnails/little-monster_07.webp
images/Little_Monster/thumbnails/little-monster_08.webp
images/Little_Monster/thumbnails/little-monster_09.webp
images/Little_Monster/thumbnails/little-monster_10.webp
images/Little_Monster/thumbnails/little-monster_11.webp
images/Little_Monster/thumbnails/little-monster_12.webp
images/Little_Monster/thumbnails/little-monster_13.webp
images/Little_Monster/thumbnails/little-monster_14.webp
images/Little_Monster/thumbnails/little-monster_15.webp
```

Do not delete `avatars/*`, `USER_IMAGES`, member-generated media, Mempics, Memvids, Memtracks, or any unrelated protected media.
