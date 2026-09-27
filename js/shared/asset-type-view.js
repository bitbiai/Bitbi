import { apiAiGetAssets } from './auth-api.js?v=__ASSET_VERSION__';
import { localeText } from './locale.js?v=__ASSET_VERSION__';

// Each disclosure owns its page/cursor. Entering the view performs no fetch;
// only an explicit footer action drains the remaining read-only pages.
export function createAssetTypeView({ grid, buildCard, onAssets, onStorage, onRendered }) {
    let epoch = 0;
    let groups = [];
    function reset({ folderId = null, onlyUnfoldered = false } = {}) {
        const version = ++epoch;
        groups = [];
        grid.replaceChildren();
        for (const type of ['image', 'video', 'sound']) {
            const group = { type, assets: [], cursor: null, more: false, loaded: false, busy: false };
            groups.push(group);
            const section = document.createElement('details');
            section.className = 'studio__asset-type';
            section.dataset.assetTypeGroup = type;
            const summary = document.createElement('summary');
            summary.textContent = localeText(`assets.typeGroup.${type}`);
            const cards = document.createElement('div');
            cards.className = 'studio__image-grid studio__asset-type-grid';
            const status = document.createElement('p');
            status.setAttribute('role', 'status');
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'studio__pagination-btn';
            more.textContent = localeText('assets.showRemainingType');
            more.hidden = true;
            section.append(summary, cards, status, more);
            grid.append(section);

            async function load(remaining = false) {
                if (group.busy || version !== epoch) return;
                group.busy = true;
                section.setAttribute('aria-busy', 'true');
                more.disabled = true;
                status.textContent = localeText('assets.loading');
                try {
                    do {
                        const previous = group.cursor;
                        const page = await apiAiGetAssets(folderId, {
                            onlyUnfoldered, assetType: type, limit: 60, cursor: previous,
                        });
                        if (version !== epoch) return;
                        if (page.hasMore && (!page.nextCursor || page.nextCursor === previous)) {
                            throw new Error('Asset pagination did not advance.');
                        }
                        const seen = new Set(group.assets.map(asset => asset.id));
                        const added = page.assets.filter(asset => !seen.has(asset.id));
                        group.assets.push(...added);
                        group.cursor = page.nextCursor;
                        group.more = page.hasMore;
                        group.loaded = true;
                        cards.append(...added.map(buildCard));
                        onAssets(groups.flatMap(entry => entry.assets));
                        onStorage(page.storageUsage);
                        onRendered();
                        more.hidden = !group.more;
                        more.textContent = localeText('assets.showRemainingType');
                    } while (remaining && group.more && version === epoch);
                    status.textContent = group.assets.length
                        ? localeText(group.more ? 'assets.showingSavedAssets' : 'assets.showingAllSavedAssets', { count: group.assets.length })
                        : localeText('assets.empty');
                } catch {
                    if (version !== epoch) return;
                    status.textContent = localeText('assets.couldNotLoadMore');
                    more.hidden = false;
                    more.textContent = localeText('assets.retryType');
                } finally {
                    if (version === epoch) {
                        group.busy = false;
                        more.disabled = false;
                        section.removeAttribute('aria-busy');
                    }
                }
            }
            section.addEventListener('toggle', () => {
                if (section.open && !group.loaded) void load();
            });
            more.addEventListener('click', () => void load(group.loaded));
        }
        onAssets([]);
    }
    return { reset, invalidate() { ++epoch; } };
}
