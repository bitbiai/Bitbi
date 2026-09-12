// Naming only: inference input, ownership and billing remain unchanged.
export function promptAssetTitle(prompt, fallback = 'Generated Asset') {
  return String(prompt || '').trim().split(/\s+/u).filter(Boolean).slice(0, 3).join(' ') || fallback;
}

// Existing stored-asset filename sanitization, shared by automatic names.
export function slugifyFileName(value, fallback = 'asset') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 64) || fallback;
}
