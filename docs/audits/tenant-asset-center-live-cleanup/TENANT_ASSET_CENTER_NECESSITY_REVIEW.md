# Tenant Asset Center Necessity Review

Generated: 2026-06-17T13:31:34.822Z

## Recommendation

Keep the Tenant Asset Center for now, but consider renaming or narrowing it to **Storage Health / Asset Integrity** after full R2 inventory evidence is available.

## Why It Is Still Useful

- It centralizes cross-domain ownership evidence and blocked reset/backfill state.
- It documents that tenant isolation, ownership backfill, access switch, and legacy reset remain evidence-gated.
- It complements Admin User Storage and R2 Drive: User Storage is selected-user operational management, R2 Drive is object-level management, and Tenant Asset Center is integrity/evidence classification.

## What Should Not Happen Yet

- Do not remove Tenant Asset Center routes/UI until a complete R2 inventory and post-cleanup baseline prove that legacy/manual-review/reset evidence is obsolete.
- Do not turn current backfill/access-switch/reset controls into active mutation shortcuts.
- Do not claim tenant isolation readiness from this audit alone.
