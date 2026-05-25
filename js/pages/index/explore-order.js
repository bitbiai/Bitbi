const EXPLORE_TIMESTAMP_KEYS = [
    'published_at',
    'publishedAt',
    'created_at',
    'createdAt',
    'updated_at',
    'updatedAt',
    'completed_at',
    'completedAt',
];

function readTimestamp(item) {
    for (const key of EXPLORE_TIMESTAMP_KEYS) {
        const value = item?.[key];
        if (!value) continue;
        const parsed = Date.parse(String(value));
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function readIdentity(item, getIdentity) {
    if (typeof getIdentity === 'function') {
        const identity = String(getIdentity(item) || '').trim();
        if (identity) return identity;
    }
    return String(item?.id || item?.slug || '').trim();
}

export function orderPublicExploreItems(items, getIdentity) {
    return (Array.isArray(items) ? items : [])
        .map((item, index) => ({
            item,
            index,
            identity: readIdentity(item, getIdentity),
            timestamp: readTimestamp(item),
        }))
        .sort((a, b) => {
            if (a.timestamp !== null && b.timestamp !== null && a.timestamp !== b.timestamp) {
                return b.timestamp - a.timestamp;
            }
            if (a.timestamp !== null && b.timestamp === null) return -1;
            if (a.timestamp === null && b.timestamp !== null) return 1;
            if (a.timestamp !== null && b.timestamp !== null && a.identity && b.identity && a.identity !== b.identity) {
                return b.identity.localeCompare(a.identity);
            }
            return a.index - b.index;
        })
        .map(({ item }) => item);
}
