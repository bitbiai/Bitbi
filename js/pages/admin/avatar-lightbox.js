import { apiAdminLatestAvatars } from '../../shared/auth-api.js?v=__ASSET_VERSION__';

export function createAdminAvatarLightbox() {
    const refs = {
        dropdown: document.getElementById('avatarDropdown'),
        toggle: document.getElementById('avatarToggle'),
        grid: document.getElementById('avatarGrid'),
        lightbox: document.getElementById('avatarLightbox'),
        lightboxImg: document.getElementById('lightboxImg'),
        lightboxName: document.getElementById('lightboxName'),
        lightboxEmail: document.getElementById('lightboxEmail'),
    };
    let avatarsLoaded = false;

    function openLightbox(avatar) {
        refs.lightboxImg.src = `/api/admin/avatars/${avatar.userId}`;
        refs.lightboxImg.alt = `Avatar of ${avatar.displayName || avatar.email}`;
        refs.lightboxName.textContent = avatar.displayName || avatar.email;
        refs.lightboxEmail.textContent = avatar.displayName ? avatar.email : '';
        refs.lightbox.classList.add('admin-lightbox--visible');
        refs.lightbox.setAttribute('aria-hidden', 'false');
    }

    function closeLightbox() {
        refs.lightbox.classList.remove('admin-lightbox--visible');
        refs.lightbox.setAttribute('aria-hidden', 'true');
        refs.lightboxImg.src = '';
    }

    async function loadLatestAvatars() {
        refs.grid.replaceChildren();
        const msg = document.createElement('div');
        msg.className = 'admin-avatars__empty';
        msg.textContent = 'Loading...';
        refs.grid.appendChild(msg);

        const res = await apiAdminLatestAvatars();
        avatarsLoaded = true;

        if (!res.ok) {
            msg.textContent = 'Failed to load avatars.';
            return;
        }

        const avatars = res.data?.avatars ?? [];

        if (avatars.length === 0) {
            msg.textContent = 'No avatars uploaded yet.';
            return;
        }

        refs.grid.replaceChildren();

        for (const avatar of avatars) {
            const item = document.createElement('button');
            item.className = 'admin-avatars__item';
            item.type = 'button';
            item.setAttribute('aria-label', `View avatar for ${avatar.displayName || avatar.email}`);

            const img = document.createElement('img');
            img.className = 'admin-avatars__thumb';
            img.src = `/api/admin/avatars/${avatar.userId}`;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';

            item.appendChild(img);
            item.addEventListener('click', () => openLightbox(avatar));
            refs.grid.appendChild(item);
        }
    }

    function bindDropdown() {
        if (!refs.toggle || refs.toggle.dataset.bound === '1') return;
        refs.toggle.dataset.bound = '1';
        refs.toggle.addEventListener('click', async () => {
            const isOpen = refs.dropdown.classList.toggle('admin-avatars--open');
            refs.toggle.setAttribute('aria-expanded', String(isOpen));

            if (isOpen && !avatarsLoaded) {
                await loadLatestAvatars();
            }
        });
    }

    function bindLightbox() {
        if (!refs.lightbox || refs.lightbox.dataset.bound === '1') return;
        refs.lightbox.dataset.bound = '1';
        refs.lightbox.addEventListener('click', (event) => {
            if (event.target === refs.lightbox) closeLightbox();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && refs.lightbox.classList.contains('admin-lightbox--visible')) {
                closeLightbox();
            }
        });
    }

    function bind() {
        bindDropdown();
        bindLightbox();
    }

    return {
        bind,
    };
}
