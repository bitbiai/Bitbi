// Publisher metadata comes from the model contracts, never transport labels.
const alphabetical = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export function sortGenerationModels(models) {
    return [...models].sort((a, b) =>
        alphabetical.compare(a.vendor || '', b.vendor || '')
        || alphabetical.compare(a.displayName || a.label || '', b.displayName || b.label || '')
        || alphabetical.compare(a.id, b.id));
}
