/* ============================================================
   BITBI — Gallery rendering, filtering, modal with focus trap
   ============================================================ */

import { setupFocusTrap } from '../../shared/focus-trap.js';
import { getAuthState } from '../../shared/auth-state.js';
import { openAuthModal } from '../../shared/auth-modal.js';

const items = [
    { t: 'The Letter B Goes Interstellar', c: 'A glowing glass letter B floats in deep space, orbited by rings of binary code and neon data streams \u2014 because even the alphabet deserves its own solar system.', cat: 'pictures', img: '/assets/images/100.JPG' },
    { t: 'Coral Reef Nightmare Buddy', c: 'A chubby blue-and-purple blob creature with mismatched googly eyes, an open mouth full of confusion, and way too many orange tentacles \u2014 sitting on a mossy rock like it owns the place.', cat: 'creepy', img: '/assets/images/101.JPG' },
    { t: 'The Friendliest Virus You Ever Saw', c: 'A round, spiky, ice-blue germ ball with three shiny black eyes and a massive toothy grin, floating in a teal abyss surrounded by its equally cheerful germ friends. Disturbingly adorable.', cat: 'creepy', img: '/assets/images/102.JPG' },
    { t: 'Angry Ant from Hell', c: 'A massive red ant-like beast with glowing crimson eyes, gnarly fangs, and twitching antennae perches on a mossy branch in a jungle \u2014 looking personally offended that you exist.', cat: 'creepy', img: '/assets/images/103.JPG' },
    { t: 'Swamp Thing\u2019s Ugly Cousin', c: 'A slimy green amphibious monstrosity crawls out of murky swamp water with fangs bared and reddish tentacles dangling from its mouth. Looks like it just ate something it regrets.', cat: 'creepy', img: '/assets/images/104.JPG' },
    { t: 'Mossgirl Stares Into Your Soul', c: 'Close-up portrait of a face half-consumed by green moss and twisted branches, with piercing icy blue eyes peering out. She is judging you, and you deserve it.', cat: 'creepy', img: '/assets/images/105.JPG' },
    { t: 'Monday Morning Demon', c: 'A grey-skinned, red-eyed demon with massive curved horns and a permanent scowl sits among dead tree branches wearing a button-up shirt. Corporate evil has never looked this literal.', cat: 'creepy', img: '/assets/images/106.JPG' },
    { t: 'Entomologist\u2019s Fever Dream', c: 'A furry blue moth-creature with red eyes and fangs stands center stage, surrounded by dozens of meticulously arranged bizarre insects, spiders, and spiky orbs on a teal background \u2014 like a natural history museum designed by a madman.', cat: 'creepy', img: '/assets/images/107.JPG' },
    { t: 'Planetary Meltdown in Green', c: 'A massive green planet crumbles apart in a blinding explosion of sparks, flying rocks, and cosmic debris \u2014 captured in that split second where everything goes spectacularly wrong.', cat: 'experimental', img: '/assets/images/108.JPG' },
];

let focusTrapCleanup = null;

export function initGallery() {
    const grid = document.getElementById('galleryGrid');
    const modal = document.getElementById('galleryModal');
    if (!grid || !modal) return;

    function render(filter) {
        /* Preserve exclusive cards injected by locked-sections.js */
        const exclusiveCards = Array.from(grid.querySelectorAll('.locked-area.gallery-item'));
        exclusiveCards.forEach(card => card.remove());

        grid.innerHTML = '';

        /* "exclusive" filter: show only the exclusive cards, no regular items */
        if (filter === 'exclusive') {
            exclusiveCards.forEach(card => {
                card.style.display = '';
                grid.appendChild(card);
            });
            return;
        }

        /* Exclusive cards only visible in exclusive view, hidden for all other filters */
        exclusiveCards.forEach(card => {
            card.style.display = 'none';
            grid.appendChild(card);
        });

        const list = filter === 'all' ? items : items.filter(i => i.cat === filter);
        list.forEach((item) => {
            const d = document.createElement('div');
            d.className = 'gallery-item';
            d.setAttribute('tabindex', '0');
            d.setAttribute('role', 'button');
            d.setAttribute('aria-label', item.t);
            d.innerHTML = `<div class="gallery-inner rounded-xl overflow-hidden relative" style="border:1px solid rgba(255,255,255,0.04)"><img src="${item.img}" alt="${item.t}" width="600" height="400" loading="lazy" decoding="async" style="width:100%;display:block;object-fit:cover"><div class="gallery-overlay" style="position:absolute;inset:0;display:flex;align-items:flex-end;padding:20px"><div><h4 style="font-family:'Playfair Display',serif;font-weight:700;font-size:14px;color:rgba(255,255,255,0.9)">${item.t}</h4><p style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;text-transform:capitalize">${item.cat}</p><span style="display:inline-block;margin-top:6px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#00F0FF">View Full \u2192</span></div></div></div>`;
            d.addEventListener('click', () => openModal(item));
            d.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(item); }
            });
            grid.appendChild(d);
        });
    }

    render('all');

    /* Listen for exclusive filter from locked-sections.js */
    grid.addEventListener('gallery:filter', (e) => {
        render(e.detail);
    });

    /* Filter buttons with keyboard navigation */
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(x => {
                x.classList.remove('active');
                x.setAttribute('aria-selected', 'false');
            });
            /* Also deselect the Exclusive button so it doesn't think it's still active */
            const exclBtn = document.querySelector('.auth-filter-btn');
            if (exclBtn) {
                exclBtn.classList.remove('active');
                exclBtn.setAttribute('aria-selected', 'false');
            }
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            render(btn.dataset.filter);
        });

        btn.addEventListener('keydown', (e) => {
            let target = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                target = filterBtns[(idx + 1) % filterBtns.length];
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                target = filterBtns[(idx - 1 + filterBtns.length) % filterBtns.length];
            }
            if (target) {
                e.preventDefault();
                target.focus();
                target.click();
            }
        });
    });

    function openModal(item) {
        const mi = document.getElementById('modalImage');
        mi.style.background = '#0D1B2A';
        mi.innerHTML = `<img src="${item.img}" alt="${item.t}" style="width:100%;height:100%;object-fit:contain;display:block">`;
        document.getElementById('modalTitle').textContent = item.t;
        document.getElementById('modalCaption').textContent = item.c;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        focusTrapCleanup = setupFocusTrap(modal);
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        if (focusTrapCleanup) { focusTrapCleanup(); focusTrapCleanup = null; }
    }

    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    /* ── Mobile Gallery Deck ── */
    const galMql = window.matchMedia('(max-width: 639px)');
    let galActive = 0;
    let galIsDeck = false;
    let galDotsEl = null;
    let galSwipeLock = false;
    let galCategory = 'pictures';

    function galGetCards() {
        return Array.from(grid.children).filter(c => c.style.display !== 'none' && c.tagName !== 'BUTTON');
    }

    function galLayout(skipAnim) {
        const all = galGetCards();
        const n = all.length;
        all.forEach((c, i) => {
            const d = i - galActive;
            c.style.transition = skipAnim ? 'none' : '';
            if (d === 0) {
                c.style.transform = 'scale(0.90)';
                c.style.opacity = '1';
                c.style.zIndex = String(n);
                c.style.pointerEvents = '';
            } else if (d === 1) {
                c.style.transform = 'translateX(24px) scale(0.86)';
                c.style.opacity = '0.55';
                c.style.zIndex = String(n - 1);
                c.style.pointerEvents = 'none';
            } else if (d === 2) {
                c.style.transform = 'translateX(42px) scale(0.82)';
                c.style.opacity = '0.3';
                c.style.zIndex = String(n - 2);
                c.style.pointerEvents = 'none';
            } else {
                c.style.transform = d < 0 ? 'translateX(-30px) scale(0.82)' : 'translateX(50px) scale(0.80)';
                c.style.opacity = '0';
                c.style.zIndex = '0';
                c.style.pointerEvents = 'none';
            }
        });
    }

    function galBuildDots() {
        if (galDotsEl) galDotsEl.remove();
        const all = galGetCards();
        if (all.length <= 1) { galDotsEl = null; return; }
        galDotsEl = document.createElement('div');
        galDotsEl.className = 'gal-deck-dots';
        galDotsEl.setAttribute('role', 'tablist');
        galDotsEl.setAttribute('aria-label', 'Gallery cards');
        all.forEach((_, i) => {
            const d = document.createElement('button');
            d.className = 'gal-deck-dot' + (i === galActive ? ' active' : '');
            d.setAttribute('role', 'tab');
            d.setAttribute('aria-selected', i === galActive ? 'true' : 'false');
            d.setAttribute('aria-label', `Show card ${i + 1}`);
            d.addEventListener('click', () => { galActive = i; galLayout(); galSyncDots(); });
            galDotsEl.appendChild(d);
        });
        grid.after(galDotsEl);
    }

    function galSyncDots() {
        if (!galDotsEl) return;
        const dots = galDotsEl.querySelectorAll('.gal-deck-dot');
        const all = galGetCards();
        if (dots.length !== all.length) { galBuildDots(); return; }
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === galActive);
            d.setAttribute('aria-selected', i === galActive ? 'true' : 'false');
        });
    }

    function galRenderDeck() {
        const cards = galGetCards();
        galActive = Math.min(galActive, Math.max(0, cards.length - 1));
        galLayout(true);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                galGetCards().forEach(c => { c.style.transition = ''; });
            });
        });
        galBuildDots();
    }

    function galSwitchCategory(cat) {
        galCategory = cat;
        if (!galIsDeck) return;
        galActive = 0;
        if (cat === 'exclusive') {
            grid.dispatchEvent(new CustomEvent('gallery:filter', { detail: 'exclusive' }));
        } else {
            render(cat);
        }
    }

    function galCreateFilterBar() {
        const bar = document.createElement('div');
        bar.className = 'gal-filter-bar';
        bar.setAttribute('role', 'tablist');
        bar.setAttribute('aria-label', 'Gallery categories');

        const cats = [
            { key: 'pictures', label: 'Pictures' },
            { key: 'creepy', label: 'Creepy Creatures' },
            { key: 'experimental', label: 'Experimental' },
        ];

        const galBtns = {};

        cats.forEach(({ key, label }) => {
            const btn = document.createElement('button');
            btn.className = 'gal-filter-btn' + (key === galCategory ? ' active' : '');
            btn.textContent = label;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', key === galCategory ? 'true' : 'false');
            btn.addEventListener('click', () => {
                if (galCategory === key) return;
                Object.values(galBtns).forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                galSwitchCategory(key);
            });
            galBtns[key] = btn;
            bar.appendChild(btn);
        });

        const exclBtn = document.createElement('button');
        exclBtn.className = 'gal-filter-btn gal-filter-btn--auth';
        exclBtn.textContent = 'Exclusive \uD83D\uDD12';
        exclBtn.setAttribute('role', 'tab');
        exclBtn.setAttribute('aria-selected', 'false');

        const { loggedIn } = getAuthState();
        if (loggedIn) {
            exclBtn.classList.add('unlocked');
            exclBtn.textContent = 'Exclusive';
        }

        exclBtn.addEventListener('click', () => {
            const { loggedIn } = getAuthState();
            if (!loggedIn) { openAuthModal('register'); return; }
            Object.values(galBtns).forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            exclBtn.classList.add('active');
            exclBtn.setAttribute('aria-selected', 'true');
            galSwitchCategory('exclusive');
        });

        galBtns.exclusive = exclBtn;
        bar.appendChild(exclBtn);

        document.addEventListener('bitbi:auth-change', () => {
            const { loggedIn } = getAuthState();
            exclBtn.classList.toggle('unlocked', loggedIn);
            exclBtn.textContent = loggedIn ? 'Exclusive' : 'Exclusive \uD83D\uDD12';
            if (!loggedIn && galCategory === 'exclusive') {
                exclBtn.classList.remove('active');
                exclBtn.setAttribute('aria-selected', 'false');
                galBtns.pictures.classList.add('active');
                galBtns.pictures.setAttribute('aria-selected', 'true');
                galSwitchCategory('pictures');
            }
        });

        grid.parentElement.insertBefore(bar, grid);
    }

    function galEngage() {
        if (galIsDeck) return;
        galIsDeck = true;
        galActive = 0;
        grid.classList.add('gal-deck');
        render(galCategory);
        galRenderDeck();
    }

    function galDisengage() {
        if (!galIsDeck) return;
        galIsDeck = false;
        grid.classList.remove('gal-deck');
        Array.from(grid.children).forEach(c => {
            c.style.transform = '';
            c.style.opacity = '';
            c.style.zIndex = '';
            c.style.pointerEvents = '';
            c.style.transition = '';
        });
        if (galDotsEl) { galDotsEl.remove(); galDotsEl = null; }
        render('all');
        const desktopBar = document.querySelector('#gallery .filter-bar');
        if (desktopBar) {
            desktopBar.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            const allBtn = desktopBar.querySelector('[data-filter="all"]');
            if (allBtn) { allBtn.classList.add('active'); allBtn.setAttribute('aria-selected', 'true'); }
            const authBtn = desktopBar.querySelector('.auth-filter-btn');
            if (authBtn) { authBtn.classList.remove('active'); authBtn.setAttribute('aria-selected', 'false'); }
        }
    }

    /* Touch handling */
    let gsx, gsy, gst, gTracking, gDecided, gHoriz;

    grid.addEventListener('touchstart', e => {
        if (!galIsDeck) return;
        const t = e.touches[0];
        gsx = t.clientX; gsy = t.clientY; gst = Date.now();
        gTracking = true; gDecided = false; gHoriz = false;
        galSwipeLock = false;
        const c = galGetCards()[galActive];
        if (c) c.style.transition = 'none';
    }, { passive: true });

    grid.addEventListener('touchmove', e => {
        if (!gTracking || !galIsDeck) return;
        const t = e.touches[0];
        const dx = t.clientX - gsx, dy = t.clientY - gsy;
        if (!gDecided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            gDecided = true;
            gHoriz = Math.abs(dx) > Math.abs(dy);
            if (!gHoriz) {
                gTracking = false;
                const c = galGetCards()[galActive];
                if (c) c.style.transition = '';
                return;
            }
        }
        if (gHoriz) {
            e.preventDefault();
            const c = galGetCards()[galActive];
            if (c) {
                let adj = dx;
                const all = galGetCards();
                if ((galActive === 0 && dx > 0) || (galActive >= all.length - 1 && dx < 0)) adj *= 0.25;
                c.style.transform = `translateX(${adj}px) scale(0.90)`;
            }
        }
    }, { passive: false });

    grid.addEventListener('touchend', e => {
        if (!gTracking || !galIsDeck) return;
        gTracking = false;
        if (!gHoriz || !gDecided) {
            galLayout();
            return;
        }
        const dx = e.changedTouches[0].clientX - gsx;
        const v = Math.abs(dx) / Math.max(Date.now() - gst, 1);
        const all = galGetCards();
        if ((Math.abs(dx) > 40 || v > 0.3) && Math.abs(dx) > 15) {
            galSwipeLock = true;
            if (dx < 0 && galActive < all.length - 1) galActive++;
            else if (dx > 0 && galActive > 0) galActive--;
        }
        galLayout();
        galSyncDots();
    }, { passive: true });

    grid.addEventListener('touchcancel', () => {
        if (!gTracking || !galIsDeck) return;
        gTracking = false;
        galLayout();
    }, { passive: true });

    /* Block click after swipe */
    grid.addEventListener('click', e => {
        if (galSwipeLock) { e.stopPropagation(); e.preventDefault(); galSwipeLock = false; }
    }, true);

    /* Watch for DOM changes (locked-sections.js, render, subcategory) */
    new MutationObserver(() => {
        if (galIsDeck) galRenderDeck();
    }).observe(grid, { childList: true });

    galCreateFilterBar();

    galMql.addEventListener('change', e => {
        if (e.matches) galEngage();
        else galDisengage();
    });

    if (galMql.matches) galEngage();
}
