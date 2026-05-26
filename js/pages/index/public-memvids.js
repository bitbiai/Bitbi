/* ============================================================
   BITBI - Public Memvid helpers
   Shared by homepage video surfaces that read published Memvids.
   ============================================================ */

import { orderPublicExploreItems } from './explore-order.js?v=__ASSET_VERSION__';

const memvidPageCache = new Map();

export function getPublicMemvidIdentity(item) {
    return String(item?.id || item?.slug || item?.poster?.url || item?.file?.url || '').trim();
}

export function resolvePublicMemvidFileUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return '';
        if (!url.pathname.startsWith('/api/gallery/memvids/')) return '';
        if (!url.pathname.endsWith('/file')) return '';
        return `${url.pathname}${url.search}`;
    } catch {
        return '';
    }
}

export function orderPublicMemvidItems(items) {
    return orderPublicExploreItems(items, getPublicMemvidIdentity);
}

export async function fetchPublicMemvidsPage({ limit = 60, cursor = null } = {}) {
    const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 60));
    const normalizedCursor = typeof cursor === 'string' && cursor ? cursor : '';
    const cacheKey = `${normalizedLimit}:${normalizedCursor}`;
    if (memvidPageCache.has(cacheKey)) return memvidPageCache.get(cacheKey);

    const promise = (async () => {
        const params = new URLSearchParams();
        params.set('limit', String(normalizedLimit));
        if (normalizedCursor) params.set('cursor', normalizedCursor);
        const res = await fetch(`/api/gallery/memvids?${params}`, {
            credentials: 'same-origin',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || `Error ${res.status}`);
        }
        const items = orderPublicMemvidItems(Array.isArray(data?.data?.items) ? data.data.items : []);
        return {
            items,
            nextCursor: typeof data?.data?.next_cursor === 'string' ? data.data.next_cursor : null,
            hasMore: data?.data?.has_more === true,
        };
    })();

    memvidPageCache.set(cacheKey, promise);
    try {
        return await promise;
    } catch (error) {
        memvidPageCache.delete(cacheKey);
        throw error;
    }
}
