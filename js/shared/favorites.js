/* ============================================================
   BITBI — Favorites: client-side state + star button factory
   ============================================================ */

import { apiGetFavorites, apiAddFavorite, apiRemoveFavorite } from './auth-api.js';
import { getAuthState } from './auth-state.js';
import { openAuthModal } from './auth-modal.js';

const STAR_SVG = `<svg class="fav-star__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;

/** @type {Map<string, {title:string, thumb_url:string}>} */
const favMap = new Map();
let loaded = false;

function key(type, id) { return `${type}:${id}`; }

/** Fetch favorites from API (call after auth ready). */
export async function loadFavorites() {
    const { loggedIn } = getAuthState();
    if (!loggedIn) { favMap.clear(); loaded = false; return; }

    const res = await apiGetFavorites();
    favMap.clear();
    if (res.ok && Array.isArray(res.data?.favorites)) {
        for (const f of res.data.favorites) {
            favMap.set(key(f.item_type, f.item_id), { title: f.title, thumb_url: f.thumb_url });
        }
    }
    loaded = true;

    // Update all existing star buttons in the DOM
    document.querySelectorAll('.fav-star').forEach(btn => {
        const t = btn.dataset.favType;
        const i = btn.dataset.favId;
        const active = favMap.has(key(t, i));
        btn.classList.toggle('fav-star--active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
}

/** Check if item is favorited. */
export function isFavorited(type, id) {
    return favMap.has(key(type, id));
}

/** Get all favorites as array (for profile rendering). */
export function getAllFavorites() {
    const out = [];
    for (const [k, meta] of favMap) {
        const [type, ...rest] = k.split(':');
        out.push({ item_type: type, item_id: rest.join(':'), ...meta });
    }
    return out;
}

/**
 * Create a star button element for a content item.
 * @param {string} type  - 'gallery' | 'soundlab'
 * @param {string} id    - stable item identifier
 * @param {{title:string, thumb_url:string}} meta - render metadata
 * @returns {HTMLButtonElement}
 */
export function createStarButton(type, id, meta) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fav-star';
    btn.dataset.favType = type;
    btn.dataset.favId = id;
    btn.innerHTML = STAR_SVG;

    const active = isFavorited(type, id);
    btn.classList.toggle('fav-star--active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', `Favorite ${meta.title}`);

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const { loggedIn } = getAuthState();
        if (!loggedIn) {
            openAuthModal('register');
            return;
        }

        const wasActive = favMap.has(key(type, id));

        // Optimistic UI update
        btn.classList.toggle('fav-star--active', !wasActive);
        btn.setAttribute('aria-pressed', String(!wasActive));

        let res;
        if (wasActive) {
            favMap.delete(key(type, id));
            res = await apiRemoveFavorite(type, id);
        } else {
            favMap.set(key(type, id), { title: meta.title, thumb_url: meta.thumb_url });
            res = await apiAddFavorite(type, id, meta.title, meta.thumb_url);
        }

        if (!res.ok) {
            // Revert on failure
            if (wasActive) {
                favMap.set(key(type, id), { title: meta.title, thumb_url: meta.thumb_url });
            } else {
                favMap.delete(key(type, id));
            }
            btn.classList.toggle('fav-star--active', wasActive);
            btn.setAttribute('aria-pressed', String(wasActive));
        }

        // Sync all star buttons with same type:id
        document.querySelectorAll(`.fav-star[data-fav-type="${type}"][data-fav-id="${id}"]`).forEach(b => {
            if (b === btn) return;
            const now = favMap.has(key(type, id));
            b.classList.toggle('fav-star--active', now);
            b.setAttribute('aria-pressed', String(now));
        });
    });

    return btn;
}
