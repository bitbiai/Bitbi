import { galleryItems } from '../../shared/gallery-data.js?v=__ASSET_VERSION__';
import { createBadge } from './ui.js?v=__ASSET_VERSION__';

function inventoryRow(name, value, valueClass = 'admin-inventory__meta') {
    const row = document.createElement('div');
    row.className = 'admin-inventory__row';
    const nameEl = document.createElement('span');
    nameEl.className = 'admin-inventory__name';
    nameEl.textContent = name;
    const valueEl = document.createElement('span');
    valueEl.className = valueClass;
    if (value instanceof Node) valueEl.appendChild(value);
    else valueEl.textContent = String(value ?? '\u2014');
    row.append(nameEl, valueEl);
    return row;
}

function inventory(rows, totalText) {
    const fragment = document.createDocumentFragment();
    const list = document.createElement('div');
    list.className = 'admin-inventory';
    for (const row of rows) {
        list.appendChild(inventoryRow(row.name, row.value, row.valueClass));
    }
    fragment.appendChild(list);
    if (totalText) {
        const total = document.createElement('div');
        total.className = 'admin-inventory__total';
        total.textContent = totalText;
        fragment.appendChild(total);
    }
    return fragment;
}

function injectRefNote(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el || el.querySelector('.admin-reference-note')) return;
    const note = document.createElement('div');
    note.className = 'admin-reference-note';
    note.textContent = 'Help & Archive \u2014 reflects codebase definitions, not live system queries or current runtime truth';
    el.insertBefore(note, el.firstChild);
}

function loadContent() {
    injectRefNote('sectionContent');

    const galEl = document.getElementById('contentGallery');
    if (galEl) {
        galEl.replaceChildren();
        const catLabels = { mempics: 'Mempics' };
        const cats = {};
        for (const item of galleryItems) {
            cats[item.category] = (cats[item.category] || 0) + 1;
        }
        galEl.appendChild(inventory(
            Object.entries(cats).map(([key, count]) => ({
                name: catLabels[key] || key,
                value: count,
                valueClass: 'admin-inventory__count',
            })),
            `${galleryItems.length} items total`
        ));
    }

    const sndEl = document.getElementById('contentSoundlab');
    if (sndEl) {
        sndEl.replaceChildren();
        sndEl.appendChild(inventory([
            { name: 'Published member tracks', value: 'Memtracks' },
        ], 'Sound Lab Explore reads public music from Memtracks.'));
    }
}

function loadMedia() {
    injectRefNote('sectionMedia');
    const total = galleryItems.length;

    const galEl = document.getElementById('mediaGallery');
    if (galEl) {
        galEl.replaceChildren();
        galEl.appendChild(inventory([
            { name: 'Public items', value: total, valueClass: 'admin-inventory__count' },
            { name: 'Thumbnails (480w)', value: total, valueClass: 'admin-inventory__count' },
            { name: 'Previews (900\u20131600w)', value: total, valueClass: 'admin-inventory__count' },
            { name: 'Full resolution', value: total, valueClass: 'admin-inventory__count' },
        ], `${total * 3} image files · pub.bitbi.ai`));
    }

    const audEl = document.getElementById('mediaAudio');
    if (audEl) {
        audEl.replaceChildren();
        audEl.appendChild(inventory([
            { name: 'Published music assets', value: 'USER_IMAGES' },
            { name: 'Public playback', value: '/api/gallery/memtracks' },
        ], 'Legacy bundled Free tracks are removed from the active Sound Lab UI.'));
    }
}

function loadAccess() {
    injectRefNote('sectionAccess');
    const gatingEl = document.getElementById('accessGating');
    if (gatingEl) {
        gatingEl.replaceChildren();
        gatingEl.appendChild(inventory([
            { name: 'Sound Lab category gates', value: 'Removed' },
        ], 'Sound Lab Explore shows published member tracks directly.'));
    }

    const rolesEl = document.getElementById('accessRoles');
    if (rolesEl) {
        rolesEl.replaceChildren();
        rolesEl.appendChild(inventory([
            { name: 'User', value: 'Profile, likes, Assets Manager, view content' },
            { name: 'Admin', value: 'All user permissions + user management, audit log' },
        ]));
    }

    const mapEl = document.getElementById('accessMap');
    if (mapEl) {
        mapEl.replaceChildren();
        mapEl.appendChild(inventory([
            { name: `Gallery (${galleryItems.length} items)`, value: createBadge('Public', 'active') },
            { name: 'Sound Lab Memtracks', value: createBadge('Public when published', 'active') },
            { name: 'Experiments (4)', value: createBadge('Public', 'active') },
            { name: 'Video Exclusives', value: createBadge('Auth', 'admin') },
            { name: 'Assets Manager', value: createBadge('Auth', 'admin') },
        ]));
    }
}

export function createAdminReferenceViews() {
    return {
        loadContent,
        loadMedia,
        loadAccess,
    };
}
