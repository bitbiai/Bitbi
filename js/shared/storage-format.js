const STORAGE_MB_BYTES = 1024 * 1024;

const storageNumberFormatter = new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: 1,
});

export function formatStorageMegabytes(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return '0 MB';
    return `${storageNumberFormatter.format(size / STORAGE_MB_BYTES)} MB`;
}

export function formatStorageBytes(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    if (size >= STORAGE_MB_BYTES) {
        return formatStorageMegabytes(size);
    }
    if (size >= 1024) {
        return `${storageNumberFormatter.format(size / 1024)} KB`;
    }
    return `${Math.round(size)} B`;
}

export function formatAssetStorageUsage(storageUsage) {
    const usedBytes = Number(storageUsage?.usedBytes);
    if (storageUsage?.isUnlimited === true) {
        if (!Number.isFinite(usedBytes)) return '';
        return `${formatStorageMegabytes(usedBytes)} / ∞`;
    }
    const limitBytes = Number(storageUsage?.limitBytes);
    if (!Number.isFinite(usedBytes) || !Number.isFinite(limitBytes) || limitBytes <= 0) {
        return '';
    }
    return `${formatStorageMegabytes(usedBytes)} / ${formatStorageMegabytes(limitBytes)}`;
}
